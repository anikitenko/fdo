const http=require('node:http');
const net=require('node:net');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {failure}=require('./contracts.cjs');
function origin(value) {
    if(typeof value!=='string'||value.length>512||/\s/.test(value))throw failure('INVALID_REQUEST');
    let url;try {url=new URL(value);}catch {throw failure('INVALID_REQUEST');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname)throw failure('INVALID_REQUEST');
    const host=url.hostname.toLowerCase().replace(/^\[|]$/g,'');
    if(host.includes('*')&&(!host.startsWith('*.')||host.slice(2).split('.').length<2||host.slice(2).includes('*')))throw failure('INVALID_REQUEST');
    return {host,port:Number(url.port||443)};
}
function matches(rule,host,port){return rule.port===port&&(rule.host===host||rule.host.startsWith('*.')&&host.endsWith(rule.host.slice(1))&&host!==rule.host.slice(2));}
async function createLfsProxy({authorize,signal}) {
    const token=randomBytes(32).toString('hex'), expected=Buffer.from('Basic '+Buffer.from('fdo:'+token).toString('base64'));
    const sockets=new Set(); let denied=false;
    const server=http.createServer({maxHeaderSize:8192,headersTimeout:5000,requestTimeout:5000},(_req,res)=>res.writeHead(403).end());
    server.maxConnections=16;
    server.on('connection',socket=>{sockets.add(socket);socket.setTimeout(15000,()=>socket.destroy());socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
    server.on('connect',(req,socket,head)=>{
        const supplied=Buffer.from(req.headers['proxy-authorization']||'');
        const reject=()=>{denied=true;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');};
        if(signal.aborted||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||sockets.size>=16)return reject();
        let target;try {target=new URL('https://'+req.url);if(target.username||target.password||target.pathname!=='/'||target.search||target.hash||!authorize(target.hostname.replace(/^\[|]$/g,''),Number(target.port||443)))return reject();}catch{return reject();}
        const upstream=net.connect({host:target.hostname.replace(/^\[|]$/g,''),port:Number(target.port||443)});
        sockets.add(socket);sockets.add(upstream);
        const close=()=>{socket.destroy();upstream.destroy();sockets.delete(socket);sockets.delete(upstream);};
        socket.on('error',close);upstream.on('error',close);socket.on('close',close);upstream.on('close',close);
        upstream.setTimeout(15000,close);
        upstream.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
    });
    const abort=()=>{for(const socket of sockets)socket.destroy();};
    signal.addEventListener('abort',abort,{once:true});
    try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
    catch(error){signal.removeEventListener('abort',abort);abort();server.close();throw error;}
    if(signal.aborted){signal.removeEventListener('abort',abort);abort();await new Promise(resolve=>server.close(resolve));throw failure('ACCESS_DENIED');}
    return {url:`http://fdo:${token}@127.0.0.1:${server.address().port}`,wasDenied:()=>denied,
        async close(){signal.removeEventListener('abort',abort);abort();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={createLfsProxy,origin,matches};
