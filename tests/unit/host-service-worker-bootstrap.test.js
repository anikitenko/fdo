/** @jest-environment node */
import {expect, jest, test} from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildPluginRuntimeBootstrapSource} from '../../src/utils/plugins/security/pluginRuntimeSecurity';
jest.mock('electron', () => ({app: {getPath: () => '/tmp'}}));

test('installs the real SDK adapter before backend calls, preserves the native port, and cleans pending calls on disconnect', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-service-worker-'));
    try {
        fs.writeFileSync(path.join(root, 'bootstrap.cjs'), buildPluginRuntimeBootstrapSource());
        fs.writeFileSync(path.join(root, 'parent.cjs'), `
const {EventEmitter} = require('node:events');
const port = new EventEmitter(); const values = new Map();
port.postMessage = message => {
 if (message.type === 'HOST_SERVICE_DISCONNECT_V1') {global.__serviceDisconnected=true; return;}
 if (message.type !== 'HOST_SERVICE_REQUEST_V1') return;
 if(message.operation) {
   const handle=message.payload.handle;let result;
   if(message.operation==='terminal.open')result={handle:'terminal-fixture'};
   if(message.operation==='terminal.next')result=global.__terminalRead?{done:true}:(global.__terminalRead=true,{done:false,value:{sequence:0,dataBase64:Buffer.from('terminal €').toString('base64')}});
   if(message.operation==='terminal.result'){global.__terminalResult=message.requestId;return;}
   if(['terminal.write','terminal.resize','terminal.eof'].includes(message.operation))result={accepted:true};
   if(message.operation==='terminal.eof'){result={accepted:true};queueMicrotask(()=>port.emit('message',{data:{message:'HOST_SERVICE_RESPONSE_V1',content:{requestId:global.__terminalResult,result:{reason:'exited',exitCode:0,signal:null,remoteProcessStopped:true}}}}));}
   if(message.operation==='terminal.close')result={closed:true};
   if(message.operation==='terminal.cancel')result={remoteProcessStopped:null};
   if(message.operation==='watch')result={handle:'watch-fixture'};
   if(message.operation==='start')result={handle:'execution-fixture'};
   if(message.operation==='next') {
     global.__liveNext ||= {};
     const index=global.__liveNext[handle]||0;global.__liveNext[handle]=index+1;
     result=handle==='watch-fixture'?{done:false,value:{profileId:'vm',state:index?'connected':'unknown',checkedAt:index?new Date().toISOString():null,staleAfterMs:20000}}
       :index?{done:true}:{done:false,value:{sequence:0,stream:'stdout',data:'live fixture'}};
   }
   if(message.operation==='result')result={stdout:'live fixture',stderr:'',exitCode:0,signal:null,durationMs:1,truncated:false};
   if(message.operation==='return')result={done:true};
   if(message.operation==='cancel')result={remoteProcessStopped:null};
   queueMicrotask(()=>port.emit('message',{data:{message:'HOST_SERVICE_RESPONSE_V1',content:{requestId:message.requestId,result}}}));return;
 }
 const {action,payload}=message.request;
 if (payload.key === 'pending') return;
 let result;
 if(action==='secrets.set') {values.set(payload.key,payload.value);result={stored:true};}
 if(action==='secrets.get') result={value:values.get(payload.key) ?? null};
 if(action==='secrets.list') result={entries:[...values.keys()].map(key=>({key,updatedAt:new Date().toISOString()}))};
 if(action==='secrets.delete') result={deleted:values.delete(payload.key)};
 queueMicrotask(()=>port.emit('message',{data:{message:'HOST_SERVICE_RESPONSE_V1',content:{requestId:message.requestId,result}}}));
};
process.parentPort=port; global.__nativeServicePort=port;
`);
        fs.writeFileSync(path.join(root, 'entry.cjs'), `
const {SecretStore,SSHClient,PluginRegistry,DOM}=require('@anikitenko/fdo-sdk');
PluginRegistry.configureCapabilities({granted:['secrets.use','secrets.set','secrets.get','secrets.list','secrets.delete','secrets.consume','ssh.use','ssh.exec','ssh.status.watch','ssh.terminal.open']});
(async()=>{
 const dom=new DOM();const css=dom.createClassFromStyle({color:'red'});const renders=dom.renderHTML(dom.createElement('p',{class:css},'render fixture')).includes('render fixture');
 const store=new SecretStore();
 await store.set('fixture','worker-private-value');
 const roundtrip=await store.get('fixture') === 'worker-private-value';
 const entries=await store.list(); const deleted=await store.delete('fixture');
 const ssh=new SSHClient();const status=ssh.watchStatus('vm');
 const initial=(await status.next()).value.state;const connected=(await status.next()).value.state;await status.return();
 const execution=await ssh.start({profileId:'vm',command:'uptime'});const output=[];
 for await(const event of execution.events)output.push(event.data);
 const result=await execution.result;const cancel=await execution.cancel();
 const terminal=await ssh.openTerminal({profileId:'vm'});const terminalOutput=[Buffer.from((await terminal.output[Symbol.asyncIterator]().next()).value.data).toString()];await terminal.write('hello');await terminal.resize(40,120);await terminal.endInput();await terminal.close();const terminalCancel=await terminal.cancel();const interactive=terminalOutput.join('')==='terminal €'&&(await terminal.result).reason==='exited'&&terminalCancel.remoteProcessStopped===null;
 const controller=new AbortController();const interrupted=await ssh.openTerminal({profileId:'vm'},controller.signal);controller.abort();const aborted=(await interrupted.result).reason==='cancelled';
 const live=aborted&&interactive&&initial==='unknown'&&connected==='connected'&&output.join('')===result.stdout&&cancel.remoteProcessStopped===null;
 const pending=store.get('pending'); PluginRegistry.clearPlugin();
 let code;try {await pending;} catch(error){code=error.code;}
 process.stdout.write('RESULT:'+JSON.stringify({renders,live,roundtrip,listed:entries.length===1,deleted,code,disconnected:global.__serviceDisconnected,nativePort:process.parentPort===global.__nativeServicePort,legacyBridge:typeof window.createBackendReq==='function'}));
})().catch(error=>{process.stderr.write(error.stack);process.exitCode=1;});
`);
        const result = spawnSync(process.execPath, ['-r', path.join(root, 'parent.cjs'), path.join(root, 'bootstrap.cjs')], {
            encoding: 'utf8', timeout: 10000,
            env: {...process.env, FDO_PLUGIN_RUNTIME_ENTRY: path.join(root, 'entry.cjs'), FDO_PLUGIN_NODE_PATH: path.resolve('node_modules'),
                FDO_PLUGIN_POLICY_JSON: JSON.stringify({blockedModules: []}), FDO_PLUGIN_CAPABILITIES: '', FDO_SDK_STORAGE_ROOT: root, FDO_SDK_LOG_ROOT: path.join(root, 'logs'), PLUGIN_HOME: root, PLUGIN_CODE_HOME: path.join(root, 'code')},
        });
        expect(result.stderr).not.toContain('Error:');
        expect(result.status).toBe(0);
        const output = result.stdout.split('RESULT:').at(-1);
        expect(JSON.parse(output)).toEqual({renders:true,live:true,roundtrip:true,listed:true,deleted:true,code:'UNAVAILABLE',disconnected:true,nativePort:true,legacyBridge:true});
        expect(result.stdout).not.toContain('worker-private-value');
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test.each([false,true])('worker storage shutdown awaits public flush/dispose and reports failure=%s safely',failure=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-flush-worker-'));
    try {
        fs.writeFileSync(path.join(root,'bootstrap.cjs'),buildPluginRuntimeBootstrapSource());
        fs.writeFileSync(path.join(root,'parent.cjs'),`
const {EventEmitter}=require('node:events');const port=new EventEmitter();process.parentPort=port;
port.postMessage=message=>{if(message.type==='HOST_STORAGE_SHUTDOWN_REPLY_V1')process.stdout.write('RESULT:'+JSON.stringify({success:message.success,...global.__snapshot()}));};
`);
        fs.writeFileSync(path.join(root,'entry.cjs'),`
const {PluginRegistry}=require('@anikitenko/fdo-sdk');let flushed=false,disposed=false;
PluginRegistry.registerStore('fixture',{get(){},set(){},delete(){},clear(){},has(){return false;},
 async flush(){await new Promise(resolve=>setTimeout(resolve,20));flushed=true;if(${failure})throw new Error('private disk provider message');},
 async dispose(){disposed=true;}});
PluginRegistry.useStore('fixture');global.__snapshot=()=>({flushed,disposed});
process.parentPort.emit('message',{data:{message:'HOST_STORAGE_SHUTDOWN_V1',content:{requestId:'fixture'}}});
`);
        const result=spawnSync(process.execPath,['-r',path.join(root,'parent.cjs'),path.join(root,'bootstrap.cjs')],{
            encoding:'utf8',timeout:10000,env:{...process.env,FDO_PLUGIN_RUNTIME_ENTRY:path.join(root,'entry.cjs'),FDO_PLUGIN_NODE_PATH:path.resolve('node_modules'),FDO_PLUGIN_POLICY_JSON:JSON.stringify({blockedModules:[]}),FDO_PLUGIN_CAPABILITIES:'',PLUGIN_HOME:root,PLUGIN_CODE_HOME:path.join(root,'code'),FDO_SDK_LOG_ROOT:path.join(root,'logs')},
        });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.split('RESULT:').at(-1))).toEqual({success:!failure,flushed:true,disposed:!failure});
        expect(result.stdout+result.stderr).not.toContain('private disk provider message');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
