/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import * as esbuild from 'esbuild';
import {prepareWebApplicationExport,exportFingerprint} from '../../src/utils/plugins/exporting/webApplicationExport';
const {buildWebExportAssets,webExportRuntimeSources}=require('../../scripts/build-web-export-assets.cjs');
const sdkSource=fs.readFileSync(require.resolve('@anikitenko/fdo-sdk'),'utf8');
let viewLibrary,runtimeSources;
beforeAll(async()=>{viewLibrary=await buildWebExportAssets();runtimeSources=webExportRuntimeSources();},30000);
const logical='plugins.shared.call.website-availability-provider.website-availability.v1';
const installed='plugins.shared.call.installed-provider.website-availability.v1';
const service={providerId:'website-availability-provider',name:'website-availability',version:1};
const binding={...service,installedProviderId:'installed-provider'};
const source=(name,capabilities,init)=>({virtual:{
    '/package.json':JSON.stringify({name,version:'1.0.0',source:'index.ts'}),
    '/index.ts':`import {FDO_SDK,PluginRegistry} from '@anikitenko/fdo-sdk';
class Application extends FDO_SDK {
get metadata(){return {name:${JSON.stringify(name)},version:'1.0.0',author:'Test',description:'Shared export fixture',icon:'code'};}
declareCapabilities(){return ${JSON.stringify(capabilities)};}
async init(){${init}}
render(){return '<main>Shared export</main>';}
renderOnLoad(){return ()=>{};}
} new Application();`,
},sourceEntry:'index.ts'});
function fixtures() {
    const consumer={id:'consumer',name:'Website consumer',capabilities:['plugins.shared.use',logical,installed],sharedLogicBindings:[binding]};
    const provider={id:'installed-provider',name:'Website provider',capabilities:['plugins.shared.provide','storage','storage.json']};
    const consumerSnapshot=source('consumer',['plugins.shared.use',logical],`
PluginRegistry.registerHandler('website.check',input=>this.shared.client(${JSON.stringify(service)}).call('check',input));
PluginRegistry.registerHandler('website.access',()=>this.shared.requestAccess(${JSON.stringify(service)}));
PluginRegistry.registerHandler('website.denied',()=>this.shared.client({...${JSON.stringify(service)},version:2}).call('check',{}));
PluginRegistry.registerHandler('website.list',()=>this.shared.list());
PluginRegistry.registerHandler('website.timeout',()=>this.shared.client(${JSON.stringify(service)}).call('wait',{}, {timeoutMs:50}));
PluginRegistry.registerHandler('website.cancel',async()=>{const controller=new AbortController();const call=this.shared.client(${JSON.stringify(service)}).call('wait',{}, {signal:controller.signal});setTimeout(()=>controller.abort(),50);return call;});
PluginRegistry.registerHandler('website.crash',()=>this.shared.client(${JSON.stringify(service)}).call('crash',{}));`);
    const providerSnapshot=source('provider',provider.capabilities,`
const store=PluginRegistry.useStore('json');
await this.shared.register({name:'website-availability',version:1,description:'Check fixture websites'}, {
check:(input,ctx)=>{const count=Number(store.get('count') || 0)+1;store.set('count',count);return {url:input.url,status:200,count,callerId:ctx.callerId,pid:process.pid};},
wait:(_input,ctx)=>new Promise(resolve=>ctx.signal.addEventListener('abort',()=>resolve({cancelled:true}),{once:true})),
crash:()=>process.exit(2),
}).ready;`);
    return {consumer,provider,consumerSnapshot,providerSnapshot};
}
const prepare=(fixture=fixtures(),overrides={})=>prepareWebApplicationExport({snapshot:fixture.consumerSnapshot,plugin:fixture.consumer,
    esbuild,sdkSource,viewLibrary,runtimeSources,resolveSharedProvider:async id=>id===fixture.provider.id?{snapshot:fixture.providerSnapshot,plugin:fixture.provider}:null,...overrides});
function writeExport(files,directory) {
    for(const [file,content] of Object.entries(files)){const destination=path.join(directory,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,content);}
}

