// Offline transport, permission and OAuth probe: no provider account or inference.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const load = file => {const module = {exports: {}}; new Function('require', 'module', 'exports', esbuild.buildSync({entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs'}).outputFiles[0].text)(require, module, module.exports); return module.exports;};
const {prepareMcpBridges} = load('src/utils/ai/mcp/mcpRuntimeBridge.js');
const {configureMcpCredentialsStore, startMcpOAuth, mcpOAuthProvider} = load('src/utils/ai/mcp/mcpOAuth.js');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));};
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo mcp probe '));
 let bridges, oauth, upstream;
 try {
  const script = path.join(root, 'server with spaces.cjs');
  await fs.writeFile(script, `require('node:readline').createInterface({input:process.stdin}).on('line', line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,serverInfo:{name:'fixture',version:'1.0.0'},capabilities:{tools:{}}};if(m.method==='tools/list')result={tools:['allowed','denied'].map(name=>({name,inputSchema:{type:'object'}}))};if(m.method==='tools/call')result={content:[{type:'text',text:process.env.PROBE_VALUE+'|'+process.cwd()}]};if(m.method==='ping')result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  bridges = await prepareMcpBridges([{id:'stdio',transport:'stdio',command:process.execPath,args:[script],cwd:root,environment:{PROBE_VALUE:'configured'},enabledTools:['allowed']}]);
  const server=bridges.servers[0];
  const rpc=async(method,params,token=server.bearerToken)=>{const response=await fetch(server.url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return response.status===403?403:response.json();};
  assert.equal(await rpc('tools/list',{},'wrong'),403);
  assert.deepEqual((await rpc('tools/list',{})).result.tools.map(t=>t.name),['allowed']);
  assert.ok((await rpc('tools/call',{name:'denied',arguments:{}})).error);
  assert.equal((await rpc('tools/call',{name:'allowed',arguments:{}})).result.content[0].text,`configured|${await fs.realpath(root)}`);
  await bridges.close(); bridges=undefined;
  console.log('PASS stdio command, paths with spaces, environment, cwd, bridge authentication and tool allowlist');

  let headerCalls = 0;
  upstream = http.createServer(async (req,res) => {
   let body='';for await(const c of req)body+=c;
   assert.equal(req.headers['x-team-token'],'private-header'); headerCalls++;
   if(req.method !== 'POST'){res.writeHead(405);res.end();return;}
   const m=JSON.parse(body);if(m.id===undefined){res.writeHead(202);res.end();return;}
   const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,serverInfo:{name:'http-fixture',version:'1.0.0'},capabilities:{tools:{}}}:m.method==='tools/list'?{tools:[{name:'allowed',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'HTTP result'}]};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });
  await listen(upstream);
  bridges=await prepareMcpBridges([{id:'http',transport:'http',url:`http://127.0.0.1:${upstream.address().port}/mcp`,headers:{'X-Team-Token':'private-header'},enabledTools:['allowed']}]);
  const bridged=bridges.servers[0];
  const response=await fetch(bridged.url,{method:'POST',headers:{Authorization:`Bearer ${bridged.bearerToken}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'allowed',arguments:{}}})});
  assert.equal((await response.json()).result.content[0].text,'HTTP result');assert.ok(headerCalls>=2);
  if(process.platform==='darwin'){
   const {spawn}=require('node:child_process');
   const {createPluginAssistantIsolation}=load('src/utils/plugins/security/pluginAssistantIsolation.js');
   const vendor=path.join(process.cwd(),'node_modules','@openai',`codex-${process.platform}-${process.arch}`,'vendor');
   const native=require('node:fs').readdirSync(vendor).flatMap(triple=>['bin','codex'].map(folder=>path.join(vendor,triple,folder,'codex'))).find(file=>require('node:fs').existsSync(file));
   const isolated=await createPluginAssistantIsolation({command:native,bundled:true,args:[]},'codex-cli',[],{codexMcpServers:[{id:'probe'}],prepareMcpServers:async()=>({servers:[],ports:bridges.ports,close:async()=>{}})});
   const curl=url=>new Promise(resolve=>{const child=spawn(isolated.command,[...isolated.args.slice(0,2),'/usr/bin/curl','--max-time','3','--silent',url],isolated.options);child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('exit',resolve);});
   try {assert.equal(await curl(bridged.url),0,'Bridge loopback port must be reachable');assert.notEqual(await curl(`http://127.0.0.1:${upstream.address().port}/mcp`),0,'Other loopback ports must be denied');}
   finally{await isolated.cleanup();}
  }
  await bridges.close();bridges=undefined;await close(upstream);upstream=undefined;
  console.log('PASS local HTTP, custom headers, bridge cleanup and macOS loopback boundary');

  let base, opened, saved={}, completed;
  upstream=http.createServer(async(req,res)=>{
   let body='';for await(const c of req)body+=c;
   res.setHeader('Content-Type','application/json');
   if(req.url.startsWith('/.well-known/oauth-protected-resource'))return res.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base]}));
   if(req.url.startsWith('/.well-known/oauth-authorization-server')||req.url.startsWith('/.well-known/openid-configuration'))return res.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}));
   if(req.url==='/register')return res.end(JSON.stringify({...JSON.parse(body),client_id:'public-fixture'}));
   if(req.url==='/token'){const form=new URLSearchParams(body);if(form.get('grant_type')==='refresh_token')assert.equal(form.get('refresh_token'),'secret-refresh');else {assert.equal(form.get('code'),'fixture-code');assert.ok(form.get('code_verifier'));}return res.end(JSON.stringify({access_token:'secret-token',token_type:'Bearer',refresh_token:'secret-refresh',expires_in:3600}));}
   res.writeHead(401,{'WWW-Authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`});res.end('{}');
  });
  await listen(upstream);base=`http://127.0.0.1:${upstream.address().port}`;
  configureMcpCredentialsStore({get:()=>saved,save:(_id,value)=>{saved=value;}});
  let resolveOpened;const ready=new Promise(resolve=>{resolveOpened=resolve;});
  const done=new Promise(resolve=>{completed=resolve;});
  oauth=await startMcpOAuth({id:'oauth',url:base+'/mcp',authRevision:'one'},{openExternal:async url=>{opened=new URL(url);resolveOpened();},onFinish:completed,timeoutMs:5000});
  await ready;
  assert.equal(opened.searchParams.get('code_challenge_method'),'S256');
  assert.equal((await fetch(oauth.redirectUrl+'?code=fixture-code&state=wrong')).status,400);
  assert.equal(saved.tokens,undefined);
  const callback=new URL(oauth.redirectUrl);callback.searchParams.set('state',opened.searchParams.get('state'));callback.searchParams.set('code','fixture-code');
  assert.equal((await fetch(callback)).status,200);
  assert.equal((await done).status,'authorized');
  assert.equal(saved.tokens.access_token,'secret-token');
  oauth=undefined;
  const {auth}=require('@modelcontextprotocol/sdk/client/auth.js');
  assert.equal(await auth(mcpOAuthProvider({id:'oauth',url:base+'/mcp',authRevision:'one'}),{serverUrl:base+'/mcp'}),'AUTHORIZED');
  saved={};let cancelled;
  oauth=await startMcpOAuth({id:'oauth',url:base+'/mcp'},{openExternal:async()=>{},onFinish:value=>{cancelled=value;},timeoutMs:5000});
  oauth.cancel();assert.equal(cancelled.status,'cancelled');oauth=undefined;
  console.log('PASS OAuth metadata discovery, public client registration, browser URL, PKCE, state rejection, token exchange, refresh and cancellation');
 } finally {oauth?.cancel();await bridges?.close();if(upstream)await close(upstream);await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
