// Simulated X11 wire peer for host protocol tests. This is not an X server.
const net=require('node:net');
const {randomBytes}=require('node:crypto');
const {pad}=require('../../src/utils/hostServices/x11Protocol.cjs');
async function securityServer(behavior={}){
 const trustedCookie=Buffer.alloc(16,0x21),connections=new Set(),authorizations=new Map(),pixmaps=new Map(),requests=[];let nextClient=1,nextAuth=100;
 const server=net.createServer(socket=>{
  connections.add(socket);socket.on('error',()=>{});let buffer=Buffer.alloc(0),initialized=false,restricted=false,authorization,sequence=0,lastOpcode=0,lastResource=0;
  const owner=nextClient++;
  const reply=(length=32)=>{const value=Buffer.alloc(length);value[0]=1;value.writeUInt16LE(sequence,2);value.writeUInt32LE((length-32)/4,4);return value;};
  const error=code=>{const value=Buffer.alloc(32);value[1]=code;value.writeUInt16LE(sequence,2);value.writeUInt32LE(lastResource,4);value[10]=lastOpcode;socket.write(value);};
  socket.on('close',()=>{connections.delete(socket);for(const [id,value]of pixmaps)if(value===owner)pixmaps.delete(id);});
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   if(!initialized){
    if(buffer.length<48)return;
    const cookie=buffer.subarray(32,48);authorization=[...authorizations.values()].find(item=>item.cookie.equals(cookie));
    if(!cookie.equals(trustedCookie)&&!authorization){socket.end(Buffer.alloc(8));return;}
    restricted=!!authorization&&!behavior.trustedAuthorization;initialized=true;buffer=buffer.subarray(48);
    const setup=Buffer.alloc(80);setup[0]=1;setup.writeUInt16LE(11,2);setup.writeUInt16LE(18,6);setup.writeUInt32LE(owner*0x200000,12);setup.writeUInt32LE(0x1fffff,16);setup[28]=1;setup.writeUInt32LE(1,40);setup[78]=24;
    socket.write(setup);
   }
   while(buffer.length>=4){
    const length=buffer.readUInt16LE(2)*4;if(length<4||length>65536){socket.destroy();return;}if(buffer.length<length)return;
    const value=Buffer.from(buffer.subarray(0,length));buffer=buffer.subarray(length);sequence++;const opcode=value[0];lastOpcode=opcode;lastResource=value.length>=8?value.readUInt32LE(4):0;requests.push({opcode,minor:value[1],restricted});
    if(behavior.stall===opcode)continue;
    if(opcode===98){const answer=reply();if(!behavior.missingExtension&&(!restricted||behavior.exposedSecurity)){answer[8]=1;answer[9]=145;answer[10]=80;answer[11]=150;}socket.write(answer);}
    else if(opcode===145&&value[1]===0){const answer=reply();answer.writeUInt16LE(1,8);socket.write(answer);}
    else if(opcode===145&&value[1]===1){
     const offset=12+pad(value.readUInt16LE(4))+pad(value.readUInt16LE(6));
     if(value.readUInt32LE(8)!==11||value.readUInt32LE(offset)!==60||value.readUInt32LE(offset+4)!==1||value.readUInt32LE(offset+8)!==1){error(16);continue;}
     const id=nextAuth++,cookie=randomBytes(16),record={id,cookie,issuer:socket,clients:new Set()};authorizations.set(id,record);
     const answer=reply(48);answer.writeUInt32LE(id,8);answer.writeUInt16LE(16,12);cookie.copy(answer,32);socket.write(answer);
    }else if(opcode===145&&value[1]===2){const id=value.readUInt32LE(4),item=authorizations.get(id);if(!item){error(150);continue;}authorizations.delete(id);for(const client of connections)if(client!==socket&&client.__auth===id)client.destroy();const event=Buffer.alloc(32);event[0]=80;event.writeUInt32LE(id,4);socket.write(event);}
    else if(opcode===43)socket.write(reply());
    else if(opcode===53)pixmaps.set(value.readUInt32LE(4),owner);
    else if(opcode===73){const id=value.readUInt32LE(4);if(!pixmaps.has(id)||restricted&&pixmaps.get(id)!==owner&&!behavior.readsTrustedPixmap)error(9);else {const answer=reply(36);answer[1]=1;socket.write(answer);}}
    else if(opcode===54)pixmaps.delete(value.readUInt32LE(4));
    else if(![55,60,70].includes(opcode))error(1);
    value.fill(0);
   }
   if(authorization)socket.__auth=authorization.id;
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connect=()=>new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:server.address().port});socket.once('connect',()=>resolve(socket));socket.once('error',reject);});
 let disposed=false;
 return {connections,authorizations,pixmaps,requests,connect,base:{screen:0,cookie:Buffer.from(trustedCookie),connect,isCurrent:()=>!disposed,dispose(){disposed=true;this.cookie.fill(0);}},async close(){for(const client of connections)client.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={securityServer};
