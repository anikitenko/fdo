// Offline native hook probe, explicitly approved by the user.
// Uses only generated fixture scripts, temporary files, and mocked inference.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),esbuild=require('esbuild');
const shim={exports:{}};new Function('require','module','exports',esbuild.buildSync({entryPoints:['src/utils/plugins/security/pluginAssistantIsolation.js'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text)(require,shim,shim.exports);
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fdo-hook-probe-'));let isolated,server,child;
 try{
  const vendor=path.join(process.cwd(),'node_modules','@openai',`codex-${process.platform}-${process.arch}`,'vendor'),binaryName=process.platform==='win32'?'codex.exe':'codex';
  const native=(await fs.readdir(vendor)).flatMap(triple=>['bin','codex'].map(folder=>path.join(vendor,triple,folder,binaryName))).find(file=>require('node:fs').existsSync(file));
  const script=path.join(root,'fixture with spaces.cjs'),log=path.join(root,'events.jsonl');
  await fs.writeFile(script,`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const event=JSON.parse(input);require('node:fs').appendFileSync(process.env.PROBE_LOG,JSON.stringify({event:event.hook_event_name,secret:process.env.PROBE_VALUE})+'\\n');if(process.env.PROBE_BLOCK_EVENT===event.hook_event_name){process.stderr.write('HOOK_BLOCK_CANARY');process.exitCode=2;return;}process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:event.hook_event_name,additionalContext:'HOOK_CONTEXT_CANARY'}}));});`);
  const hooks=['SessionStart','UserPromptSubmit','Stop','SessionEnd','PreToolUse','PostToolUse'].map((event,index)=>({id:`probe${index}`,name:event,event,toolPattern:'',command:process.execPath,args:[script],cwd:root,environment:{PROBE_LOG:log,PROBE_VALUE:'fixture $VALUE'},timeoutSeconds:5,enabled:true,assistantIds:['fixture']}));
  const statuses=[];isolated=await shim.exports.createPluginAssistantIsolation({command:native,bundled:true,args:[]},'codex-cli',[],{credentialRoot:root,codexHooks:hooks,onHookActivity:activity=>statuses.push(activity)});
  let captured, inferenceCount=0, toolsCalled=0, offerTool=true;
  server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const message=JSON.parse(body);
   if(req.url==='/mcp'){
    if(message.id===undefined||req.method==='DELETE'){res.writeHead(202);res.end();return;}
    let result;
    if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'Fixture',version:'1.0.0'}};
    else if(message.method==='tools/list')result={tools:[{name:'fixture_ping',description:'Offline fixture',inputSchema:{type:'object',properties:{}}}]};
    else if(message.method==='tools/call'){toolsCalled++;result={content:[{type:'text',text:'MCP_HOOK_RESULT_CANARY'}]};}
    else result={};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));return;
   }
   captured=message;inferenceCount++;
   const first=offerTool;offerTool=false;
   const item=first?{type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'fixture_ping',namespace:'mcp__fixture',arguments:'{}'}:{type:'message',id:'msg',role:'assistant',status:'completed',content:[{type:'output_text',text:'Hook probe complete.'}]};const response={id:'resp_probe',object:'response',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}};res.writeHead(200,{'Content-Type':'text/event-stream'});for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  if(isolated.osSandbox)await fs.appendFile(isolated.args[1],`\n(allow network-outbound (remote ip "localhost:${server.address().port}"))\n`);
  await fs.writeFile(path.join(isolated.options.env.CODEX_HOME,'config.toml'),`mcp_optional_startup_grace_ms = 0\n[mcp_servers.fixture]\nurl = "http://127.0.0.1:${server.address().port}/mcp"\nrequired = true\nenabled_tools = ["fixture_ping"]\ndefault_tools_approval_mode = "approve"\n`);
  const config={model_provider:'fixture',model:'offline-fixture','model_providers.fixture.name':'Offline','model_providers.fixture.base_url':`http://127.0.0.1:${server.address().port}`,'model_providers.fixture.wire_api':'responses','model_providers.fixture.requires_openai_auth':false,'model_providers.fixture.request_max_retries':0,'model_providers.fixture.stream_max_retries':0,'features.hooks':true,'features.skip_host_skill_discovery':true,'features.daemon_auto_start':false,approval_policy:'never',web_search:'disabled'};
  for(const feature of shim.exports.CODEX_PROPOSAL_FEATURES)config[`features.${feature}`]=false;
  const run=()=>new Promise((resolve,reject)=>{
   child=spawn(isolated.command,[...isolated.args,'exec','--json','--dangerously-bypass-hook-trust','--skip-git-repo-check','--sandbox','read-only',...Object.entries(config).flatMap(([key,value])=>['-c',`${key}=${JSON.stringify(value)}`]),'-'],isolated.options);
   let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.on('error',()=>{});child.stdin.end('Reply with one short sentence.');
   const timer=setTimeout(()=>{child.kill();reject(new Error('Native fixture timed out: '+stderr.slice(-2000)));},15000);
   child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
  let result=await run();
  assert.equal(result.code,0,result.stderr);assert.ok(JSON.stringify(captured).includes('HOOK_CONTEXT_CANARY'),'Hook context must reach mocked inference');
  const events=(await fs.readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  for(const event of ['SessionStart','UserPromptSubmit','Stop','SessionEnd','PreToolUse','PostToolUse'])assert.ok(events.some(row=>row.event===event),`Native ${event} must execute`);
  assert.ok(events.every(row=>row.secret==='fixture $VALUE'));assert.ok(statuses.some(s=>s.status==='completed'));assert.equal(JSON.stringify(statuses).includes('$VALUE'),false);
  assert.equal(toolsCalled,1);assert.ok(JSON.stringify(captured).includes('MCP_HOOK_RESULT_CANARY'));
  hooks.find(h=>h.event==='UserPromptSubmit').environment.PROBE_BLOCK_EVENT='UserPromptSubmit';
  const before=inferenceCount;result=await run();assert.equal(inferenceCount,before,'Blocked prompt must not reach inference');assert.ok(statuses.some(status=>status.status==='blocked'));
  console.log('PASS prompt blocking, native tool hooks, native lifecycle dispatch, fixture command execution, literal environment, model context, and sandbox bridge.');
 }finally{child?.kill();await isolated?.cleanup();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
