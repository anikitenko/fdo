/** @jest-environment node */
const {test,expect}=require('@jest/globals');
const {Server,Client}=require('ssh2');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runGitTransport}=require('../../src/utils/hostServices/gitTransport.cjs');
const {fingerprint}=require('../../src/utils/hostServices/ssh.cjs');
const {bundledGit,environment}=require('../../src/utils/git/bundledGit.cjs');
const {generateEd25519}=require('../../src/utils/hostServices/sshKeys.cjs');
const packet=value=>{const body=Buffer.from(value);return Buffer.concat([Buffer.from((body.length+4).toString(16).padStart(4,'0')),body]);};

test('bundled LFS transfers binary objects through pinned SSH without an external SSH executable',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'fdo-lfs-')),git=bundledGit();
    const hostKey=generateEd25519(),connections=new Set(),processes=new Set();
    const content=Buffer.from(Array.from({length:131073},(_,i)=>i%256)),oid=createHash('sha256').update(content).digest('hex');
    let downloaded=0,denyHTTPS=false,authAttempts=0;
    const env=environment({...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'none')},git);
    const run=(args,cwd=root)=>execFileSync(git.command,args,{cwd,env,stdio:'pipe'});
    run(['init','--bare','remote.git']);run(['init','seed']);
    await fs.writeFile(path.join(root,'seed','object.bin'),`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${content.length}\n`);
    await fs.writeFile(path.join(root,'seed','.gitattributes'),'*.bin filter=lfs diff=lfs merge=lfs -text\n');
    run(['-c','filter.lfs.clean=','-c','filter.lfs.required=false','add','.'],path.join(root,'seed'));
    run(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','LFS pointer'],path.join(root,'seed'));
    run(['push',path.join(root,'remote.git'),'HEAD:refs/heads/main'],path.join(root,'seed'));run(['symbolic-ref','HEAD','refs/heads/main'],path.join(root,'remote.git'));
    const server=new Server({hostKeys:[hostKey.private]},connection=>{
        connections.add(connection);connection.on('error',()=>{});connection.once('close',()=>connections.delete(connection));
        connection.on('authentication',ctx=>ctx.method==='password'&&ctx.password==='fixture'?ctx.accept():ctx.reject());
        connection.on('ready',()=>connection.on('session',accept=>accept().on('exec',(accept,reject,info)=>{
            if(info.command==="git-upload-pack '/remote.git'") {
                const channel=accept(),child=spawn(git.command,['upload-pack',path.join(root,'remote.git')],{env});processes.add(child);
                channel.pipe(child.stdin);child.stdout.pipe(channel,{end:false});child.stderr.pipe(channel.stderr);child.stdin.on('error',()=>{});
                child.on('close',code=>{processes.delete(child);channel.exit(code);channel.end();});channel.on('close',()=>child.kill());return;
            }
            if(info.command==="git-lfs-authenticate '/remote.git' download"&&denyHTTPS) {
                authAttempts++;const channel=accept();channel.write(JSON.stringify({href:'https://unapproved.example.test/info/lfs',header:{Authorization:'Bearer private-fixture-token'}}));channel.exit(0);channel.end();return;
            }
            if(info.command!=="git-lfs-transfer '/remote.git' download"||denyHTTPS)return reject();
            const channel=accept();let pending=Buffer.alloc(0),request=[];
            channel.write(Buffer.concat([packet('version=1\n'),Buffer.from('0000')]));
            channel.on('data',chunk=>{
                pending=Buffer.concat([pending,chunk]);
                while(pending.length>=4){const length=parseInt(pending.subarray(0,4).toString(),16);if(length>pending.length)return;
                    if(length===0){pending=pending.subarray(4);const command=request[0]?.toString().trim();request=[];
                        if(command==='version 1')channel.write(Buffer.concat([packet('status 200\n'),Buffer.from('0000')]));
                        else if(command==='batch')channel.write(Buffer.concat([packet('status 200\n'),Buffer.from('0001'),packet(`${oid} ${content.length} download\n`),Buffer.from('0000')]));
                        else if(command===`get-object ${oid}`){downloaded++;channel.write(Buffer.concat([packet('status 200\n'),packet(`size=${content.length}\n`),Buffer.from('0001'),...Array.from({length:3},(_,i)=>packet(content.subarray(i*60000,(i+1)*60000))),Buffer.from('0000')]));}
                        else if(command==='quit'){channel.write(Buffer.concat([packet('status 200\n'),Buffer.from('0000')]));channel.exit(0);channel.end();}
                        else {channel.write(Buffer.concat([packet('status 400\n'),Buffer.from('0000')]));}continue;
                    }
                    if(length===1){pending=pending.subarray(4);continue;}
                    if(length<4){channel.destroy();return;}request.push(pending.subarray(4,length));pending=pending.subarray(length);
                }
            });
        })));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const profile={host:'127.0.0.1',port:server.address().port,username:'git',trustedHostKey:fingerprint(hostKey.publicSSH),policy:{consumers:['git'],repositories:[{path:'/remote.git',operations:['clone','fetch']}]}};
    try {
        const result=await runGitTransport({Client,plan:{command:git.command,cwd:root,args:['clone',`ssh://git@127.0.0.1:${profile.port}/remote.git`,'copy'],timeoutMs:20000},
            authorizeTarget:()=>({profile,credentials:{password:'fixture'}}),signal:new AbortController().signal,helperPath:path.resolve(__dirname,'../../src/utils/hostServices/gitSshHelper.cjs')});
        expect(result.stderr.toString()).not.toContain('fixture-password');
        expect(result.exitCode).toBe(0);expect(downloaded).toBeGreaterThan(0);
        expect(await fs.readFile(path.join(root,'copy','object.bin'))).toEqual(content);
        denyHTTPS=true;await fs.rm(path.join(root,'copy/.git/lfs/objects'),{recursive:true,force:true});
        await expect(runGitTransport({Client,plan:{command:git.command,cwd:path.join(root,'copy'),args:['lfs','fetch',`ssh://git@127.0.0.1:${profile.port}/remote.git`],timeoutMs:10000},
            authorizeTarget:()=>({profile,credentials:{password:'fixture'}}),signal:new AbortController().signal,helperPath:path.resolve(__dirname,'../../src/utils/hostServices/gitSshHelper.cjs')}))
            .rejects.toMatchObject({code:'ACCESS_DENIED',gitFailure:'LFS_HTTPS_DESTINATION_DENIED',message:'Host service request failed.'});
        expect(authAttempts).toBeGreaterThan(0);
    } finally {for(const child of processes)child.kill();for(const connection of connections)connection.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},30000);
