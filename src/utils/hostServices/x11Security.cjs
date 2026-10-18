// X SECURITY 1.0 authorization, verified against actual trusted-client resources.
// Protocol layout follows Xorg securproto.h (12-byte GenerateAuthorization header).
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {failure}=require('./contracts.cjs');
const {openX11Control,querySecurity,packet,pad}=require('./x11Protocol.cjs');
const AUTH_MAX_MS=300000;
const SECURITY_REASONS=new Set(['SECURITY_EXTENSION_UNAVAILABLE','SECURITY_VERSION_UNSUPPORTED','RESTRICTED_EXTENSION_VISIBLE','ISOLATION_CHECK_FAILED','DISPLAY_PROBE_UNSUPPORTED']);
const unsupported=reason=>Object.assign(failure('X11_UNSUPPORTED'),{reason});
async function createRestrictedDisplay(base,{lifetimeMs=AUTH_MAX_MS,authorize=()=>{}}={}){
 let control,probe,extension,id=0,cookie,closing,disposed=false,verified=false,revoked=false;
 const verify=()=>{if(disposed)throw failure('X11_AUTH_UNAVAILABLE');authorize();};
 const sockets=new Set(),controller=new AbortController();
 let expiry,deadline;
 const invalidate=()=>{if(!disposed){controller.abort();void dispose();}};
 const connectControl=async()=>{
  const socket=await base.connect();
  return openX11Control(socket,base.cookie,{screen:base.screen,onLost:invalidate,onEvent:event=>{
   if(extension&&event[0]===extension.event&&event.readUInt32LE(4)===id){revoked=true;invalidate();}
  }});
 };
 async function negotiate(connection){
  const info=await querySecurity(connection);if(!info.present||info.opcode<128)throw unsupported('SECURITY_EXTENSION_UNAVAILABLE');
  const query=packet(info.opcode,8,0);query.writeUInt16LE(1,4);
  const reply=await connection.request(query);const compatible=reply.length===32&&reply.readUInt16LE(8)===1&&reply.readUInt16LE(10)===0;reply.fill(0);
  if(!compatible)throw unsupported('SECURITY_VERSION_UNSUPPORTED');return info;
 }
 async function revoke(){
  if(!id||revoked)return;
  let connection=control,info=extension,recovery=false;
  try{
   if(!connection||connection.closed){connection=await connectControl();recovery=true;info=await negotiate(connection);}
   const request=packet(info.opcode,8,2);request.writeUInt32LE(id,4);
   await connection.command(request);revoked=true;
  }finally{if(recovery)connection?.close();}
 }
 function dispose(){
  if(closing)return closing;
  disposed=true;clearTimeout(expiry);clearTimeout(deadline);cookie?.fill(0);probe?.close();
  for(const socket of sockets)socket.destroy();sockets.clear();
  closing=(async()=>{try{await revoke();}finally{control?.close();await base.dispose();}})();closing.catch(()=>{});return closing;
 }
 const establishAuthorization=async()=>{
  deadline=setTimeout(invalidate,12000);deadline.unref?.();
  verify();control=await connectControl();verify();extension=await negotiate(control);verify();
  if(disposed)throw failure('X11_AUTH_UNAVAILABLE');
  const name=Buffer.from('MIT-MAGIC-COOKIE-1'),entropy=randomBytes(16),offset=12+pad(name.length)+pad(entropy.length);
  const generate=packet(extension.opcode,offset+12,1);generate.writeUInt16LE(name.length,4);generate.writeUInt16LE(entropy.length,6);generate.writeUInt32LE(11,8);name.copy(generate,12);entropy.copy(generate,12+pad(name.length));entropy.fill(0);
  generate.writeUInt32LE(60,offset);generate.writeUInt32LE(1,offset+4);generate.writeUInt32LE(1,offset+8);
  const response=await control.request(generate);id=response.readUInt32LE(8);
  const size=response.readUInt16LE(12),validLength=response.length===48;cookie=Buffer.from(response.subarray(32,32+size));response.fill(0);
  verify();if(!validLength||!id||size!==16||cookie.length!==16||timingSafeEqual(cookie,base.cookie)||disposed)throw failure('X11_AUTH_UNAVAILABLE');
  const socket=await base.connect();probe=await openX11Control(socket,cookie,{screen:base.screen,onLost:invalidate});
  verify();const hidden=await querySecurity(probe);verify();if(hidden.present||hidden.opcode!==0)throw unsupported('RESTRICTED_EXTENSION_VISIBLE');
  // Read a fresh trusted pixmap successfully, then require denial for the same
  // valid drawable through the generated authorization. No desktop pixels read.
  const bit=(control.setup.mask&-control.setup.mask)>>>0,pixmap=(control.setup.base|bit)>>>0,gc=(control.setup.base|(bit*2))>>>0;
  if(!bit||!(control.setup.mask&(bit*2)))throw unsupported('DISPLAY_PROBE_UNSUPPORTED');
  const create=packet(53,16,1);create.writeUInt32LE(pixmap,4);create.writeUInt32LE(control.setup.root,8);create.writeUInt16LE(1,12);create.writeUInt16LE(1,14);await control.command(create);
  const graphics=packet(55,20);graphics.writeUInt32LE(gc,4);graphics.writeUInt32LE(pixmap,8);graphics.writeUInt32LE(4,12);await control.command(graphics);
  const fill=packet(70,20);fill.writeUInt32LE(pixmap,4);fill.writeUInt32LE(gc,8);fill.writeUInt16LE(1,16);fill.writeUInt16LE(1,18);await control.command(fill);
  const image=()=>{const request=packet(73,20,2);request.writeUInt32LE(pixmap,4);request.writeUInt16LE(1,12);request.writeUInt16LE(1,14);request.writeUInt32LE(0xffffffff,16);return request;};
  const trusted=await control.request(image());const validImage=trusted.length===36&&trusted[1]===1&&trusted.subarray(32).every(byte=>byte===0);trusted.fill(0);if(!validImage)throw unsupported('DISPLAY_PROBE_UNSUPPORTED');
  let denied=false;try{const unexpected=await probe.request(image());unexpected.fill(0);}catch(error){if([9,10].includes(error.x11Error)&&error.x11Major===73&&error.x11Resource===pixmap)denied=true;else throw error;}
  if(!denied)throw unsupported('ISOLATION_CHECK_FAILED');
  for(const [opcode,resource]of [[60,gc],[54,pixmap]]){const free=packet(opcode,8);free.writeUInt32LE(resource,4);await control.command(free);}
  // Keep this restricted sentinel connected: server idle expiry is then a
  // crash fallback, while our wall-clock deadline bounds active authorizations.
  if(disposed||control.closed||!base.isCurrent())throw failure('X11_AUTH_UNAVAILABLE');
  verify();verified=true;clearTimeout(deadline);
  const duration=Math.min(AUTH_MAX_MS,Math.max(1000,lifetimeMs));expiry=setTimeout(invalidate,duration);expiry.unref?.();
  return {screen:base.screen,cookie,securityAuthorization:'untrusted',signal:controller.signal,expiresAt:Date.now()+duration,
   isCurrent:()=>verified&&!disposed&&!revoked&&!control.closed&&!probe.closed&&base.isCurrent(),
   async connect(){if(disposed||revoked||!base.isCurrent())throw failure('X11_AUTH_UNAVAILABLE');const socket=await base.connect();if(disposed||revoked){socket.destroy();throw failure('X11_AUTH_UNAVAILABLE');}sockets.add(socket);socket.once('close',()=>sockets.delete(socket));return socket;},dispose};
 };
 try{return await establishAuthorization();}catch(error){await dispose().catch(()=>{});throw Object.assign(failure(['X11_UNSUPPORTED','X11_UNAVAILABLE','ACCESS_DENIED','SESSION_CLOSED','UNAVAILABLE'].includes(error?.code)?error.code:'X11_AUTH_UNAVAILABLE'),SECURITY_REASONS.has(error?.reason)?{reason:error.reason}:{});}
}
module.exports={createRestrictedDisplay,AUTH_MAX_MS};
