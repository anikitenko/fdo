/** @jest-environment node */
const {createLocalDisplays}=require('../../src/utils/hostServices/localDisplay.cjs');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {authorityRecord}=require('../fixtures/xAuthority.cjs');
let directory,authority;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-local-display-'));authority=path.join(directory,'authority');});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
test.each(['remote.example:0','$(touch /tmp/no):0','127.0.0.1:65535',''])('rejects unsafe or unsupported display %s before executing tools',async DISPLAY=>{
 const execute=jest.fn();await expect(createLocalDisplays({platform:'linux',env:{DISPLAY},execute}).prepare('trusted')).rejects.toHaveProperty('code');expect(execute).not.toHaveBeenCalled();
});
test('untrusted mode requires local preflight and Windows display discovery remains unsupported',async()=>{
 await expect(createLocalDisplays({env:{}}).prepare('untrusted')).rejects.toMatchObject({code:'X11_UNAVAILABLE'});
 expect(createLocalDisplays({platform:'win32'}).supportedModes).toEqual([]);
});
test('host-owned fixed xauth lookup and authenticated X11 preflight preserve cookie secrecy',async()=>{
 const fs=require('node:fs');const exists=jest.spyOn(fs,'existsSync').mockReturnValue(true);
 let setup;const sockets=[];const connect=jest.fn(()=>{
  const socket=new EventEmitter();socket.destroy=jest.fn();socket.write=(packet,done)=>{setup=Buffer.from(packet);done();queueMicrotask(()=>socket.emit('data',Buffer.from([1])));};sockets.push(socket);queueMicrotask(()=>socket.emit('connect'));return socket;
 });
 const execute=jest.fn((_file,_args,_opts,callback)=>callback(null,authorityRecord({number:'1'}).toString('hex')));
 const record=authorityRecord({number:'1'});fs.writeFileSync(authority,record);
 const env={DISPLAY:':1.0',XAUTHORITY:authority};
 try{
  const local=await createLocalDisplays({platform:'linux',env,execute,connect}).prepare('trusted');
  expect(execute.mock.calls[0].slice(0,2)).toEqual(['/usr/bin/xauth',['nlist',':1.0']]);
  expect(connect).toHaveBeenCalledWith({path:'/tmp/.X11-unix/X1'});expect(setup.subarray(32)).toEqual(Buffer.alloc(16,0x21));
  expect(sockets[0].destroy).toHaveBeenCalled();expect(local.isCurrent()).toBe(true);env.DISPLAY=':2';expect(local.isCurrent()).toBe(false);
  local.dispose();expect(local.cookie).toEqual(Buffer.alloc(16));
 }finally{exists.mockRestore();}
});
test.each(['/var/run/com.apple.launchd.Abc123/org.xquartz:0','/private/var/run/com.apple.launchd.Abc123/org.xquartz:0.0','/private/tmp/com.apple.launchd.Abc123/org.xquartz:0'])('XQuartz %s uses canonical xauth and the direct socket, never the trusted launchd handoff',async DISPLAY=>{
 const fs=require('node:fs');const exists=jest.spyOn(fs,'existsSync').mockReturnValue(true);
 const connect=jest.fn(()=>{
  const socket=new EventEmitter();socket.destroy=jest.fn();socket.write=(_packet,done)=>{done();queueMicrotask(()=>socket.emit('data',Buffer.from([1])));};queueMicrotask(()=>socket.emit('connect'));return socket;
 });
 const execute=jest.fn((_file,_args,_opts,callback)=>callback(null,authorityRecord().toString('hex')));
 try{
  fs.writeFileSync(authority,authorityRecord());
  const local=await createLocalDisplays({platform:'darwin',env:{DISPLAY,XAUTHORITY:authority},execute,connect}).prepare('trusted');
  expect(execute.mock.calls[0].slice(0,2)).toEqual(['/opt/X11/bin/xauth',['nlist',':0']]);
  expect(connect).toHaveBeenCalledWith({path:'/tmp/.X11-unix/X0'});local.dispose();
 }finally{exists.mockRestore();}
});
test('unsupported display addresses have a distinct safe reason rather than implying SECURITY failure',async()=>{
 const result=await createLocalDisplays({platform:'darwin',env:{DISPLAY:'remote.example:0'}}).checkAvailability();
 expect(result.trusted).toEqual({available:false,code:'X11_UNSUPPORTED',reason:'DISPLAY_FORMAT_UNSUPPORTED'});
 expect(result.untrusted).toEqual(result.trusted);
});

