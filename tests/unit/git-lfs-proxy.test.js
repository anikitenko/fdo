/** @jest-environment node */
const {test,expect}=require('@jest/globals');
const http=require('node:http'),net=require('node:net');
const {createLfsProxy,origin,matches}=require('../../src/utils/hostServices/gitLfsProxy.cjs');
test('LFS origin policies require HTTPS and match only the selected host, port and deliberate subdomains',()=>{
    expect(matches(origin('https://*.example.com'),'cdn.example.com',443)).toBe(true);
    for(const host of ['example.com','notexample.com','example.com.evil'])expect(matches(origin('https://*.example.com'),host,443)).toBe(false);
    expect(matches(origin('https://example.com:444'),'example.com',443)).toBe(false);
    for(const value of ['http://example.com','https://u:secret@example.com','https://example.com/path','https://*.com','https://foo.*.com','https://example.com?token=secret'])expect(()=>origin(value)).toThrow();
});
test('LFS proxy streams bytes only for authenticated authorized destinations and rechecks revocation',async()=>{
    const active=new Set(),controller=new AbortController();let allowed=true,connections=0;
    const upstream=net.createServer(socket=>{connections++;active.add(socket);socket.once('close',()=>active.delete(socket));socket.on('data',data=>socket.write(data));});
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const proxy=await createLfsProxy({signal:controller.signal,authorize:(host,port)=>allowed&&host==='127.0.0.1'&&port===upstream.address().port});
    const url=new URL(proxy.url);
    const connect=(withAuth=true)=>new Promise((resolve,reject)=>{
        const request=http.request({host:url.hostname,port:url.port,method:'CONNECT',path:'127.0.0.1:'+upstream.address().port,
            headers:withAuth?{'Proxy-Authorization':'Basic '+Buffer.from(`${url.username}:${url.password}`).toString('base64')}:{}});
        request.on('connect',(response,socket)=>resolve({status:response.statusCode,socket}));request.on('error',reject);request.end();
    });
    try {
        const denied=await connect(false);expect(denied.status).toBe(403);denied.socket.destroy();expect(connections).toBe(0);
        const accepted=await connect();expect(accepted.status).toBe(200);
        const bytes=Buffer.from([0,255,1,128]);const received=new Promise(resolve=>accepted.socket.once('data',resolve));accepted.socket.write(bytes);expect(await received).toEqual(bytes);accepted.socket.destroy();
        allowed=false;const revoked=await connect();expect(revoked.status).toBe(403);revoked.socket.destroy();
        expect(connections).toBe(1);expect(proxy.wasDenied()).toBe(true);
    }finally{controller.abort();await proxy.close();for(const socket of active)socket.destroy();await new Promise(resolve=>upstream.close(resolve));}
});
