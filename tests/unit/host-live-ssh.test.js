/** @jest-environment node */
const {test,expect}=require('@jest/globals');
const {Client,Server}=require('ssh2');
const {createHostService}=require('../../src/utils/hostServices/service.cjs');
const {fingerprint}=require('../../src/utils/hostServices/ssh.cjs');
const {CAPABILITIES}=require('../../src/utils/hostServices/contracts.cjs');
const {generateEd25519}=require('../../src/utils/hostServices/sshKeys.cjs');
const key=generateEd25519();

async function fixture(run) {
    const connections=new Set(),timers=new Set();let commands=0,authentications=0;
    const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);};
    const server=new Server({hostKeys:[key.private]},connection=>{
        connections.add(connection);connection.on('error',()=>{});connection.on('close',()=>connections.delete(connection));
        connection.on('authentication',context=>context.method==='password'&&context.password==='private fixture credential'?context.accept():context.reject());
        connection.on('ready',()=>{authentications++;connection.on('session',accept=>{
            const session=accept();session.on('exec',(acceptCommand,_reject,info)=>{
                commands++;const stream=acceptCommand();stream.on('error',()=>{});
                if(info.command==='hang')return;
                if(info.command==='utf8') {
                    stream.write(Buffer.from([0xe2]));later(()=>stream.write(Buffer.from([0x82,0xac,0xff])),10);
                    later(()=>{stream.stderr.write('err');stream.exit(7);stream.end();},30);return;
                }
                stream.write('first\n');
                later(()=>stream.stderr.write('warning\n'),30);
                later(()=>{stream.write('last\n');stream.exit(7);stream.end();},200);
            });
        });});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const profile={id:'vm',label:'VM',host:'127.0.0.1',port:server.address().port,username:'fixture',trustedHostKey:fingerprint(key.publicSSH),authentication:{type:'password',passwordRef:{kind:'secret',key:'password'}},policy:{consumers:['ssh.exec'],commands:['live','hang','utf8']}};
    const grants={a:[...CAPABILITIES],b:[...CAPABILITIES]};
    const audit=[];
    const service=createHostService({Client,isInstalled:id=>Object.hasOwn(grants,id),getGrants:id=>grants[id],audit:(...args)=>audit.push(args),vault:{profile:()=>structuredClone(profile),get:()=> 'private fixture credential',close(){}}});
    const a=service.bind('a'),b=service.bind('b');
    const start=(command='live',extra={})=>a.operation('start',{profileId:'vm',command,timeoutMs:2000,maxOutputBytes:1024,...extra});
    try{await run({a,b,start,grants,profile,service,audit,commands:()=>commands,authentications:()=>authentications});}
    finally{a.close();b.close();await service.close();for(const timer of timers)clearTimeout(timer);for(const connection of connections)connection.end();await new Promise(resolve=>server.close(resolve));}
}

test('live output precedes completion, matches the buffered result and has contiguous cross-stream sequences',()=>fixture(async({a,start,audit})=>{
    const {handle}=await start();let complete=false;const resultPromise=a.operation('result',{handle}).then(value=>{complete=true;return value;});
    const first=await a.operation('next',{handle});expect(complete).toBe(false);expect(first.value).toMatchObject({sequence:0,stream:'stdout',data:'first\n'});
    const events=[first.value];while(true){const next=await a.operation('next',{handle});if(next.done)break;events.push(next.value);}
    const result=await resultPromise;
    expect(events.map(event=>event.sequence)).toEqual(events.map((_,i)=>i));
    expect(events.filter(event=>event.stream==='stdout').map(event=>event.data).join('')).toBe(result.stdout);
    expect(events.filter(event=>event.stream==='stderr').map(event=>event.data).join('')).toBe(result.stderr);
    expect(result).toMatchObject({exitCode:7,truncated:false});
    expect(JSON.stringify(audit)).not.toMatch(/private fixture credential|first\\n|warning/);
    expect(await a.operation('cancel',{handle})).toEqual({remoteProcessStopped:null});
    expect(await a.operation('result',{handle})).toEqual(result);
}),15000);

test.each([4,8,64])('UTF-8 split/malformed input respects one encoded live/final byte budget of %s',cap=>fixture(async({a,start})=>{
    const {handle}=await start('utf8',{maxOutputBytes:cap});const resultPromise=a.operation('result',{handle});const events=[];
    while(true){const next=await a.operation('next',{handle});if(next.done)break;events.push(next.value);}
    const result=await resultPromise;
    expect(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(cap);
    expect(events.reduce((size,event)=>size+Buffer.byteLength(event.data),0)).toBeLessThanOrEqual(cap);
    expect(result.stdout).toContain('€');
    if(cap<9)expect(result.truncated).toBe(true);
    else expect(result).toMatchObject({stdout:'€�',stderr:'err',exitCode:7});
}),15000);

test('cancel is idempotent, never claims remote termination, and timeout remains a separate failure',()=>fixture(async({a,start})=>{
    const {handle}=await start('hang');const result=a.operation('result',{handle});const outcome=expect(result).rejects.toMatchObject({code:'CANCELLED'});
    const waiting=a.operation('next',{handle});const end=expect(waiting).rejects.toMatchObject({code:'CANCELLED'});
    expect(await a.operation('cancel',{handle})).toEqual({remoteProcessStopped:null});
    expect(await a.operation('cancel',{handle})).toEqual({remoteProcessStopped:null});await outcome;await end;
    const timeout=await start('hang',{timeoutMs:30});await expect(a.operation('result',timeout)).rejects.toMatchObject({code:'TIMEOUT'});
}),15000);

test('closing output leaves bounded capture running, and handles cannot cross worker/plugin namespaces',()=>fixture(async({a,b,start})=>{
    const {handle}=await start();await expect(b.operation('cancel',{handle})).rejects.toMatchObject({code:'ACCESS_DENIED'});
    await a.operation('return',{handle});const result=await a.operation('result',{handle});
    expect(result).toMatchObject({stdout:'first\nlast\n',stderr:'warning\n',truncated:false});
    await expect(a.operation('start',{profileId:'vm',command:'unauthorized',timeoutMs:20,maxOutputBytes:20})).rejects.toMatchObject({code:'ACCESS_DENIED'});
}),15000);

test('status is an authenticated fresh observation without shell probes; shared monitors stop on unsubscribe/revocation',()=>fixture(async({a,b,service,commands,authentications,grants})=>{
    const first=await a.operation('watch',{profileId:'vm'});const second=await a.operation('watch',{profileId:'vm'});
    expect((await a.operation('next',first)).value).toMatchObject({state:'unknown',checkedAt:null});
    let status;do{status=(await a.operation('next',first)).value;}while(status.state!=='connected');
    expect(Date.now()-Date.parse(status.checkedAt)).toBeLessThan(status.staleAfterMs);
    expect(commands()).toBe(0);expect(authentications()).toBe(1);
    await a.operation('return',first);
    await expect(b.operation('next',second)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    grants.a=grants.a.filter(value=>value!=='ssh.status.watch');service.cancel('a');
    await expect(a.operation('next',second)).rejects.toMatchObject({code:'ACCESS_DENIED'});
}),15000);

test.each(['ssh.use','ssh.exec','secrets.use','secrets.consume'])('streaming requires independent %s grant',missing=>fixture(async({start,grants})=>{
    grants.a=grants.a.filter(value=>value!==missing);await expect(start()).rejects.toMatchObject({code:'ACCESS_DENIED'});
}),15000);

test.each(['ssh.use','ssh.status.watch','secrets.use','secrets.consume'])('monitoring requires independent %s grant',missing=>fixture(async({a,grants})=>{
    grants.a=grants.a.filter(value=>value!==missing);await expect(a.operation('watch',{profileId:'vm'})).rejects.toMatchObject({code:'ACCESS_DENIED'});
}),15000);

test('active revocation wakes output/result and Git-only profiles cannot be monitored',()=>fixture(async({a,start,service,profile})=>{
    const {handle}=await start('hang');const result=expect(a.operation('result',{handle})).rejects.toMatchObject({code:'ACCESS_DENIED'});
    const next=expect(a.operation('next',{handle})).rejects.toMatchObject({code:'ACCESS_DENIED'});
    service.cancel('a');await result;await next;
    profile.policy.consumers=['git'];await expect(a.operation('watch',{profileId:'vm'})).rejects.toMatchObject({code:'ACCESS_DENIED'});
}),15000);
