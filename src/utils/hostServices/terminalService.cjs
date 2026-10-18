// Host-owned PTY sessions. Handles never cross the authenticated worker endpoint.
const {reserve}=require('./resourceBudget.cjs');
const {randomUUID}=require('node:crypto');
const {ensure,failure,record,key,integer}=require('./contracts.cjs');
const {trusted}=require('./ssh.cjs');
const {openSSHTerminal}=require('./sshTerminal.cjs');
function options(value) {
 record(value,['profileId','term','rows','columns','idleTimeoutMs','sessionTimeoutMs','x11'],['profileId','term','rows','columns','idleTimeoutMs','sessionTimeoutMs']);
 key(value.profileId);
 if(typeof value.term!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9+._-]{0,63}$/.test(value.term))throw failure('INVALID_REQUEST');
 integer(value.rows,1,1000);integer(value.columns,1,1000);integer(value.idleTimeoutMs,1,3600000);integer(value.sessionTimeoutMs,1,86400000);
 if(value.x11!==undefined){record(value.x11,['mode']);if(!['trusted','untrusted'].includes(value.x11.mode))throw failure('INVALID_REQUEST');}
 return {...value,idleTimeoutMs:Math.min(value.idleTimeoutMs,300000),sessionTimeoutMs:Math.min(value.sessionTimeoutMs,3600000)};
}
function decode(value) {
 if(typeof value!=='string'||value.length>43692||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw failure('INVALID_REQUEST');
 const bytes=Buffer.from(value,'base64');if(bytes.length>32768||bytes.toString('base64')!==value)throw failure('INVALID_REQUEST');return bytes;
}
function createTerminalService({Client,authorize,displays,getViewLease,audit=()=>{},handshakeMs=10000}) {
 const all=new Set(),bindings=new Set();let shuttingDown=false;
 const release=entry=>{
  if(entry.released)return;entry.released=true;clearInterval(entry.timer);
  let cleaning;try{cleaning=Promise.resolve(entry.local?.dispose());}catch(error){cleaning=Promise.reject(failure(error?.code));}
  entry.displayDone=cleaning.finally(()=>{entry.cleanupComplete=true;entry.releaseBudget?.();if(entry.openComplete)all.delete(entry);});entry.displayDone.catch(()=>{});
  entry.credentials.password=entry.credentials.privateKey=entry.credentials.passphrase=undefined;
 };
 const stop=(entry,code='ACCESS_DENIED')=>{if(entry.stopped)return;entry.stopped=true;entry.error=code;entry.rejectOpen?.(failure(code));entry.client?.destroy();void entry.session?.close();release(entry);};
 return {
  readiness:()=>({terminalAdapter:true,terminalRenderer:true,x11Modes:displays?.supportedModes||[],x11Availability:displays?.availability,untrustedX11:displays?.supportedModes?.includes('untrusted')===true,desktopX11Verified:false,limits:{perWorker:4,perHost:16,idleTimeoutMs:300000,sessionTimeoutMs:3600000,viewLeaseMs:30000}}),
  checkX11:()=>displays.checkAvailability(),
  invalidateViews(){for(const entry of all)if(!entry.lease.valid())stop(entry,'SESSION_CLOSED');},
  async close(){shuttingDown=true;const entries=[...all];for(const bound of bindings)bound.close();await Promise.allSettled(entries.flatMap(entry=>[entry.openDone,entry.session?.close(),entry.displayDone]));},
  bind(pluginId){
   const handles=new Map();let closed=false;
   const check=entry=>{
    if(closed)throw failure('UNAVAILABLE');
    authorize(pluginId,entry.options.profileId,entry.options.x11?.mode,false,entry.revision);
    if(!entry.lease.valid()){stop(entry,'SESSION_CLOSED');throw failure('SESSION_CLOSED');}
    if(!entry.released&&entry.local?.isCurrent&&!entry.local.isCurrent()){stop(entry,'X11_UNAVAILABLE');throw failure('X11_UNAVAILABLE');}
    if(entry.error)throw failure(entry.error);
   };
   const discard=(id,entry)=>{clearTimeout(entry.expiry);entry.releaseBuffer?.();handles.delete(id);};
   const bound={
    cancel(code='ACCESS_DENIED'){for(const entry of handles.values())stop(entry,code);},
    close(){closed=true;for(const [id,entry]of handles){stop(entry,'UNAVAILABLE');discard(id,entry);}bindings.delete(bound);},
    async operation(operation,payload,requestId){
     if(closed||shuttingDown)throw failure('UNAVAILABLE');
     if(operation==='terminal.open'){
      const config=options(payload);
      if(handles.size>=32||all.size>=16||[...all].filter(entry=>entry.owner===handles).length>=4)throw failure('SESSION_LIMIT');
      const lease=getViewLease(pluginId);if(!lease?.valid())throw failure('SESSION_CLOSED');
      const {profile,credentials}=authorize(pluginId,config.profileId,config.x11?.mode,true);
      const releaseBudget=reserve(12*1024*1024);if(!releaseBudget){credentials.password=credentials.privateKey=credentials.passphrase=undefined;throw failure('SESSION_LIMIT');}
      const releaseBuffer=reserve(512*1024);if(!releaseBuffer){releaseBudget();credentials.password=credentials.privateKey=credentials.passphrase=undefined;throw failure('SESSION_LIMIT');}
      config.idleTimeoutMs=Math.min(config.idleTimeoutMs,profile.policy.terminalLimits?.idleTimeoutMs||300000);config.sessionTimeoutMs=Math.min(config.sessionTimeoutMs,profile.policy.terminalLimits?.sessionTimeoutMs||3600000);
      const id=randomUUID(),entry={releaseBuffer,releaseBudget,owner:handles,options:config,credentials,revision:JSON.stringify(profile),lease,released:false};
      entry.openDone=new Promise(resolve=>{entry.finishOpen=resolve;});
      handles.set(id,entry);all.add(entry); // Ownership precedes display discovery and authentication.
      entry.timer=setInterval(()=>{try{check(entry);}catch(error){stop(entry,error.code);}},1000);entry.timer.unref?.();
      try{
       audit(pluginId,'ssh.terminal.open','STARTED',requestId);
       if(config.x11){entry.local=await displays.prepare(config.x11.mode,{lifetimeMs:config.sessionTimeoutMs,authorize:()=>check(entry)});if(entry.local.signal)entry.local.signal.addEventListener('abort',()=>stop(entry,'X11_AUTH_UNAVAILABLE'),{once:true});check(entry);ensure(!entry.local.signal?.aborted,'X11_AUTH_UNAVAILABLE');}
       const client=new Client();entry.client=client;
       await new Promise((resolve,reject)=>{
        let verified=false,rejected=false,done=false;
        const finish=error=>{if(done)return;done=true;clearTimeout(timer);entry.rejectOpen=undefined;client.removeListener('ready',ready);error?reject(error):resolve();};
        const ready=()=>finish(verified?null:failure('HOST_KEY_REJECTED'));
        const timer=setTimeout(()=>finish(failure('TIMEOUT')),handshakeMs);entry.rejectOpen=finish;
        client.on('error',()=>finish(failure(rejected?'HOST_KEY_REJECTED':'CONNECTION_FAILED')));client.once('close',()=>finish(failure('CONNECTION_FAILED')));client.once('ready',ready);
        client.connect({host:profile.host,port:profile.port,username:profile.username,...credentials,tryKeyboard:false,readyTimeout:handshakeMs,keepaliveInterval:5000,keepaliveCountMax:1,hostVerifier:raw=>{verified=trusted(raw,profile.trustedHostKey);rejected=!verified;return verified;}});
       });
       credentials.password=credentials.privateKey=credentials.passphrase=undefined;check(entry);
       const session=await openSSHTerminal({client,options:config,localX11:entry.local,authorize:()=>check(entry),onDispose:()=>release(entry)});
       entry.session=session;entry.iterator=session.output[Symbol.asyncIterator]();check(entry);
       entry.result=session.result.then(async result=>{await entry.displayDone;check(entry);return result;}).finally(()=>{entry.finished=true;if(!closed&&!shuttingDown&&handles.get(id)===entry){entry.expiry=setTimeout(()=>discard(id,entry),120000);entry.expiry.unref?.();}});entry.result.catch(()=>{});
       audit(pluginId,'ssh.terminal.open','OK',requestId);return {handle:id};
      }catch(error){const safe=failure(error?.code);try{await entry.local?.dispose();}catch{}stop(entry,safe.code);discard(id,entry);try{audit(pluginId,'ssh.terminal.open',safe.code,requestId);}catch{}throw safe;}finally{entry.openComplete=true;if(entry.released&&entry.cleanupComplete)all.delete(entry);entry.finishOpen();}
     }
     const allowed=operation==='terminal.write'?['handle','dataBase64']:operation==='terminal.resize'?['handle','rows','columns']:['handle'];record(payload,allowed);key(payload.handle);
     const entry=handles.get(payload.handle);if(!entry)throw failure('ACCESS_DENIED');
     // Same-endpoint close/cancel tombstones remain idempotent; grants are still checked.
     if(operation==='terminal.close'||operation==='terminal.cancel'){
      if(!entry.closedAck){check(entry);entry.closedAck=true;if(operation==='terminal.cancel')entry.cancelAck=await entry.session.cancel();else await entry.session.close();await entry.displayDone;if(!entry.expiry){entry.expiry=setTimeout(()=>discard(payload.handle,entry),120000);entry.expiry.unref?.();}}
      return operation==='terminal.close'?{closed:true}:entry.cancelAck||{remoteProcessStopped:null};
     }
     check(entry);if(!entry.session)throw failure('SESSION_CLOSED');
     if(operation==='terminal.next'){
      if(entry.reading)throw failure('BACKPRESSURE');entry.reading=true;
      try{const item=await entry.iterator.next();check(entry);return item.done?{done:true}:{done:false,value:{sequence:item.value.sequence,dataBase64:Buffer.from(item.value.data).toString('base64')}};}finally{entry.reading=false;}
     }
     if(operation==='terminal.result'){
      if(entry.resultPending)throw failure('BACKPRESSURE');entry.resultPending=true;try{const result=await entry.result;check(entry);return result;}finally{entry.resultPending=false;}
     }
     if(!['terminal.write','terminal.resize','terminal.eof'].includes(operation))throw failure('INVALID_REQUEST');
     if(entry.controls>=24)throw failure('BACKPRESSURE');entry.controls=(entry.controls||0)+1;
     let timer;
     try{
      const work=operation==='terminal.write'?entry.session.write(decode(payload.dataBase64)):operation==='terminal.resize'?entry.session.resize(integer(payload.rows,1,1000),integer(payload.columns,1,1000)):entry.session.endInput();
      await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{stop(entry,'TIMEOUT');reject(failure('TIMEOUT'));},10000);})]);check(entry);return {accepted:true};
     }finally{clearTimeout(timer);entry.controls--;}
    },
   };bindings.add(bound);return bound;
  },
 };
}
module.exports={createTerminalService,validateTerminalOptions:options,decodeTerminalBytes:decode};
