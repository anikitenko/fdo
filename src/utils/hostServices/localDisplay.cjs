const fs=require('node:fs');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {createRestrictedDisplay}=require('./x11Security.cjs');
const {ensure,failure}=require('./contracts.cjs');
const {selection,authorizationMatches}=require('./xAuthority.cjs');
// No shell, plugin-controlled paths, public TCP listeners, xhost, or trust fallback.
function createLocalDisplays({env=process.env,platform=process.platform,execute=execFile,connect=net.createConnection}={}) {
 const descriptor=()=>{
  const display=env.DISPLAY;
  if(typeof display!=='string'||display.length>512||/[\r\n\0]/.test(display))throw failure('X11_UNAVAILABLE');
  const unix=/^(?:unix)?:([0-9]{1,5})(?:\.([0-9]{1,5}))?$/.exec(display);
  const quartz=platform==='darwin'&&/^\/(?:private\/)?(?:tmp\/[a-zA-Z0-9_./-]+|var\/run\/com\.apple\.launchd\.[a-zA-Z0-9_-]+\/org\.xquartz):([0-9]{1,5})(?:\.([0-9]{1,5}))?$/.exec(display);
  const tcp=/^(127\.0\.0\.1|localhost):([0-9]{1,5})(?:\.([0-9]{1,5}))?$/.exec(display);
  let address,screen=0;
  if(unix&&platform!=='win32'){address={path:'/tmp/.X11-unix/X'+Number(unix[1])};screen=Number(unix[2]||0);}
  // XQuartz's launchd handoff can promote a local connection to trusted
  // independently of its cookie. Use the direct local socket so generated
  // untrusted authorization is actually honored by the X server.
  else if(quartz){address={path:'/tmp/.X11-unix/X'+Number(quartz[1])};screen=Number(quartz[2]||0);}
  else if(tcp&&Number(tcp[2])+6000<=65535){address={host:'127.0.0.1',port:6000+Number(tcp[2])};screen=Number(tcp[3]||0);}
  else throw Object.assign(failure('X11_UNSUPPORTED'),{reason:'DISPLAY_FORMAT_UNSUPPORTED'});
  if(screen>65535)throw failure('X11_UNAVAILABLE');return {display,address,screen,authorityDisplay:quartz?':'+Number(quartz[1]):display};
 };
 let checking;
 let availability={checkedAt:null,trusted:{available:null},untrusted:{available:null},untrustedAuthorizationMaxMs:300000};
 const service={supportedModes:platform==='win32'?[]:['trusted','untrusted'],get availability(){return availability;},checkAvailability(){if(checking)return checking;checking=service.inspectAvailability().finally(()=>{checking=undefined;});return checking;},async inspectAvailability(){
  const result={checkedAt:new Date().toISOString(),untrustedAuthorizationMaxMs:300000};
  for(const mode of ['trusted','untrusted']){let local;try{local=await service.prepare(mode);await local.dispose();result[mode]={available:true};}catch(error){try{await local?.dispose();}catch{}result[mode]={available:false,code:failure(error?.code).code,...(['DISPLAY_FORMAT_UNSUPPORTED','PLATFORM_UNSUPPORTED','SECURITY_EXTENSION_UNAVAILABLE','SECURITY_VERSION_UNSUPPORTED','RESTRICTED_EXTENSION_VISIBLE','ISOLATION_CHECK_FAILED','DISPLAY_PROBE_UNSUPPORTED'].includes(error?.reason)?{reason:error.reason}:{})};}}
  availability=result;return result;
 },async prepare(mode,options={}){
  options.authorize?.();
  if(platform==='win32')throw Object.assign(failure('X11_UNSUPPORTED'),{reason:'PLATFORM_UNSUPPORTED'});
  if(mode==='untrusted'){const base=await service.prepare('trusted',options);return createRestrictedDisplay(base,options);}if(mode!=='trusted')throw failure('INVALID_REQUEST');
  const {display,address,screen,authorityDisplay}=descriptor();
  const executable=platform==='darwin'?'/opt/X11/bin/xauth':platform==='linux'?'/usr/bin/xauth':null;
  if(!executable||!fs.existsSync(executable))throw failure('X11_AUTH_UNAVAILABLE');
  const output=await new Promise((resolve,reject)=>execute(executable,['nlist',authorityDisplay],{env,timeout:3000,maxBuffer:8192,encoding:'utf8',windowsHide:true},(error,stdout)=>error?reject(failure('X11_AUTH_UNAVAILABLE')):resolve(stdout)));
  options.authorize?.();
  const {identity,cookie}=selection(output);let disposed=false,invalidated=false;
  const open=()=>new Promise((resolve,reject)=>{
   if(disposed){reject(failure('X11_UNAVAILABLE'));return;}
   const socket=connect(address);const timer=setTimeout(()=>{socket.destroy();reject(failure('X11_UNAVAILABLE'));},3000);
   socket.once('error',()=>{clearTimeout(timer);socket.destroy();reject(failure('X11_UNAVAILABLE'));});
   socket.once('connect',()=>{clearTimeout(timer);if(disposed){socket.destroy();reject(failure('X11_UNAVAILABLE'));}else resolve(socket);});
  });
  const authority=env.XAUTHORITY;
  const filename=authority||require('node:path').join(require('node:os').homedir(),'.Xauthority');
  // Compare the selected record, not database timestamps/inodes. sshd may add
  // unrelated forwarding entries to this same file (including by atomic rename).
  // Do not cache metadata: even a rotation with preserved timestamps must revoke.
  const isCurrent=()=>{
   if(disposed||invalidated)return false;
   if(env.DISPLAY!==display||env.XAUTHORITY!==authority||!authorizationMatches(filename,identity,cookie))invalidated=true;
   return !invalidated;
  };
  const local={screen,cookie,connect:()=>isCurrent()?open():Promise.reject(failure('X11_AUTH_UNAVAILABLE')),isCurrent,dispose(){disposed=true;cookie.fill(0);identity.fill(0);}};
  try{
   const probe=await local.connect();
   await new Promise((resolve,reject)=>{
    let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);probe.destroy();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(failure('X11_UNAVAILABLE')),3000);
    probe.once('error',()=>finish(failure('X11_UNAVAILABLE')));probe.once('close',()=>{if(!settled)finish(failure('X11_UNAVAILABLE'));});
    probe.once('data',reply=>finish(reply[0]===1?null:failure('X11_AUTH_UNAVAILABLE')));
    const packet=Buffer.alloc(48);packet[0]=0x6c;packet.writeUInt16LE(11,2);packet.writeUInt16LE(18,6);packet.writeUInt16LE(16,8);Buffer.from('MIT-MAGIC-COOKIE-1').copy(packet,12);cookie.copy(packet,32);probe.write(packet,()=>packet.fill(0));
   });
   ensure(isCurrent(),'X11_AUTH_UNAVAILABLE');
   return local;
  }catch(error){local.dispose();throw error;}
 }};return service;
}
module.exports={createLocalDisplays};
