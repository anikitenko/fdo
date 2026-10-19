/** @jest-environment node */
const {Server,Client,utils}=require('ssh2');
const {fingerprint}=require('../../src/utils/hostServices/ssh.cjs');
const {createHostService}=require('../../src/utils/hostServices/service.cjs');
const {CAPABILITIES}=require('../../src/utils/hostServices/contracts.cjs');
const {validateTerminalOptions,decodeTerminalBytes}=require('../../src/utils/hostServices/terminalService.cjs');
const config={profileId:'vm',term:'xterm-256color',rows:24,columns:80,idleTimeoutMs:2000,sessionTimeoutMs:5000};
async function fixture(run,{onX11=()=>{}}={}){
 const pair=utils.generateKeyPairSync('ed25519'),connections=new Set();let shellCount=0,dimensions;
 const server=new Server({hostKeys:[pair.private]},connection=>{
  connections.add(connection);connection.on('error',()=>{});connection.on('close',()=>connections.delete(connection));
  connection.on('authentication',context=>context.method==='password'&&context.password==='terminal private fixture'?context.accept():context.reject());
  connection.on('ready',()=>connection.on('session',accept=>{
   const session=accept();session.on('x11',accept=>{onX11();accept();});session.on('pty',(accept,_reject,info)=>{dimensions=info;accept();});
   session.on('window-change',(accept,_reject,info)=>{dimensions=info;accept?.();});
   session.on('shell',accept=>{shellCount++;const stream=accept();stream.on('error',()=>{});stream.write(Buffer.from([0xe2]));stream.write(Buffer.from([0x82,0xac,0x1b,0x5b,0x32,0x4a]));stream.on('data',chunk=>{if(chunk.toString()==='exit\r'){stream.exit(7);stream.end();}else stream.write(chunk);});});
  }));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile={id:'vm',label:'VM',host:'127.0.0.1',port:server.address().port,username:'test',trustedHostKey:fingerprint(utils.parseKey(pair.private).getPublicSSH()),authentication:{type:'password',passwordRef:{kind:'secret',key:'password'}},policy:{consumers:['ssh.terminal.open'],commands:[],x11Modes:[]}};
 const grants={a:[...CAPABILITIES],b:[...CAPABILITIES]},audits=[];
 const displays={supportedModes:[],prepare:()=>Promise.reject({code:'X11_UNAVAILABLE'})};
 const service=createHostService({Client,displays,getGrants:id=>grants[id],isInstalled:id=>!!grants[id],audit:(...args)=>audits.push(args),vault:{profile:()=>structuredClone(profile),get:()=> 'terminal private fixture',close(){}}});
 service.viewLease('window','a','view-a',true);service.viewLease('window','b','view-b',true);
 const a=service.bind('a'),b=service.bind('b');
 try{await run({a,b,service,grants,profile,audits,displays,shellCount:()=>shellCount,dimensions:()=>dimensions});}
 finally{a.close();b.close();await service.close();for(const connection of connections)connection.end();await new Promise(resolve=>server.close(resolve));}
}
test('PTY bytes, input, resize, exit and idempotent cleanup use pinned builtin SSH',()=>fixture(async({a,b,audits,dimensions})=>{
 const handle=await a.operation('terminal.open',config),result=a.operation('terminal.result',handle);result.catch(()=>{});
 await expect(b.operation('terminal.next',handle)).rejects.toMatchObject({code:'ACCESS_DENIED'});
 await expect(a.operation('next',handle)).rejects.toMatchObject({code:'ACCESS_DENIED'});
 const chunks=[];while(Buffer.concat(chunks).length<7){const packet=await a.operation('terminal.next',handle);chunks.push(Buffer.from(packet.value.dataBase64,'base64'));}
 expect(Buffer.concat(chunks).toString()).toBe('€\x1b[2J');
 expect(dimensions()).toMatchObject({rows:24,cols:80});
 await a.operation('terminal.resize',{...handle,rows:40,columns:100});
 await a.operation('terminal.write',{...handle,dataBase64:Buffer.from('hello\r').toString('base64')});
 const echoed=await a.operation('terminal.next',handle);expect(Buffer.from(echoed.value.dataBase64,'base64').toString()).toBe('hello\r');
 await a.operation('terminal.write',{...handle,dataBase64:Buffer.from('exit\r').toString('base64')});
 expect(await result).toEqual({reason:'exited',exitCode:7,signal:null,remoteProcessStopped:true});
 expect(await a.operation('terminal.cancel',handle)).toEqual({remoteProcessStopped:null});
 expect(await a.operation('terminal.close',handle)).toEqual({closed:true});
 expect(JSON.stringify(audits)).not.toMatch(/terminal private fixture|hello|password/);
}),15000);
test.each(['ssh.use','ssh.terminal.open','secrets.use','secrets.consume'])('missing %s never opens a shell',capability=>fixture(async({a,grants,shellCount})=>{
 grants.a=grants.a.filter(value=>value!==capability);await expect(a.operation('terminal.open',config)).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(shellCount()).toBe(0);
}),15000);
test.each(['ssh.exec','git'])('%s consumer does not authorize interactive input',consumer=>fixture(async({a,profile,shellCount})=>{profile.policy.consumers=[consumer];await expect(a.operation('terminal.open',config)).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(shellCount()).toBe(0);}),15000);
test('key mismatch and X11 denial fail closed before shell start',()=>fixture(async({a,profile,shellCount})=>{
 await expect(a.operation('terminal.open',{...config,x11:{mode:'trusted'}})).rejects.toMatchObject({code:'ACCESS_DENIED'});
 profile.policy.x11Modes=['untrusted'];await expect(a.operation('terminal.open',{...config,x11:{mode:'untrusted'}})).rejects.toMatchObject({code:'X11_UNAVAILABLE'});
 profile.trustedHostKey=fingerprint(Buffer.from('other key'));await expect(a.operation('terminal.open',config)).rejects.toMatchObject({code:'HOST_KEY_REJECTED'});expect(shellCount()).toBe(0);
}),15000);
test('revocation and authenticated view release wake pending readers and results',()=>fixture(async({a,service,grants})=>{
 const handle=await a.operation('terminal.open',config);const result=a.operation('terminal.result',handle);result.catch(()=>{});
 await a.operation('terminal.next',handle);await a.operation('terminal.next',handle);
 const next=a.operation('terminal.next',handle);next.catch(()=>{});
 grants.a=[];service.cancel('a');await expect(result).rejects.toMatchObject({code:'ACCESS_DENIED'});await expect(next).rejects.toMatchObject({code:'ACCESS_DENIED'});
 grants.a=[...CAPABILITIES];const another=await a.operation('terminal.open',config);const ended=a.operation('terminal.result',another);ended.catch(()=>{});
 service.viewLease('window','a','view-a',false);await expect(ended).rejects.toMatchObject({code:'SESSION_CLOSED'});
 await expect(a.operation('terminal.open',config)).rejects.toMatchObject({code:'SESSION_CLOSED'});
}),15000);
test('terminal quota is bounded while sessions remain active',()=>fixture(async({a})=>{
 for(let index=0;index<4;index++)await a.operation('terminal.open',{...config,idleTimeoutMs:30000,sessionTimeoutMs:60000});
 await expect(a.operation('terminal.open',config)).rejects.toMatchObject({code:'SESSION_LIMIT'});
}),15000);
test('idle timeout is independent of unread remote output',()=>fixture(async({a})=>{
 const handle=await a.operation('terminal.open',{...config,idleTimeoutMs:300});
 await expect(a.operation('terminal.result',handle)).rejects.toMatchObject({code:'IDLE_TIMEOUT'});
}),15000);
test.each(['Zg=','Zh==','a'.repeat(43696),'%%%'])('rejects malformed or noncanonical base64',value=>expect(()=>decodeTerminalBytes(value)).toThrow());
test('validates exact option fields and clamps host time ceilings',()=>{
 expect(()=>validateTerminalOptions({...config,pluginId:'forged'})).toThrow();
 expect(()=>validateTerminalOptions({...config,x11:{mode:'trusted',display:':0'}})).toThrow();
 expect(validateTerminalOptions({...config,idleTimeoutMs:3600000,sessionTimeoutMs:86400000})).toMatchObject({idleTimeoutMs:300000,sessionTimeoutMs:3600000});
});

test('shutdown owns and awaits opening sessions, disposing a late display without creating an SSH client',async()=>{
 const {createTerminalService}=require('../../src/utils/hostServices/terminalService.cjs');
 let resolveDisplay;const dispose=jest.fn(),Client=jest.fn();
 const terminals=createTerminalService({Client,authorize:()=>({profile:{policy:{}},credentials:{password:'fixture'}}),getViewLease:()=>({valid:()=>true}),displays:{prepare:()=>new Promise(resolve=>{resolveDisplay=resolve;})}});
 const endpoint=terminals.bind('a');const opening=endpoint.operation('terminal.open',{...config,x11:{mode:'trusted'}},'open');opening.catch(()=>{});
 let closed=false;const closing=terminals.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 resolveDisplay({dispose});await expect(opening).rejects.toMatchObject({code:'UNAVAILABLE'});await closing;
 expect(dispose).toHaveBeenCalled();expect(Client).not.toHaveBeenCalled();endpoint.close();
});


test('untrusted X11 requires the separate X11 grant and exact profile-mode consent before preflight',()=>fixture(async({a,profile,grants,shellCount})=>{
 profile.policy.x11Modes=['trusted'];await expect(a.operation('terminal.open',{...config,x11:{mode:'untrusted'}})).rejects.toMatchObject({code:'ACCESS_DENIED'});
 profile.policy.x11Modes=['untrusted'];grants.a=grants.a.filter(value=>value!=='ssh.x11.forward');
 await expect(a.operation('terminal.open',{...config,x11:{mode:'untrusted'}})).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(shellCount()).toBe(0);
}),15000);

test('authorization expiry ends an idle SSH terminal and shutdown awaits asynchronous display revocation',()=>fixture(async({a,profile,displays,service})=>{
 const controller=new AbortController();let finish;const disposing=new Promise(resolve=>{finish=resolve;});
 displays.prepare=async()=>({screen:0,cookie:Buffer.alloc(16,0x21),securityAuthorization:'untrusted',signal:controller.signal,isCurrent:()=>!controller.signal.aborted,connect:()=>Promise.reject(new Error('not requested')),dispose:()=>disposing});
 profile.policy.x11Modes=['untrusted'];const handle=await a.operation('terminal.open',{...config,x11:{mode:'untrusted'}});
 const result=a.operation('terminal.result',handle);result.catch(()=>{});controller.abort();
 let closed=false;const closing=service.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);finish();await closing;
 await expect(result).rejects.toMatchObject({code:expect.stringMatching(/X11_AUTH_UNAVAILABLE|UNAVAILABLE/)});
}),15000);

test('same-user sshd authority updates during X11 negotiation preserve the terminal; local credential rotation still closes it',async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
 const {createLocalDisplays}=require('../../src/utils/hostServices/localDisplay.cjs');
 const {authorityRecord}=require('../fixtures/xAuthority.cjs');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-terminal-authority-')),authority=path.join(directory,'authority'),record=authorityRecord();
 fs.writeFileSync(authority,record);
 try{await fixture(async({a,profile,displays})=>{
  displays.prepare=async()=>{
   const original=fs.existsSync,exists=jest.spyOn(fs,'existsSync').mockImplementation(file=>file==='/opt/X11/bin/xauth'||original(file));
   try{return await createLocalDisplays({platform:'darwin',env:{DISPLAY:':0',XAUTHORITY:authority},
    execute:(_file,_args,_options,callback)=>callback(null,record.toString('hex')),
    connect:()=>{const socket=new EventEmitter();socket.destroy=()=>{};socket.write=(_packet,done)=>{done();queueMicrotask(()=>socket.emit('data',Buffer.from([1])));};queueMicrotask(()=>socket.emit('connect'));return socket;},
   }).prepare('trusted');}finally{exists.mockRestore();}
  };
  profile.policy.x11Modes=['trusted'];
  const handle=await a.operation('terminal.open',{...config,x11:{mode:'trusted'}});
  expect(await a.operation('terminal.next',handle)).toMatchObject({done:false});
  fs.writeFileSync(authority,authorityRecord({cookie:Buffer.alloc(16,0x55)}));
  await expect(a.operation('terminal.resize',{...handle,rows:30,columns:90})).rejects.toMatchObject({code:'X11_UNAVAILABLE'});
 },{onX11:()=>{
  fs.writeFileSync(authority+'.new',Buffer.concat([record,authorityRecord({number:'10',cookie:Buffer.alloc(16,0x44)})]));
  fs.renameSync(authority+'.new',authority);
 }});}finally{fs.rmSync(directory,{recursive:true,force:true});}
},15000);
