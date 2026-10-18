// Host-only Xauthority parsing. No records or cookies leave the display service.
const fs=require('node:fs');
const {timingSafeEqual}=require('node:crypto');
const {failure}=require('./contracts.cjs');
const MAX_BYTES=1024*1024,MAX_RECORDS=4096;
function records(bytes){
 const result=[];let at=0;
 while(at<bytes.length){
  if(result.length>=MAX_RECORDS||at+2>bytes.length)throw failure('X11_AUTH_UNAVAILABLE');
  const start=at,family=bytes.readUInt16BE(at);at+=2;const fields=[];
  for(let index=0;index<4;index++){
   if(at+2>bytes.length)throw failure('X11_AUTH_UNAVAILABLE');
   const size=bytes.readUInt16BE(at);at+=2;
   if(at+size>bytes.length)throw failure('X11_AUTH_UNAVAILABLE');
   fields.push(bytes.subarray(at,at+size));at+=size;
  }
  const [address,number,name,value]=fields;
  result.push({family,address,number,name,value,identity:bytes.subarray(start,at-value.length-2)});
 }
 return result;
}
function selection(output){
 // xauth nlist is the exact binary record encoded as whitespace-separated hex.
 if(typeof output!=='string'||!/^[\da-fA-F\s]+$/.test(output))throw failure('X11_AUTH_UNAVAILABLE');
 const hex=output.replace(/\s/g,'');if(hex.length%2||hex.length>16384)throw failure('X11_AUTH_UNAVAILABLE');
 const bytes=Buffer.from(hex,'hex');
 try{
  const found=records(bytes);
  if(found.length!==1||found[0].name.toString()!=='MIT-MAGIC-COOKIE-1'||found[0].value.length!==16)throw failure('X11_AUTH_UNAVAILABLE');
  return {identity:Buffer.from(found[0].identity),cookie:Buffer.from(found[0].value)};
 }finally{bytes.fill(0);}
}
function authorizationMatches(filename,identity,cookie){
 let fd,bytes;
 try{
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);const info=fs.fstatSync(fd);
  if(!info.isFile()||info.size>MAX_BYTES)return false;
  // Bounded even when the file grows concurrently. An incomplete write fails closed.
  bytes=Buffer.alloc(Math.min(MAX_BYTES+1,info.size+1));let size=0,count;
  while(size<bytes.length&&(count=fs.readSync(fd,bytes,size,bytes.length-size,null))>0)size+=count;
  if(size>MAX_BYTES||size===bytes.length)return false;
  const matches=records(bytes.subarray(0,size)).filter(entry=>entry.identity.equals(identity));
  return matches.length===1&&matches[0].value.length===cookie.length&&timingSafeEqual(matches[0].value,cookie);
 }catch{return false;}finally{bytes?.fill(0);if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
module.exports={selection,authorizationMatches};