test('Docker export includes approved providers and exact bindings, without merging grants or storage',async()=>{
    const fixture=fixtures(),before=JSON.stringify(fixture),result=await prepare(fixture);
    expect(result.report.blockers).toEqual([]);expect(JSON.stringify(fixture)).toBe(before);
    const dependency=result.report.sharedLogic.providers[0];
    expect(dependency).toMatchObject({id:'installed-provider',sourceFingerprint:exportFingerprint(fixture.providerSnapshot.virtual,fixture.provider)});
    const main=JSON.parse(result.files['deployment/application.json']);
    const provider=JSON.parse(result.files[dependency.directory+'/deployment/application.json']);
    expect(main.sharedLogic.bindings).toEqual([binding]);
    expect(main.capabilities).toEqual(expect.arrayContaining([logical,installed,'plugins.shared.use']));
    expect(main.capabilities).not.toContain('storage');expect(main.capabilities).not.toContain('plugins.shared.provide');
    expect(provider.capabilities).toEqual(expect.arrayContaining(['plugins.shared.provide','storage']));
    expect(result.files['build.cjs']).toContain(dependency.directory);
    expect(result.files[dependency.directory+'/backend/app.cjs']).toBeDefined();
    expect(result.files['README.md']).toContain('Shared plugin services');
    expect(result.report.warnings.join(' ')).toContain('Only the reviewed application and listed shared-provider grants');
    expect(result.files['README.md']).not.toContain('grants outside this plugin');
    expect(exportFingerprint(fixture.consumerSnapshot.virtual,fixture.consumer)).not.toBe(exportFingerprint(fixture.consumerSnapshot.virtual,{...fixture.consumer,sharedLogicBindings:[]}));
});

test.each(['plugins.shared.use',logical,installed])('a missing approved %s grant blocks export',async missing=>{
    const fixture=fixtures();fixture.consumer.capabilities=fixture.consumer.capabilities.filter(id=>id!==missing);
    const result=await prepare(fixture);expect(result.files).toBeUndefined();
    expect(result.report.blockers.join(' ')).toMatch(/approved|not approved/);
});
test('missing, unapproved and incompatible providers produce review blockers',async()=>{
    const missing=await prepare(fixtures(),{resolveSharedProvider:async()=>null});
    expect(missing.files).toBeUndefined();expect(missing.report.blockers.join(' ')).toContain('must be installed');
    const fixture=fixtures();fixture.provider.capabilities=[];
    const denied=await prepare(fixture);expect(denied.files).toBeUndefined();expect(denied.report.blockers.join(' ')).toContain('plugins.shared.provide');
    const incompatible=fixtures();incompatible.providerSnapshot.sourceCompatibility={status:'incompatible',issues:['Requires newer SDK.']};
    const blocked=await prepare(incompatible);expect(blocked.files).toBeUndefined();expect(blocked.report.blockers.join(' ')).toContain('Requires newer SDK.');
});

