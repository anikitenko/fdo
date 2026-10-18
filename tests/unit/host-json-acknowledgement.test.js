/** @jest-environment node */
const {test,expect}=require('@jest/globals');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

test('installed SDK JSON save acknowledges atomic flush, rejects missing setup/write failures and recovers across restart',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-json-ack-'));
 const sdk=path.resolve('node_modules/@anikitenko/fdo-sdk');
 const invoke=source=>{
  const entry=path.join(root,'fixture.cjs');fs.writeFileSync(entry,source);
  const result=spawnSync(process.execPath,[entry],{encoding:'utf8',timeout:10000,env:{...process.env,FDO_SDK_LOG_ROOT:path.join(root,'logs'),FDO_SDK_STORAGE_ROOT:''}});
  expect(result.status).toBe(0);return JSON.parse(result.stdout.split('RESULT:').at(-1));
 };
 try {
  const storage=path.join(root,'storage');
  const result=invoke(`
const fs=require('node:fs'),path=require('node:path');const {PluginRegistry}=require(${JSON.stringify(sdk)});
(async()=>{
 let missingGrants=false,missingRoot=false,rejected=false,diskFull=false;
 PluginRegistry.configureCapabilities({granted:[]});try{PluginRegistry.useStore('json');}catch{missingGrants=true;}
 PluginRegistry.configureCapabilities({granted:['storage','storage.json']});try{PluginRegistry.useStore('json');}catch{missingRoot=true;}
 fs.writeFileSync(${JSON.stringify(storage)},'blocked root');PluginRegistry.configureStorage({rootDir:${JSON.stringify(storage)}});
 const store=PluginRegistry.useStore('json');store.set('setting','not acknowledged');try{await store.flush();}catch{rejected=true;}
 fs.unlinkSync(${JSON.stringify(storage)});store.set('setting','recovered');await store.flush();
 const mkdir=fs.promises.mkdir;fs.promises.mkdir=async()=>{throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});};
 store.set('setting','disk full snapshot');try{await store.flush();}catch{diskFull=true;}
 fs.promises.mkdir=mkdir;store.set('setting','persisted');await store.flush();await store.dispose();
 process.stdout.write('RESULT:'+JSON.stringify({missingGrants,missingRoot,rejected,diskFull,value:store.get('setting')}));
})().catch(error=>{console.error(error);process.exitCode=1;});
`);
  expect(result).toEqual({missingGrants:true,missingRoot:true,rejected:true,diskFull:true,value:'persisted'});
  const restart=invoke(`const {PluginRegistry}=require(${JSON.stringify(sdk)});PluginRegistry.configureCapabilities({granted:['storage','storage.json']});PluginRegistry.configureStorage({rootDir:${JSON.stringify(storage)}});process.stdout.write('RESULT:'+JSON.stringify({value:PluginRegistry.useStore('json').get('setting')}));`);
  expect(restart).toEqual({value:'persisted'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
