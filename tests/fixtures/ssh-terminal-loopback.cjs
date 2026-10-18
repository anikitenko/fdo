'use strict';
// Explicit loopback integration. Requires ssh2 supplied by the host checkout, not an SDK dependency.
const assert = require('node:assert/strict');
const {generateKeyPairSync,createHash} = require('node:crypto');
const {Duplex} = require('node:stream');
const {Client,Server} = require('ssh2');
const {openSSHTerminal} = require('../../src/utils/hostServices/sshTerminal.cjs');
const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs1'},publicKeyEncoding:{format:'pem',type:'pkcs1'}}).privateKey;
const sockets=new Set();let request,remoteX11,remoteSession,windowChange;
const server=new Server({hostKeys:[key]},conn=>{
    sockets.add(conn);conn.on('error',()=>{});conn.on('close',()=>sockets.delete(conn));
    conn.on('authentication',ctx=>ctx.method==='password'&&ctx.username==='test'&&ctx.password==='test-only'?ctx.accept():ctx.reject());
    conn.on('ready',()=>conn.on('session',accept=>{
        const session=accept();session.on('pty',(accept)=>accept());
        session.on('window-change',(accept,_reject,info)=>{windowChange=info;accept?.();});
        session.on('x11',(accept,_reject,info)=>{request=info;accept();});
        session.on('shell',accept=>{
            const stream=remoteSession=accept();stream.on('error',()=>{});
            stream.on('data',b=>stream.write(b));
            stream.write(Buffer.from([27,91,72,0xe2]));setTimeout(()=>stream.write(Buffer.from([0x82,0xac])),5);
            if(request) conn.x11('127.0.0.1',6000,(e,ch)=>{assert.ifError(e);remoteX11=ch;ch.on('error',()=>{});const p=Buffer.alloc(48);p[0]=0x6c;p.writeUInt16LE(11,2);p.writeUInt16LE(18,6);p.writeUInt16LE(16,8);Buffer.from('MIT-MAGIC-COOKIE-1').copy(p,12);Buffer.from(request.cookie.toString(),'hex').copy(p,32);ch.write(p);});
        });
    }));
});
const deadline=setTimeout(()=>{console.error('Integration timeout');process.exitCode=1;for(const c of sockets)c.end();server.close();},10000);
(async()=>{
    await new Promise((a,b)=>{server.once('error',b);server.listen(0,'127.0.0.1',a);});
    const pub=require('ssh2').utils.parseKey(key).getPublicSSH();
    const pinned=createHash('sha256').update(pub).digest();
    const client=new Client();await new Promise((a,b)=>{client.once('ready',a);client.once('error',b);client.connect({host:'127.0.0.1',port:server.address().port,username:'test',password:'test-only',hostVerifier:raw=>createHash('sha256').update(raw).digest().equals(pinned)});});
    class LocalDisplay extends Duplex { constructor(){super();this.received=[];} _read(){} _write(b,_enc,cb){this.received.push(Buffer.from(b));cb();} }
    const display=new LocalDisplay(), cookie=Buffer.alloc(16,0x25);
    const terminal=await openSSHTerminal({client,options:{term:'xterm-256color',rows:24,columns:80,idleTimeoutMs:3000,sessionTimeoutMs:8000,x11:{mode:'trusted'}},authorize(){},localX11:{screen:0,cookie,connect:async()=>display}});
    const iterator=terminal.output[Symbol.asyncIterator]();let text='';const decoder=new TextDecoder();
    while(!text.includes('€'))text+=decoder.decode((await iterator.next()).value.data,{stream:true});assert.equal(text,'\x1b[H€');
    await terminal.write(Uint8Array.from([3,65,10]));const echo=(await iterator.next()).value.data;assert.deepEqual([...echo],[3,65,10]);
    await terminal.resize(40,120);await new Promise(a=>setTimeout(a,50));assert.equal(windowChange.rows,40);assert.equal(windowChange.cols,120);
    assert.equal(request.protocol,'MIT-MAGIC-COOKIE-1');assert.notEqual(request.cookie.toString(),cookie.toString('hex'));
    for(let i=0;i<100 && !display.received.length;i++) await new Promise(a=>setTimeout(a,10));
    assert.deepEqual(Buffer.concat(display.received).subarray(32,48),cookie);
    remoteSession.exit(7);remoteSession.end();assert.deepEqual(await terminal.result,{reason:'exited',exitCode:7,signal:null,remoteProcessStopped:true});
    assert.equal(display.destroyed,true);await terminal.close();
    console.log('PASS: real loopback SSH authentication/pinning, PTY, split UTF-8, bidirectional control bytes, resize, exit, X11 negotiation/cookie substitution and teardown. Local X server is simulated.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearTimeout(deadline);for(const c of sockets)c.end();server.close();});
