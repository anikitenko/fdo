const {test,expect,_electron:electron}=require('@playwright/test');
const {Server,utils}=require('ssh2');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');
const {deploySdkExample,selectPluginOpen,waitForPluginReady,removePlugin}=require('./helpers/sdkExamples');
const {createSSHCapabilityBundle}=require('@anikitenko/fdo-sdk');
const grants=createSSHCapabilityBundle({terminal:true,x11:true});
test('SDK interactive terminal renders lossless PTY bytes, sends keyboard input and closes on host view release',async({},testInfo)=>{
 test.setTimeout(120000);let app;const clients=new Set();let shellCount=0,input='',lastSize;
 const key=utils.generateKeyPairSync('ed25519');
 const trustedHostKey='SHA256:'+createHash('sha256').update(utils.parseKey(key.private).getPublicSSH()).digest('base64').replace(/=+$/,'');
 const server=new Server({hostKeys:[key.private]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',context=>context.method==='password'&&context.password==='private terminal fixture'?context.accept():context.reject());
  client.on('ready',()=>client.on('session',accept=>{
   const session=accept();session.on('pty',(accept,_reject,info)=>{lastSize=info;accept();});session.on('window-change',(accept,_reject,info)=>{lastSize=info;accept?.();});
   session.on('shell',accept=>{shellCount++;const channel=accept();channel.on('error',()=>{});channel.write('\x1b[32mHost terminal ready €\x1b[0m\r\n');channel.on('data',data=>{input+=data.toString();channel.write(data);});});
  }));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  app=await launchElectronApp(electron,{isolatedUserDataDir:true});const page=await app.firstWindow(),id='terminal-acceptance';
  const entry={relativePath:'18-interactive-ssh-plugin.ts',absPath:path.resolve('node_modules/@anikitenko/fdo-sdk/examples/18-interactive-ssh-plugin.ts')};
  await deploySdkExample(page,entry,{pluginName:id,capabilities:grants});await selectPluginOpen(page,id);await waitForPluginReady(page,id);
  await page.evaluate(async({id,port,trustedHostKey})=>{
   const api=window.electron.credentialSettings;await api.saveSecret(id,'password','private terminal fixture');
   const saved=await api.saveProfile(id,{id:'vm',label:'Interactive fixture',host:'127.0.0.1',port,username:'fixture',trustedHostKey,authentication:{type:'password',passwordRef:{kind:'secret',key:'password'}},policy:{consumers:['ssh.terminal.open'],commands:[]}},true);
   if(!saved.success)throw new Error(JSON.stringify(saved));
  },{id,port:server.address().port,trustedHostKey});
  const support=await page.evaluate(id=>window.electron.credentialSettings.checkX11(id),id);expect(support.success).toBe(true);expect(typeof support.availability.untrusted.available).toBe('boolean');expect(JSON.stringify(support)).not.toMatch(/MIT-MAGIC-COOKIE|dataBase64|private terminal fixture/);
  const frame=page.frameLocator(`iframe[data-plugin-id="${id}"]`);
  await expect(frame.locator('#terminal-profile')).toBeVisible();await frame.locator('#terminal-profile').fill('vm');await frame.locator('#terminal-open').click();
  await expect(frame.locator('#terminal-status')).toContainText('Interactive shell.',{timeout:20000});
  await expect.poll(()=>shellCount).toBe(1);
  const buffer=()=>frame.locator('#terminal-screen').innerText();await expect.poll(buffer).toContain('Host terminal ready €');
await frame.locator('.xterm-helper-textarea').pressSequentially('hello');
  await expect.poll(()=>input).toContain('hello');await expect.poll(buffer).toContain('hello');
  expect(lastSize.rows).toBeGreaterThan(0);expect(lastSize.cols).toBeGreaterThan(0);
  await page.screenshot({path:testInfo.outputPath('ssh-interactive-terminal.png')});
  await frame.locator('#terminal-close').click();await expect.poll(()=>clients.size).toBe(0);
  const health=await page.evaluate(async id=>({status:await window.electron.plugin.getRuntimeStatus([id]),trace:await window.electron.plugin.getLogTrace(id)}),id);expect(health.status.statuses[0].loaded,JSON.stringify(health)).toBe(true);
  await frame.locator('#terminal-mode').selectOption('trusted');await frame.locator('#terminal-open').click();
  await expect(frame.locator('#terminal-status')).toContainText('ACCESS_DENIED');expect(shellCount).toBe(1);
  await frame.locator('#terminal-mode').selectOption('off');await frame.locator('#terminal-open').click();await expect(frame.locator('#terminal-status')).toContainText('Interactive shell.');
  await page.evaluate(id=>window.electron.plugin.deactivate(id),id);await expect.poll(()=>clients.size).toBe(0);
  await removePlugin(page,id);
 }finally{if(app)await closeElectronApp(app);for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}
});
