/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {buildPluginRuntimeBootstrapSource} from '../../src/utils/plugins/security/pluginRuntimeSecurity';
import {requestPluginUiMessage} from '../../src/utils/plugins/runtime/pluginUiRequest';
const {createSharedLogicBroker} = require('../../src/utils/plugins/runtime/sharedLogicBroker.cjs');
const {attachHostServiceBridge,drainWorkerStorage} = require('../../src/utils/hostServices/workerBridge.cjs');
jest.mock('electron',()=>({app:{getPath:()=>'/tmp'}}));

// Set FDO_SHARED_TEST_SDK_BUNDLE to test an unpublished SDK checkout. Once FDO's
// SDK dependency contains the feature, the installed package runs this by default.
const bundle=process.env.FDO_SHARED_TEST_SDK_BUNDLE || require.resolve('@anikitenko/fdo-sdk');
const sharedTest=fs.readFileSync(bundle,'utf8').includes('dispatchSharedLogic')?test:test.skip;
function waitMessage(child,predicate) {
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>done(new Error('Shared worker response timed out: '+JSON.stringify(child.fixtureMessages||[])+' '+(child.fixtureStderr||''))),7000);
        const message=value=>{if(predicate(value))done(null,value);};
        const exit=code=>done(new Error(`Shared worker exited: ${code} ${child.fixtureStderr || ""}`));
        function done(error,value){clearTimeout(timer);child.off('message',message);child.off('exit',exit);error?reject(error):resolve(value);}
        child.on('message',message);child.once('exit',exit);
    });
}
sharedTest('two real bootstrapped workers share approved logic, enforce revocation, and unregister on shutdown',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-shared-workers-'));
    const packageRoot=path.join(root,'node_modules','@anikitenko','fdo-sdk');
    fs.mkdirSync(path.join(packageRoot,'dist'),{recursive:true});
    fs.copyFileSync(bundle,path.join(packageRoot,'dist','sdk.cjs'));
    fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({name:'@anikitenko/fdo-sdk',version:'1.8.3',main:'dist/sdk.cjs'}));
    fs.writeFileSync(path.join(root,'bootstrap.cjs'),buildPluginRuntimeBootstrapSource());
    fs.writeFileSync(path.join(root,'parent.cjs'),`const {EventEmitter}=require('node:events');const port=new EventEmitter();process.parentPort=port;port.postMessage=message=>process.send(message);process.on('message',message=>port.emit('message',{data:message}));`);
    const target={providerId:'website-provider',name:'website-availability',version:1};
    const capability='plugins.shared.call.website-provider.website-availability.v1';
    const grants={'website-provider':['plugins.shared.provide'],consumer:['plugins.shared.use',capability]};
    const workers={};const running=[];const closes=[];
    const broker=createSharedLogicBroker({getWorker:id=>workers[id],getGrants:id=>grants[id]});
    async function start(id,body) {
        const home=path.join(root,id);fs.mkdirSync(home,{recursive:true});
        fs.writeFileSync(path.join(home,'entry.cjs'),`const {FDO_SDK,PluginRegistry}=require('@anikitenko/fdo-sdk');
class Fixture extends FDO_SDK {get metadata(){return {id:'${id}',name:'Fixture',version:'1.0.0',author:'SDK',description:'shared fixture',icon:'cog'};}render(){return '<p>ok</p>';}init(){${body}}}
new Fixture();process.send({type:'fixture-loaded'});`);
        const child=fork(path.join(root,'bootstrap.cjs'),[],{execArgv:['-r',path.join(root,'parent.cjs')],silent:true,cwd:home,
            env:{...process.env,FDO_PLUGIN_RUNTIME_ENTRY:path.join(home,'entry.cjs'),FDO_PLUGIN_NODE_PATH:path.join(root,'node_modules'),
                FDO_PLUGIN_POLICY_JSON:JSON.stringify({blockedModules:[]}),FDO_PLUGIN_CAPABILITIES:grants[id].join(','),
                PLUGIN_HOME:home,PLUGIN_CODE_HOME:home,FDO_SDK_LOG_ROOT:path.join(home,'logs')}});
        child.postMessage=message=>child.send(message);
        child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{child.fixtureStderr=((child.fixtureStderr||'')+String(chunk)).slice(-4096);});
        child.fixtureMessages=[];child.on('message',message=>{child.fixtureMessages.push({type:message.type,message:message.message,op:message.request?.payload?.op,error:message.response?.error});if(child.fixtureMessages.length>10)child.fixtureMessages.shift();});
        running.push(child);workers[id]={instance:child,sessionId:`${id}-session`,grantedCapabilities:[...grants[id]]};
        const endpoint=broker.bind(id,child,workers[id].sessionId);
        closes.push(attachHostServiceBridge(child,{request:request=>{
            if(request.action!=='plugins.shared')throw new Error('unexpected request');return endpoint.request(request.payload);
        },close:endpoint.close}));
        await waitMessage(child,value=>value.type==='fixture-loaded');
        const initialized=waitMessage(child,value=>value.type==='fixture-ready');
        child.send({message:'PLUGIN_INIT',content:{capabilities:grants[id]}});
        await initialized;return child;
    }
    try {
        const provider=await start('website-provider',`let count=0;const registration=this.shared.register({name:'website-availability',version:1,description:'Reusable website checks'},{check:async(input,context)=>({available:true,url:input.url,callerId:context.callerId,count:++count})});registration.ready.then(()=>process.send({type:'fixture-ready'}));`);
        const consumer=await start('consumer',`PluginRegistry.registerHandler('check',()=>this.shared.call(${JSON.stringify(target)},'check',{url:'https://example.com'}).catch(error=>({code:error.code})));process.send({type:'fixture-ready'});`);
        const check=()=>requestPluginUiMessage(consumer,'consumer','consumer-session',{handler:'check'},{timeoutMs:3000});
        expect(await check()).toEqual({available:true,url:'https://example.com',callerId:'consumer',count:1});
        grants.consumer=['plugins.shared.use'];
        expect(await check()).toEqual({code:'ACCESS_DENIED'});
        grants.consumer.push(capability);
        expect((await check()).count).toBe(2);
        const consumerListeners = consumer.listenerCount('message');
        const providerListeners = provider.listenerCount('message');
        for (let i = 0; i < 200; i++) expect((await check()).count).toBe(i + 3);
        expect(consumer.listenerCount('message')).toBe(consumerListeners);
        expect(provider.listenerCount('message')).toBe(providerListeners);
        expect(await drainWorkerStorage(provider,3000)).toEqual({success:true});
        expect(broker.catalog()).toEqual([]);
        expect(await check()).toEqual({code:'UNAVAILABLE'});
    } finally {
        for(const close of closes)close();
        await Promise.all(running.map(child=>new Promise(resolve=>{if(child.exitCode!==null || child.signalCode!==null){resolve();return;}child.once('exit',resolve);child.kill();})));
        fs.rmSync(root,{recursive:true,force:true});
    }
},20000);
