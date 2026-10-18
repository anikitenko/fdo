const field=value=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);const prefix=Buffer.alloc(2);prefix.writeUInt16BE(bytes.length);return Buffer.concat([prefix,bytes]);};
function authorityRecord({family=256,address='fixture-host',number='0',cookie=Buffer.alloc(16,0x21),protocol='MIT-MAGIC-COOKIE-1'}={}){
 const prefix=Buffer.alloc(2);prefix.writeUInt16BE(family);
 return Buffer.concat([prefix,field(address),field(number),field(protocol),field(cookie)]);
}
module.exports={authorityRecord};