test('exported processes invoke the real SDK shared handlers, cancel calls, persist provider data and fail explicitly after a provider exits',async()=>{
    const result=await prepare();expect(result.report.blockers).toEqual([]);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-shared-'));
    try {
        writeExport(result.files,directory);
        // Exercise the editable Docker build script too, resolving the existing
        // pinned test dependencies without installing anything over the network.
        const env={...process.env,NODE_PATH:path.resolve('node_modules'),WEB_APP_DATA_DIR:path.join(directory,'data'),WEB_APP_SECRET_KEY:Buffer.alloc(32,4).toString('base64')};
        execFileSync(process.execPath,['build.cjs'],{cwd:directory,env,encoding:'utf8',timeout:30000});
        const script=`(async()=>{
const runtime=require('./runtime/application.cjs');require('./backend/app.cjs');
try{await runtime.initialize();
const first=await runtime.invoke('website.check',{url:'https://example.com'});
const codes={};for(const name of ['denied','timeout','cancel'])try{await runtime.invoke('website.'+name,{});}catch(error){codes[name]=error.code;}
const access=await runtime.invoke('website.access',{}),catalog=await runtime.invoke('website.list',{});
try{await runtime.invoke('website.crash',{});}catch(error){codes.crash=error.code;}
try{await runtime.invoke('website.check',{url:'https://example.com'});}catch(error){codes.afterCrash=error.code;}
console.log('RESULT '+JSON.stringify({first,codes,access,catalog,mainPid:process.pid}));
}finally{await runtime.shutdown();}
})().catch(error=>{console.error(error);process.exitCode=1;});`;
        const output=execFileSync(process.execPath,['-e',script],{cwd:directory,env,encoding:'utf8',timeout:30000});
        const value=JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT ')).slice(7));
        expect(value.first).toMatchObject({url:'https://example.com',status:200,count:1,callerId:'consumer'});
        expect(value.first.pid).not.toBe(value.mainPid);
        expect(value.codes).toEqual({denied:'ACCESS_DENIED',timeout:'TIMEOUT',cancel:'CANCELLED',crash:'UNAVAILABLE',afterCrash:'UNAVAILABLE'});
        expect(value.access).toEqual({state:'approved',capability:logical});
        expect(value.catalog).toContainEqual(expect.objectContaining({providerId:'installed-provider',name:'website-availability'}));
        // A fresh standalone run loads the provider's own persisted store.
        const again=execFileSync(process.execPath,['-e',`(async()=>{const r=require('./runtime/application.cjs');require('./backend/app.cjs');try{await r.initialize();console.log('RESULT '+JSON.stringify(await r.invoke('website.check',{url:'https://example.com'})));}finally{await r.shutdown();}})().catch(e=>{console.error(e);process.exitCode=1;});`],{cwd:directory,env,encoding:'utf8',timeout:30000});
        expect(JSON.parse(again.split('\n').find(line=>line.startsWith('RESULT ')).slice(7)).count).toBe(2);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
},90000);

test('transitive providers are included once in dependency order, and dependency cycles are blocked',async()=>{
    const fixture=fixtures(),leaf={id:'leaf',name:'Leaf',capabilities:['plugins.shared.provide']};
    const leafCap='plugins.shared.call.leaf.lookup.v1';
    fixture.provider.capabilities.push('plugins.shared.use',leafCap);
    fixture.providerSnapshot=source('provider',fixture.provider.capabilities,'');
    const leafSnapshot=source('leaf',leaf.capabilities,'');
    const resolver=async id=>id===fixture.provider.id?{plugin:fixture.provider,snapshot:fixture.providerSnapshot}:id==='leaf'?{plugin:leaf,snapshot:leafSnapshot}:null;
    const result=await prepare(fixture,{resolveSharedProvider:resolver});
    expect(result.report.blockers).toEqual([]);expect(result.report.sharedLogic.providers.map(item=>item.id)).toEqual(['leaf','installed-provider']);
    const cycle='plugins.shared.call.consumer.reverse.v1';leaf.capabilities.push('plugins.shared.use',cycle);fixture.consumer.capabilities.push('plugins.shared.provide');
    const cyclic=await prepare(fixture,{resolveSharedProvider:async id=>id==='consumer'?{plugin:fixture.consumer,snapshot:fixture.consumerSnapshot}:id==='leaf'?{plugin:leaf,snapshot:source('leaf',leaf.capabilities,'')}:resolver(id)});
    expect(cyclic.files).toBeUndefined();expect(cyclic.report.blockers.join(' ')).toContain('dependency cycle');
},30000);

test('decorated shared functions and backend handlers are initialized in standalone exports',async()=>{
    const fixture=fixtures();
    fixture.providerSnapshot=source('provider',['plugins.shared.provide'],'');
    fixture.providerSnapshot.virtual['/index.ts']=fixture.providerSnapshot.virtual['/index.ts']
        .replace('FDO_SDK,PluginRegistry','FDO_SDK,PluginRegistry,sharedFunction')
        .replace('async init(){}',`async init(){}\n@sharedFunction({service:'website-availability',version:1,description:'Decorated fixture'})\ncheck(input,ctx){return {url:input.url,callerId:ctx.callerId};}`);
    fixture.consumerSnapshot=source('consumer',['plugins.shared.use',logical],'');
    fixture.consumerSnapshot.virtual['/index.ts']=fixture.consumerSnapshot.virtual['/index.ts']
        .replace('FDO_SDK,PluginRegistry','FDO_SDK,PluginRegistry,handler')
        .replace('async init(){}',`async init(){}\n@handler('website.check')\ncheck(input){return this.shared.client(${JSON.stringify(service)}).call('check',input);}`);
    const result=await prepare(fixture);expect(result.report.blockers).toEqual([]);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'web-shared-decorated-'));
    try {
        writeExport(result.files,directory);
        const script=`(async()=>{const r=require('./runtime/application.cjs');r.runBackend(()=>require('./backend/app.cjs'));try{await r.initialize();console.log('RESULT '+JSON.stringify(await r.invoke('website.check',{url:'https://example.com'})));}finally{await r.shutdown();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
        const output=execFileSync(process.execPath,['-e',script],{cwd:directory,encoding:'utf8',timeout:30000,env:{...process.env,NODE_PATH:path.resolve('node_modules'),WEB_APP_DATA_DIR:path.join(directory,'data')}});
        expect(JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT ')).slice(7))).toEqual({url:'https://example.com',callerId:'consumer'});
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
},45000);
