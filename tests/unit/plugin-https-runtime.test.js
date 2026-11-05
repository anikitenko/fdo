/** @jest-environment node */
import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {webcrypto} from 'node:crypto';
import {cryptoProvider, X509CertificateGenerator, BasicConstraintsExtension, SubjectAlternativeNameExtension} from '@peculiar/x509';
jest.mock('electron', () => ({app:{getPath:()=>'/tmp'}}));
import {buildPluginRuntimeBootstrapSource,buildPluginRuntimePolicy} from '../../src/utils/plugins/security/pluginRuntimeSecurity';
import {buildPluginWorkerEnvironment} from '../../src/utils/plugins/security/pluginWorkerEnvironment';

test('clean workers perform real scoped HTTPS without exposing raw TLS/DNS through CJS, builtin or ESM imports',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-https-runtime-'));
    cryptoProvider.set(webcrypto);
    const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
    const cert=await X509CertificateGenerator.createSelfSigned({serialNumber:'01',name:'CN=FDO local test CA',keys,signingAlgorithm:{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},notBefore:new Date(Date.now()-60000),notAfter:new Date(Date.now()+86400000),extensions:[new BasicConstraintsExtension(true,undefined,true),new SubjectAlternativeNameExtension([{type:'ip',value:'127.0.0.1'}])]});
    const pem=cert.toString('pem');fs.writeFileSync(path.join(root,'ca.pem'),pem);
    const key=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64').match(/.{1,64}/g).join('\n');
    let requests=0;
    const server=https.createServer({key:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,cert:pem},(req,res)=>{
        requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({stock:'available'}));
    });
    try {
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        const port=server.address().port,url=`https://127.0.0.1:${port}/stocks`;
        const bootstrap=path.join(root,'bootstrap.cjs'),entry=path.join(root,'entry.cjs');
        fs.writeFileSync(bootstrap,buildPluginRuntimeBootstrapSource());
        fs.writeFileSync(entry,`
(async()=>{
 const url=${JSON.stringify(url)},port=${port};
 const denied=async work=>{try{await work();return false;}catch(e){return e.code==='FDO_PLUGIN_PERMISSION_DENIED';}};
 const tls=require('node:tls');
 const rawTLS=await denied(()=>tls.connect({host:'127.0.0.1',port}));
 const builtinTLS=await denied(()=>process.getBuiltinModule('tls').connect({host:'127.0.0.1',port}));
 const esm=await import('node:tls');
 const esmTLS=await denied(()=>esm.connect({host:'127.0.0.1',port}));
 const esmDefaultTLS=await denied(()=>esm.default.connect({host:'127.0.0.1',port}));
 const dns=await denied(()=>import('node:dns'));
 const net=await denied(()=>require('node:net'));
 const forbidden=await denied(()=>fetch('https://localhost:'+port+'/denied'));
 const esmHTTPS=await import('node:https');
 const esmForbidden=await denied(()=>esmHTTPS.get('https://localhost:'+port+'/denied'));
 const response=await fetch(url);const data=await response.json();
 const legacy=await new Promise((resolve,reject)=>require('node:https').get(url,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s).stock));}).on('error',reject));
 console.log('RESULT:'+JSON.stringify({rawTLS,builtinTLS,esmTLS,esmDefaultTLS,dns,net,forbidden,esmForbidden,status:response.status,stock:data.stock,legacy,hostKeyAbsent:process.env.AWS_SECRET_ACCESS_KEY===undefined}));
})().catch(e=>{console.error(e.stack,e.cause);process.exitCode=1;});
`);
        const caps=['system.network','system.network.https','system.network.scope.public-web-secure'];
        const policy={...buildPluginRuntimePolicy(caps),networkScopes:[{allowedTransports:['fetch'],allowedSchemes:['https'],allowedHostPatterns:['127.0.0.1'],allowedPorts:[String(port)]}]};
        const env=buildPluginWorkerEnvironment({pluginHome:root,pluginCodeHome:root,runtimeEntry:entry,bootstrapEntry:bootstrap,nodeModulesPath:path.resolve('node_modules'),grantedCapabilities:caps,runtimePolicy:policy,hostEnv:{AWS_SECRET_ACCESS_KEY:'synthetic-private'}});
        // Explicit fixture trust, not inherited host configuration. Normal worker environments exclude this variable.
        const {stdout,stderr}=await promisify(execFile)(process.execPath,[bootstrap],{timeout:15000,env:{...env,FDO_PLUGIN_ALLOW_MISSING_PARENT_PORT:'1',NODE_EXTRA_CA_CERTS:path.join(root,'ca.pem')}});
        expect(stderr).toBe('');expect(requests).toBe(2);
        expect(JSON.parse(stdout.split('RESULT:')[1])).toEqual({rawTLS:true,builtinTLS:true,esmTLS:true,esmDefaultTLS:true,dns:true,net:true,forbidden:true,esmForbidden:true,status:200,stock:'available',legacy:'available',hostKeyAbsent:true});
    } finally {
        server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});
    }
},25000);
