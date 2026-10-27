const {spawn} = require('node:child_process');
const {createServer} = require('node:net');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {StringDecoder} = require('node:string_decoder');
const {failure,ensure} = require('./contracts.cjs');
const {trusted, prepareSshCredentials} = require('./ssh.cjs');

function buildRemoteCommand(endpoint) {
    const allowedServices = new Set(['git-upload-pack','git-receive-pack','git-lfs-authenticate','git-lfs-transfer']);
    if (!allowedServices.has(endpoint?.service)) throw Object.assign(failure('INVALID_REQUEST'), {gitFailure:'HELPER_ARGUMENTS_REJECTED'});
    if (endpoint?.direction !== undefined && endpoint?.direction !== null && endpoint.direction !== '' && endpoint.direction !== 'download' && endpoint.direction !== 'upload') {
        throw Object.assign(failure('INVALID_REQUEST'), {gitFailure:'HELPER_ARGUMENTS_REJECTED'});
    }
    if (typeof endpoint?.repository !== 'string' || !/^[\w./:@+-]+$/.test(endpoint.repository)) {
        throw Object.assign(failure('INVALID_REQUEST'), {gitFailure:'HELPER_ARGUMENTS_REJECTED'});
    }
    const quotedRepository = endpoint.repository.replace(/'/g, `'\"'\"'`);
    return endpoint.service+" '"+quotedRepository+"'"+(endpoint.direction?' '+endpoint.direction:'');
}

async function resolveGitWorkingDirectory(cwd) {
    try {return await fs.realpath(cwd);} catch {throw Object.assign(failure('UNAVAILABLE'),{gitFailure:'GIT_EXECUTABLE_OR_CWD_MISSING'});}
}

function quote(value, platform = process.platform) {
    // Git runs GIT_SSH_COMMAND through its POSIX shell, including Git for Windows.
    if (/[\r\n\0]/.test(value)) throw failure('INVALID_REQUEST');
    return "'" + (platform === 'win32' ? value.replace(/\\/g, '/') : value).replace(/'/g, "'\\''") + "'";
}
function frame(type, data) {const head = Buffer.alloc(5); head[0] = type; head.writeUInt32BE(data.length, 1); return Buffer.concat([head, data]);}
const {parse, select} = require('./gitPolicy.cjs');
const {configuration, checkConfiguration, remote, canonical, helperTarget, childDirectory, submodules, invalid} = require('./gitInvocation.cjs');
const {bundledGit} = require('../git/bundledGit.cjs');
const {createLfsProxy, origin, matches} = require('./gitLfsProxy.cjs');

async function runGitTransport({Client, plan, invocation = parse(plan), selection, credentials, authorizeTarget, signal, helperPath, executable = process.execPath}) {
    const token = randomBytes(32).toString('hex'), sockets = new Set(), clients = new Set(), channels = new Set();
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-git-'));
    let base;
    let child, timer, transportError, settled = false, sessionCount = 0, proxy;
    const output = {stdout:'',stderr:''}, redactions=new Set(); let captured = 0, truncated = false;
    const redact=value=>{for(const secret of redactions)if(secret)value=value.split(secret).join('[redacted]');return value;};
    const clearCredentials = value => {if (value) for (const key of Object.keys(value)) value[key] = undefined;};
    const authorize = (url, operation) => {
        ensure(!signal.aborted,'ACCESS_DENIED');
        if (authorizeTarget) return authorizeTarget(url, operation);
        // The fallback is used by host tests only. It is bound to one exact
        // destination; production always resolves fresh grants and credentials.
        const selected = select([{...selection.profile, policy:{consumers:['git'],repositories:[{path:selection.repository,operations:[invocation.policyOperation]}]}}], url, operation);
        return {...selected, credentials:{...credentials}};
    };
    const fail = (code, gitFailure) => {
        if (settled) return;
        transportError ||= Object.assign(failure(code), {gitFailure});
        child?.kill('SIGKILL');
        for (const channel of channels) channel.destroy();
        for (const client of clients) client.destroy();
        for (const socket of sockets) socket.destroy();
    };
    const abort = () => fail('ACCESS_DENIED');
    const server = createServer({allowHalfOpen:true}, socket => {
        if (sockets.size >= 8 || sessionCount >= 64 || transportError) {socket.destroy(); return;}
        sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
        socket.setTimeout(10000, () => socket.destroy());
        let header = Buffer.alloc(0);
        const authenticate = async chunk => {
            header = Buffer.concat([header,chunk]); const end = header.indexOf(10);
            if ((end < 0 && header.length > 8192) || end > 8192) {socket.destroy(); return;}
            if (end < 0) return;
            socket.pause(); socket.removeListener('data',onData);
            let request;
            try {request=JSON.parse(header.subarray(0,end).toString());} catch {socket.destroy(); return;}
            const supplied=Buffer.from(typeof request.token==='string'?request.token:'');
            if (supplied.length!==token.length || !timingSafeEqual(supplied,Buffer.from(token))) {socket.destroy(); return;}
            let endpoint, selected;
            try {
                endpoint=helperTarget(request.args);
                const sending=endpoint.service==='git-receive-pack'||endpoint.direction==='upload';
                ensure(!sending || invocation.policyOperation==='push','ACCESS_DENIED');
                selected=authorize(endpoint.url,sending?'push':invocation.policyOperation);
            } catch (error) {fail(error.code,error.gitFailure); socket.destroy(); return;}
            sessionCount++; socket.setTimeout(0);
            const client=new Client(); clients.add(client);
            let verified=false, rejectedKey=false, finished=false;
            client.on('error', error => fail(rejectedKey?'HOST_KEY_REJECTED':error.level==='client-timeout'?'TIMEOUT':'CONNECTION_FAILED',
                error.level==='client-authentication'?'AUTHENTICATION_FAILED':error.code==='ENOTFOUND'?'DNS_LOOKUP_FAILED':error.code==='ECONNREFUSED'?'CONNECTION_REFUSED':'CONNECTION_CLOSED'));
            client.once('close', () => {clients.delete(client); if (!finished && !settled) fail('CONNECTION_FAILED','CONNECTION_CLOSED');});
            client.once('ready', () => {
                clearCredentials(selected.credentials);
                if (!verified) return fail('HOST_KEY_REJECTED');
                let remoteCommand;
                try {remoteCommand=buildRemoteCommand(endpoint);} catch (error) {fail(error.code,error.gitFailure); return;}
                client.exec(remoteCommand,{pty:false},(error,stream) => {
                    if(error&&endpoint.service==='git-lfs-transfer'&&!signal.aborted&&!transportError) {
                        finished=true;socket.end(frame(3,Buffer.from([1])));client.end();return;
                    }
                    if (error || signal.aborted || transportError) {stream?.destroy(); fail('CONNECTION_FAILED','REMOTE_COMMAND_REJECTED'); return;}
                    channels.add(stream); let waiting=false, authBytes=0;const authChunks=[];
                    const send=(type,data) => {
                        if(type===1&&endpoint.service==='git-lfs-authenticate') {
                            authBytes+=data.length;if(authBytes>131072)return fail('CONNECTION_FAILED','REMOTE_COMMAND_REJECTED');
                            authChunks.push(data);return;
                        }
                        if (!socket.write(frame(type,data)) && !waiting) {
                            waiting=true; stream.pause(); stream.stderr.pause();
                            socket.once('drain',()=>{waiting=false; stream.resume(); stream.stderr.resume();});
                        }
                    };
                    stream.on('data',data=>send(1,data)); stream.stderr.on('data',data=>send(2,data));
                    stream.on('error',()=>fail('CONNECTION_FAILED'));
                    let exitCode=null;
                    stream.on('exit',code=>{exitCode=code;});
                    stream.once('close',()=>{
                        channels.delete(stream);
                        if (!Number.isInteger(exitCode)) return fail('CONNECTION_FAILED','REMOTE_EXIT_STATUS_MISSING');
                        if(endpoint.service==='git-lfs-authenticate'&&exitCode===0) {
                            try {
                                const body=Buffer.concat(authChunks),response=JSON.parse(body.toString('utf8')),url=new URL(response.href);
                                const fresh=authorize(endpoint.url,endpoint.direction==='upload'?'push':'fetch');clearCredentials(fresh.credentials);
                                const host=url.hostname.toLowerCase().replace(/^\[|]$/g,'');
                                ensure(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(host===fresh.profile.host.toLowerCase()&&Number(url.port||443)===443||
                                    (fresh.profile.policy.lfsHttpsOrigins||[]).some(value=>matches(origin(value),host,Number(url.port||443)))),'ACCESS_DENIED');
                                for(const value of Object.values(response.header||{})){ensure(typeof value==='string','CONNECTION_FAILED');redactions.add(value);}
                                socket.write(frame(1,body));
                            } catch {return fail('ACCESS_DENIED','LFS_HTTPS_DESTINATION_DENIED');}
                        }
                        finished=true; socket.end(frame(3,Buffer.from([exitCode===0?0:1]))); client.end();
                    });
                    socket.once('end',()=>stream.end());
                    socket.once('close',()=>{if (!finished && !settled) fail('CONNECTION_FAILED','CONNECTION_CLOSED');});
                    const remainder=header.subarray(end+1); if(remainder.length)stream.write(remainder);
                    socket.pipe(stream,{end:false}); socket.resume();
                });
            });
            const {profile}=selected;
            client.once('close',()=>clearCredentials(selected.credentials));
            try {client.connect({host:profile.host,port:profile.port,username:profile.username,...prepareSshCredentials(selected.credentials),readyTimeout:10000,
                hostVerifier:raw=>{verified=trusted(raw,profile.trustedHostKey); rejectedKey=!verified; return verified;}});}
            catch {clearCredentials(selected.credentials); fail('CONNECTION_FAILED');}
        };
        const onData=chunk=>{void authenticate(chunk).catch(()=>fail('CONNECTION_FAILED'));};
        socket.on('data',onData);
    });
    // The listener must be removable after the authentication header. Keep the
    // socket paused until the SSH channel is ready, including binary remainders.
    try {
        base=await resolveGitWorkingDirectory(plan.cwd);
        ensure(!signal.aborted,'ACCESS_DENIED');
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        signal.addEventListener('abort',abort,{once:true});
        ensure(!signal.aborted,'ACCESS_DENIED');
        timer=setTimeout(()=>fail('TIMEOUT'),Math.min(plan.timeoutMs||60000,60000));
        const env={PATH:process.env.PATH||'',SystemRoot:process.env.SystemRoot||'',HOME:temporary,USERPROFILE:temporary,
            TMPDIR:temporary,TMP:temporary,TEMP:temporary,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:path.join(temporary,'none'),
            GIT_CONFIG_GLOBAL:path.join(temporary,'none'),GIT_ALLOW_PROTOCOL:'ssh',GIT_PROTOCOL_FROM_USER:'0',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',
            GIT_EDITOR:':',GIT_SEQUENCE_EDITOR:':',GIT_MERGE_AUTOEDIT:'no',GIT_PAGER:'',PAGER:'',
            GIT_SSH_VARIANT:'ssh',ELECTRON_RUN_AS_NODE:'1',GIT_LFS_SKIP_SMUDGE:'1',GIT_LFS_FORCE_PROGRESS:'0',
            GIT_SSH_COMMAND:[executable,helperPath,String(server.address().port),token].map(value=>quote(value)).join(' ')};
        const safeSettings=['core.hooksPath='+temporary,'core.fsmonitor=false','protocol.allow=never','protocol.ssh.allow=always','protocol.version=0',
            'fetch.recurseSubmodules=false','submodule.recurse=false','maintenance.auto=false','gc.auto=0','core.askPass=', 'credential.helper=',
            'core.attributesFile='+path.join(temporary,'none'),'commit.gpgsign=false','merge.verifySignatures=false',
            'push.gpgsign=false','push.followTags=false','push.recurseSubmodules=no',
            'core.sshCommand='+env.GIT_SSH_COMMAND,'ssh.variant=ssh','init.templateDir='+temporary,
            'filter.lfs.process=','filter.lfs.clean=','filter.lfs.smudge=','filter.lfs.required=false','lfs.ssh.automultiplex=false'];
        const run=async(args,cwd=base,{privateOutput=false,settings=[],lfs=false}={})=>{
            if (transportError) throw transportError;
            ensure(!signal.aborted,'ACCESS_DENIED');
            let localCaptured=0; const local={stdout:'',stderr:''},decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
            const childEnv={...env};
            if(lfs) {
                const bundled=bundledGit(); childEnv.GIT_EXEC_PATH=bundled.execPath;
                childEnv.PATH=[...bundled.binPaths,env.PATH].join(path.delimiter);
                delete childEnv.GIT_LFS_SKIP_SMUDGE;
            }
            const result=await new Promise((resolve,reject)=>{
                child=spawn(plan.command,[...safeSettings.concat(settings).flatMap(value=>['-c',value]),...args],{cwd,env:childEnv,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
                child.once('error',error=>reject(Object.assign(failure('UNAVAILABLE'),{gitFailure:error.code==='ENOENT'?'GIT_EXECUTABLE_OR_CWD_MISSING':['EACCES','EPERM'].includes(error.code)?'GIT_EXECUTABLE_NOT_PERMITTED':undefined})));
                for(const name of ['stdout','stderr'])child[name].on('data',data=>{
                    const remaining=Math.max(0,1048576-(privateOutput?localCaptured:captured)),retained=data.subarray(0,remaining);
                    localCaptured+=retained.length;if(!privateOutput)captured+=retained.length;
                    if(retained.length<data.length){if(privateOutput)fail('INVALID_REQUEST','UNSAFE_REPOSITORY_CONFIG');else truncated=true;}
                    local[name]+=decoders[name].write(retained);
                });
                child.once('close',code=>{
                    child=undefined;
                    if(transportError)return reject(transportError);
                    for(const name of ['stdout','stderr'])local[name]+=decoders[name].end();
                    resolve({exitCode:Number.isInteger(code)?code:null,...local});
                });
            });
            if(!privateOutput)for(const name of ['stdout','stderr'])output[name]+=result[name];
            return result;
        };
        const configAt=async cwd=>{
            const result=await run(['config','--null','--list','--no-includes'],cwd,{privateOutput:true});
            if(result.exitCode!==0)throw invalid('UNSAFE_REPOSITORY_CONFIG');
            const config=configuration(Buffer.from(result.stdout));checkConfiguration(config);
            if(config.has('core.worktree')) {
                const root=await run(['rev-parse','--show-toplevel'],cwd,{privateOutput:true});
                if(root.exitCode!==0||await fs.realpath(root.stdout.trim())!==await fs.realpath(cwd))throw invalid('UNSAFE_REPOSITORY_CONFIG');
            }
            return config;
        };
        const config=await configAt(base);
        const {operation,subcommand,options,rest,policyOperation}=invocation;
        let url=invocation.remote;
        if(url&&!url.includes('@')&&!url.startsWith('ssh://'))url=remote(config,url,policyOperation==='push');
        if(url){const authorized=authorize(url,policyOperation);clearCredentials(authorized.credentials);url=canonical(url);}
        const settings=[];
        if(invocation.remote&&!invocation.remote.includes('@')&&!invocation.remote.startsWith('ssh://')) {
            settings.push(`remote.${invocation.remote}.url=${url}`,`remote.${invocation.remote}.pushurl=${url}`,`remote.${invocation.remote}.mirror=false`);
        }
        const inspectModules=async(cwd,parent)=>{
            let info;try{info=await fs.lstat(path.join(cwd,'.gitmodules'));}catch(error){if(error.code==='ENOENT')return [];throw invalid('UNSAFE_REPOSITORY_CONFIG');}
            if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw invalid('UNSAFE_REPOSITORY_CONFIG');
            const result=await run(['config','--null','--file','.gitmodules','--list','--no-includes'],cwd,{privateOutput:true});
            if(result.exitCode!==0)throw invalid('UNSAFE_REPOSITORY_CONFIG');
            const cfg=configuration(Buffer.from(result.stdout));checkConfiguration(cfg);
            const modules=submodules(cfg,parent);
            for(const module of modules) {
                let parent=cwd;
                for(const segment of module.path.split('/')) {
                    parent=path.join(parent,segment);
                    let stat;
                    try {stat=await fs.lstat(parent);}
                    catch(error){if(error.code==='ENOENT')break;throw error;}
                    if(stat.isSymbolicLink()||!stat.isDirectory())throw invalid('UNSAFE_REPOSITORY_CONFIG');
                }
            }
            return modules;
        };
        let inspected=0;
        const inspectTree=async(cwd,parent,depth=0)=>{
            if(depth>8||++inspected>128)throw invalid('UNSAFE_REPOSITORY_CONFIG');
            await configAt(cwd);
            for(const module of await inspectModules(cwd,parent)) {
                let child;try{child=await childDirectory(cwd,module.path);await fs.access(path.join(child,'.git'));}catch{continue;}
                await inspectTree(child,module.url,depth+1);
            }
        };
        let parent=url;
        if(!parent&&operation==='submodule')parent=remote(config,'origin');
        if(operation==='submodule') {
            await inspectTree(base,parent);
            const modules=await inspectModules(base,parent);
            for(const module of modules){const approved=authorize(module.url,subcommand==='add'?'clone':'fetch');clearCredentials(approved.credentials);}
        }
        let result;
        const runLfs=async(cwd,repository,command,refs=[],lfsOptions=[])=>{
            const permitted=authorize(repository,command==='push'?'push':'fetch');clearCredentials(permitted.credentials);
            proxy=await createLfsProxy({signal,authorize:(host,port)=>{
                const fresh=authorize(repository,command==='push'?'push':'fetch'); clearCredentials(fresh.credentials);
                return (host.toLowerCase()===fresh.profile.host.toLowerCase()&&port===443)||
                    (fresh.profile.policy.lfsHttpsOrigins||[]).some(value=>matches(origin(value),host.toLowerCase(),port));
            }});
            try {
                const lfsSettings=['lfs.url='+canonical(repository),'lfs.pushurl='+canonical(repository),'lfs.concurrenttransfers=3','lfs.transfer.maxretries=0','lfs.locksverify=false',
                    'http.proxy='+proxy.url,'http.sslVerify=true','http.followRedirects=false','http.extraHeader=','lfs.basictransfersonly=false'];
                const lfs=quote(path.join(bundledGit().execPath,process.platform==='win32'?'git-lfs.exe':'git-lfs'));
                lfsSettings.push('filter.lfs.process='+lfs+' filter-process','filter.lfs.clean='+lfs+' clean -- %f',
                    'filter.lfs.smudge='+lfs+' smudge -- %f','filter.lfs.required=true');
                const args=['lfs',command,...lfsOptions,...(['fetch','pull','push'].includes(command)?[canonical(repository)]:[]),...refs];
                const value=await run(args,cwd,{settings:lfsSettings,lfs:true});
                if(proxy.wasDenied())throw Object.assign(failure('ACCESS_DENIED'),{gitFailure:'LFS_HTTPS_DESTINATION_DENIED'});
                return value;
            } finally {await proxy.close();proxy=undefined;}
        };
        const hydrate=async(cwd,repository,depth=0)=>{
            if(depth>8)throw invalid('UNSAFE_REPOSITORY_CONFIG');
            await configAt(cwd);
            const pointers=await run(['grep','-l','--cached','--fixed-strings','version https://git-lfs.github.com/spec/v1'],cwd,{privateOutput:true});
            if(pointers.exitCode===0){const value=await runLfs(cwd,repository,'pull');if(value.exitCode!==0)return value;}
            for(const module of await inspectModules(cwd,repository)) {
                let child;try{child=await childDirectory(cwd,module.path);await fs.access(path.join(child,'.git'));}catch{continue;}
                const value=await hydrate(child,module.url,depth+1);if(value?.exitCode)return value;
            }
            return null;
        };
        if(operation==='lfs') {
            const repository=url||remote(config,'origin');
            result=await runLfs(base,repository,subcommand,rest,options);
        } else {
            // Hooks are disabled. Upload LFS objects explicitly before a push,
            // using the same independently authorized repository and profile.
            if(operation==='push'&&!options.includes('--dry-run')) {
                const pointers=await run(['grep','-l','--cached','--fixed-strings','version https://git-lfs.github.com/spec/v1'],base,{privateOutput:true});
                if(pointers.exitCode===0){const value=await runLfs(base,url,'push',rest.map(ref=>ref.split(':')[0]));if(value.exitCode!==0)result=value;}
            }
            if(!result) {
                const args=[operation,...(subcommand?[subcommand]:[]),...options,...(invocation.remote?[invocation.remote.includes('@')||invocation.remote.startsWith('ssh://')?url:invocation.remote]:[]),...rest];
                result=await run(args,base,{settings});
            }
            if(result.exitCode===0&&['clone','pull','submodule'].includes(operation)&&!options.includes('--bare')&&!options.includes('--no-checkout')) {
                const cwd=operation==='clone'?await childDirectory(base,rest[0]):base;
                const hydrated=await hydrate(cwd,url||parent);if(hydrated?.exitCode)result=hydrated;
            }
        }
        return {exitCode:result.exitCode,stdout:Buffer.from(redact(output.stdout)),stderr:Buffer.from(redact(output.stderr)),timedOut:false,truncated};
    } catch(error) {throw Object.assign(failure(error?.code),{gitFailure:error?.gitFailure});}
    finally {
        settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
        child?.kill('SIGKILL');for(const channel of channels)channel.destroy();for(const client of clients)client.destroy();for(const socket of sockets)socket.destroy();
        await proxy?.close();await new Promise(resolve=>server.close(resolve));await fs.rm(temporary,{recursive:true,force:true});clearCredentials(credentials);clearCredentials(selection?.credentials);
    }
}
module.exports={runGitTransport,quote,frame};
