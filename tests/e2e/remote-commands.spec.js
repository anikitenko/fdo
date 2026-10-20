const {test,expect,_electron:electron}=require('@playwright/test');
const {Server}=require('ssh2');
const {generateEd25519}=require('../../src/utils/hostServices/sshKeys.cjs');
const {fingerprint}=require('../../src/utils/hostServices/ssh.cjs');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');
const {deploySdkExample,selectPluginOpen,waitForPluginReady,removePlugin}=require('./helpers/sdkExamples');
const grants=['ssh.use','ssh.exec','ssh.status.watch','ssh.profiles.list','secrets.use','secrets.consume','storage','storage.json'];
const source=`
const {FDO_SDK,PluginRegistry}=require('@anikitenko/fdo-sdk');
class RemoteFixture extends FDO_SDK {
 get metadata(){return {name:'Remote commands fixture',author:'FDO',version:'1.0.0',description:'Live SSH host acceptance',icon:'key'};}
 declareCapabilities(){return ${JSON.stringify(grants)};}
 init(){
  let execution,watch,status,events=[],finished=false,result,error;
  PluginRegistry.registerHandler('watch',async()=>{watch=this.ssh.watchStatus('vm');status=(await watch.next()).value;
   void(async()=>{try{for await(const value of watch)status=value;}catch{status={state:'unknown'};}})();return status;});
  PluginRegistry.registerHandler('status',()=>status);
  PluginRegistry.registerHandler('unwatch',async()=>{await watch.return();return {ok:true};});
  PluginRegistry.registerHandler('start',async input=>{
   events=[];finished=false;result=undefined;error=undefined;
   execution=await this.ssh.start({profileId:'vm',command:input.command,timeoutMs:3000,maxOutputBytes:1024});
   const output=(async()=>{for await(const event of execution.events)events.push(event);})();
   void Promise.all([execution.result,output]).then(([value])=>{result=value;finished=true;},failure=>{error=failure.code;finished=true;});
   return {started:true};});
  PluginRegistry.registerHandler('poll',()=>({events:events.splice(0),finished,result,error}));
  PluginRegistry.registerHandler('cancel',async()=>await execution.cancel());
  PluginRegistry.registerHandler('save',async()=>{const store=PluginRegistry.useStore('json');store.set('acceptance','saved after flush');await store.flush();return {saved:true,value:store.get('acceptance')};});
 }
 render(){return '<p>Remote Commands host acceptance</p>';}
}
new RemoteFixture();`;

test('real SDK worker monitors, streams, cancels and acknowledges persistent writes through the native host',async()=>{
 test.setTimeout(120000);let app;const clients=new Set(),timers=new Set();let commandCount=0;
 const host=generateEd25519();
 const trustedHostKey=fingerprint(host.publicSSH);
 const server=new Server({hostKeys:[host.private]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',context=>context.method==='password'&&context.password==='native-private-fixture'?context.accept():context.reject());
  client.on('ready',()=>client.on('session',accept=>accept().on('exec',(acceptCommand,_reject,info)=>{
   commandCount++;const stream=acceptCommand();stream.on('error',()=>{});if(info.command==='hang')return;
   stream.write('live first');const timer=setTimeout(()=>{timers.delete(timer);stream.stderr.write('live stderr');stream.exit(0);stream.end();},1500);timers.add(timer);
  })));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  app=await launchElectronApp(electron,{isolatedUserDataDir:true});const page=await app.firstWindow();
  await app.evaluate(()=>{const childProcess=process.getBuiltinModule('node:child_process');for(const method of ['spawn','execFile']){const original=childProcess[method];childProcess[method]=function(command,...args){if(/(?:^|[\\/])ssh(?:\.exe)?$/i.test(command))throw new Error('External SSH unavailable');return original.call(this,command,...args);};}});
  const id='remote-commands-e2e';await deploySdkExample(page,{relativePath:'remote-commands-fixture'},{pluginName:id,compiledContent:source,capabilities:grants});
  await selectPluginOpen(page,id);await waitForPluginReady(page,id);
  await page.evaluate(async({id,port,trustedHostKey})=>{
   const api=window.electron.credentialSettings;
   await api.saveSecret(id,'password','native-private-fixture');
   const saved=await api.saveProfile(id,{id:'vm',label:'Native VM',host:'127.0.0.1',port,username:'fixture',trustedHostKey,authentication:{type:'password',passwordRef:{kind:'secret',key:'password'}},policy:{consumers:['ssh.exec'],commands:['live','hang']}},true);
   if(saved?.success===false)throw new Error(JSON.stringify(saved));
  },{id,port:server.address().port,trustedHostKey});
  await expect.poll(async()=>page.evaluate(async id=>{const response=await window.electron.plugin.getRuntimeStatus([id]);const status=response.statuses?.[0];return !!(status?.loaded&&status?.ready&&status?.inited);},id),{timeout:20000}).toBe(true);
  const call=(handler,content={})=>page.evaluate(({id,handler,content})=>window.electron.plugin.uiMessage(id,{handler,content}),{id,handler,content});
  const initial=await call('watch');
  expect(initial,JSON.stringify(await page.evaluate(async id=>{const trace=await window.electron.plugin.getLogTrace(id);return {lifecycle:trace.lifecycleEvents,output:trace.liveOutputTail};},id))).toMatchObject({state:'unknown',checkedAt:null});
  await expect.poll(async()=>(await call('status'))?.state).toBe('connected');
  const status=await call('status');expect(Date.now()-Date.parse(status.checkedAt)).toBeLessThan(status.staleAfterMs);expect(commandCount).toBe(0);
  expect(await call('start',{command:'live'})).toEqual({started:true});let first;
  await expect.poll(async()=>{first=await call('poll');return first.events?.length||0;}).toBeGreaterThan(0);
  expect(first.finished).toBe(false);expect(first.events[0]).toMatchObject({sequence:0,stream:'stdout',data:'live first'});
  let terminal;await expect.poll(async()=>{terminal=await call('poll');return terminal.finished;}).toBe(true);
  expect(terminal.result).toMatchObject({stdout:'live first',stderr:'live stderr',truncated:false,exitCode:0});
  await call('start',{command:'hang'});expect(await call('cancel')).toEqual({remoteProcessStopped:null});
  await expect.poll(async()=>(await call('poll')).error).toBe('CANCELLED');
  expect(await call('save')).toEqual({saved:true,value:'saved after flush'});
  await call('unwatch');await removePlugin(page,id);
 }finally{if(app)await closeElectronApp(app);for(const timer of timers)clearTimeout(timer);for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}
});
