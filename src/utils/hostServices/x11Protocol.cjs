// Minimal host-only X11 control connection. No arbitrary protocol API crosses IPC.
const {failure}=require('./contracts.cjs');
const LIMIT=262144;
const pad=value=>(value+3)&~3;
function packet(opcode,length,data=0){const value=Buffer.alloc(length);value[0]=opcode;value[1]=data;value.writeUInt16LE(length/4,2);return value;}
function openX11Control(socket,cookie,{screen=0,timeoutMs=3000,onEvent=()=>{},onLost=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),initialized=false,closed=false,sequence=0,setup;
  const pending=new Map();
  const fail=(code='X11_UNAVAILABLE')=>{
   if(closed)return;closed=true;clearTimeout(timer);socket.removeListener('data',receive);buffer.fill(0);buffer=Buffer.alloc(0);socket.destroy();
   for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(failure(code));}pending.clear();
   if(!initialized)reject(failure(code));else onLost();
  };
  const timer=setTimeout(()=>fail('X11_AUTH_UNAVAILABLE'),timeoutMs);
  const request=(value,reply=true)=>{
   if(closed)return Promise.reject(failure('X11_UNAVAILABLE'));
   if(pending.size>=8||sequence>=60000)return Promise.reject(failure('X11_UNAVAILABLE'));
   const id=++sequence;
   return new Promise((accept,decline)=>{
    const expiry=setTimeout(()=>fail(),timeoutMs);pending.set(id,{resolve:accept,reject:decline,timer:expiry,reply});
    try{socket.write(value,error=>{value.fill(0);if(error)fail();});}catch{fail();}
   });
  };
  const api={
   get setup(){return setup;},get closed(){return closed;},
   request,
   async command(value){await Promise.all([request(value,false),request(packet(43,4))]);},
   close(){fail();},
  };
  const receive=chunk=>{
   try{
    if(closed)return;
    if(!Buffer.isBuffer(chunk)||buffer.length+chunk.length>LIMIT){fail();return;}
    const previous=buffer;buffer=Buffer.concat([previous,chunk]);previous.fill(0);
    if(!initialized){
     if(buffer.length<8)return;
     const length=8+buffer.readUInt16LE(6)*4;
     if(length>LIMIT||buffer[0]!==1||buffer.readUInt16LE(2)!==11){fail('X11_AUTH_UNAVAILABLE');return;}
     if(buffer.length<length)return;
     if(length<40||!buffer[28]||screen>=buffer[28]){fail('X11_UNSUPPORTED');return;}
     const base=buffer.readUInt32LE(12),mask=buffer.readUInt32LE(16);let at=40+pad(buffer.readUInt16LE(24))+buffer[29]*8,root;
     for(let index=0;index<buffer[28];index++){
      if(at+40>length){fail();return;}
      if(index===screen)root=buffer.readUInt32LE(at);
      let depths=buffer[at+39];at+=40;
      while(depths--){if(at+8>length){fail();return;}const visuals=buffer.readUInt16LE(at+2);at+=8+visuals*24;if(at>length){fail();return;}}
     }
     if(!base||!mask||!root){fail('X11_UNSUPPORTED');return;}
     setup={base,mask,root};const rest=Buffer.from(buffer.subarray(length));buffer.fill(0);buffer=rest;initialized=true;clearTimeout(timer);resolve(api);
    }
    while(buffer.length>=32){
     const type=buffer[0],length=type===1?32+buffer.readUInt32LE(4)*4:32;
     if(length>LIMIT){fail();return;}if(buffer.length<length)return;
     const message=Buffer.from(buffer.subarray(0,length));const rest=Buffer.from(buffer.subarray(length));buffer.fill(0);buffer=rest;
     if(type===0||type===1){
      const id=message.readUInt16LE(2),entry=pending.get(id);
      if(!entry||type===1&&!entry.reply){message.fill(0);fail();return;}
      for(const [earlier,item]of pending)if(earlier<id&&!item.reply){pending.delete(earlier);clearTimeout(item.timer);item.resolve();}
      pending.delete(id);clearTimeout(entry.timer);
      if(type===0){const error=failure('X11_AUTH_UNAVAILABLE');error.x11Error=message[1];error.x11Major=message[10];error.x11Resource=message.readUInt32LE(4);entry.reject(error);message.fill(0);}else entry.resolve(message);
     }else{try{onEvent(message);}finally{message.fill(0);}}
    }
   }catch{fail();}
  };
  socket.on('data',receive);socket.on('error',()=>fail());socket.once('close',()=>fail());
  if(!Buffer.isBuffer(cookie)||cookie.length!==16){fail('X11_AUTH_UNAVAILABLE');return;}
  const hello=Buffer.alloc(48);hello[0]=0x6c;hello.writeUInt16LE(11,2);hello.writeUInt16LE(18,6);hello.writeUInt16LE(16,8);Buffer.from('MIT-MAGIC-COOKIE-1').copy(hello,12);cookie.copy(hello,32);
  try{socket.write(hello,error=>{hello.fill(0);if(error)fail();});}catch{hello.fill(0);fail();}
 });
}
async function querySecurity(control){
 const name=Buffer.from('SECURITY'),query=packet(98,8+pad(name.length));query.writeUInt16LE(name.length,4);name.copy(query,8);
 const reply=await control.request(query);
 if(reply.length!==32||![0,1].includes(reply[8])){reply.fill(0);throw failure('X11_UNSUPPORTED');}
 const info={present:reply[8]===1,opcode:reply[9],event:reply[10],error:reply[11]};reply.fill(0);
 return info;
}
module.exports={openX11Control,querySecurity,packet,pad};