async function authorizationFixture(){
 const record=authorityRecord();fs.writeFileSync(authority,record);
 const env={DISPLAY:':0',XAUTHORITY:authority};
 const connect=()=>{const socket=new EventEmitter();socket.destroy=jest.fn();socket.write=(_packet,done)=>{done();queueMicrotask(()=>socket.emit('data',Buffer.from([1])));};queueMicrotask(()=>socket.emit('connect'));return socket;};
 const existsSync=fs.existsSync;
 const exists=jest.spyOn(fs,'existsSync').mockImplementation(file=>file==='/opt/X11/bin/xauth'||existsSync(file));
 let local;
 try{local=await createLocalDisplays({platform:'darwin',env,execute:(_file,_args,_opts,callback)=>callback(null,record.toString('hex')),connect}).prepare('trusted');}
 finally{exists.mockRestore();}
 return {local,env,record};
}
test('touching, adding unrelated sshd entries, and atomic database replacement preserve selected authorization',async()=>{
 const {local,record}=await authorizationFixture();
 try{
  const info=fs.statSync(authority);fs.utimesSync(authority,info.atime,new Date(info.mtimeMs+1000));expect(local.isCurrent()).toBe(true);
  const extra=authorityRecord({number:'10',cookie:Buffer.alloc(16,0x44)});
  fs.appendFileSync(authority,extra);expect(local.isCurrent()).toBe(true);
  fs.writeFileSync(authority+'.new',Buffer.concat([extra,record]));fs.renameSync(authority+'.new',authority);expect(local.isCurrent()).toBe(true);
  fs.writeFileSync(authority,record);expect(local.isCurrent()).toBe(true);
 }finally{local.dispose();}
});
test.each(['rotate','remove','delete','truncate','duplicate','oversize','directory'])('selected authorization %s revokes access and cannot resurrect the old handle',async change=>{
 const {local,record}=await authorizationFixture();
 try{
  if(change==='rotate')fs.writeFileSync(authority,authorityRecord({cookie:Buffer.alloc(16,0x55)}));
  if(change==='remove')fs.writeFileSync(authority,authorityRecord({number:'10'}));
  if(change==='delete')fs.unlinkSync(authority);
  if(change==='truncate')fs.writeFileSync(authority,record.subarray(0,record.length-1));
  if(change==='duplicate')fs.writeFileSync(authority,Buffer.concat([record,record]));
  if(change==='oversize')fs.writeFileSync(authority,Buffer.alloc(1024*1024+1));
  if(change==='directory'){fs.unlinkSync(authority);fs.mkdirSync(authority);}
  expect(local.isCurrent()).toBe(false);await expect(local.connect()).rejects.toMatchObject({code:'X11_AUTH_UNAVAILABLE'});
  if(change==='directory')fs.rmdirSync(authority);
  fs.writeFileSync(authority,record);expect(local.isCurrent()).toBe(false);
 }finally{local.dispose();}
});
test.each(['DISPLAY','XAUTHORITY'])('changing %s invalidates the owned display',async key=>{
 const {local,env}=await authorizationFixture();try{env[key]+='changed';expect(local.isCurrent()).toBe(false);}finally{local.dispose();}
});
test('rotation is detected even with the original inode, size and mtime',async()=>{
 const {local}=await authorizationFixture();try{
  const info=fs.statSync(authority);fs.writeFileSync(authority,authorityRecord({cookie:Buffer.alloc(16,0x55)}));fs.utimesSync(authority,info.atime,info.mtime);
  expect(local.isCurrent()).toBe(false);
 }finally{local.dispose();}
});
