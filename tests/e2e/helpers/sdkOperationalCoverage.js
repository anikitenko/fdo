const {createCoverageMap} = require('istanbul-lib-coverage');
const OPERATIONAL = new Set(['12-git-operations-plugin.ts', '13-service-content-hub-plugin.ts', '18-interactive-ssh-plugin.ts']);
function isOperationalExample(entry) { return OPERATIONAL.has(entry.relativePath); }

// Test-only code appended to coverage-instrumented plugin modules. Never shipped to production plugins.
function operationalCoverageSupport(compiled, invokeInitializer = false) {
  const ast = require('@babel/parser').parse(compiled, {sourceType: 'script'});
  const counter = ast.program.body.find(node => node.type === 'FunctionDeclaration' && /^cov_/.test(node.id?.name || ''));
  if (!counter) throw new Error('Instrumented example is missing its Istanbul counter bootstrap');
  const frontendBootstrap = require('@babel/generator').default(counter, {compact: true, comments: false}).code + '\n' + counter.id.name + '();\n';
  const unsafeCharMap = {'<':'\\u003C','>':'\\u003E','/':'\\u002F','\\':'\\\\','\b':'\\b','\f':'\\f','\n':'\\n','\r':'\\r','\t':'\\t','\0':'\\0','\u2028':'\\u2028','\u2029':'\\u2029'};
  const escapeUnsafeForEmbeddedJs = str => str.replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g, ch => unsafeCharMap[ch]);
  const serializedFrontendBootstrap = escapeUnsafeForEmbeddedJs(JSON.stringify(frontendBootstrap));
  return `\n;(() => {
    const sdk = require('@anikitenko/fdo-sdk');
    const serializers = sdk.FDO_SDK.prototype.__e2eCoverageSerializers || {};
    if (!sdk.FDO_SDK.prototype.__e2eCoverageSerializers) {
      const original = sdk.FDO_SDK.prototype.serializeRenderOnLoad;
      sdk.FDO_SDK.prototype.serializeRenderOnLoad = function () {
        const serialized = original.call(this);
        const key = Object.keys(serializers).find(name => serialized.includes(name + '('));
        const wrap = key && serializers[key];
        return wrap ? wrap(serialized) : serialized;
      };
      sdk.FDO_SDK.prototype.__e2eCoverageSerializers = serializers;
    }
    serializers[${JSON.stringify(counter.id.name)}] = serialized => JSON.stringify("() => {\\n" + ${serializedFrontendBootstrap} + "return (" + JSON.parse(serialized).replace(/;\\s*$/, '') + ")${invokeInitializer ? "()" : ""};\\n}");
    const names = ['__FDO_AUTH_BROKER','__FDO_CONTENT_BROKER','__FDO_BROWSER_BROKER','__FDO_SESSION_REQUEST','__FDO_AI_REQUEST','__FDO_AI_ASSISTANT','__FDO_AI_LIST_ASSISTANTS','__FDO_AI_ASSISTANTS'];
    const originalFetch = globalThis.fetch;
    const reply = spec => {
      if (spec && spec.throw) throw new Error(spec.throw);
      const value = spec && Object.prototype.hasOwnProperty.call(spec,'result') ? spec.result : {};
      return spec && spec.async ? Promise.resolve(value) : value;
    };
    let configuration = {};
    const applyConfiguration = config => {
      for (const name of names) delete globalThis[name];
      if (config.granted) sdk.PluginRegistry.configureCapabilities({granted: config.granted});
      for (const [key,name] of [['auth','__FDO_AUTH_BROKER'],['content','__FDO_CONTENT_BROKER'],['browser','__FDO_BROWSER_BROKER'],['session','__FDO_SESSION_REQUEST']]) {
        if (config[key]) globalThis[name] = Object.fromEntries(Object.entries(config[key]).map(([method,spec]) => [method, () => reply(spec)]));
      }
      if (config.ai) globalThis.__FDO_AI_REQUEST = () => reply(config.ai);
      if (config.assistants) globalThis.__FDO_AI_LIST_ASSISTANTS = () => reply(config.assistants);
      if (config.fetch) globalThis.fetch = async () => ({ok:config.fetch.ok !== false, status:config.fetch.status || 200, statusText:config.fetch.statusText || 'OK', json:async()=>config.fetch.result || {}, text:async()=>config.fetch.text || ''});
      else globalThis.fetch = originalFetch;
    };
    sdk.PluginRegistry.registerHandler('__e2e.configureServices', config => {
      configuration = config; applyConfiguration(config); return {ok:true};
    });
    sdk.PluginRegistry.registerHandler('__e2e.invokeScenario', ({handler, payload}) => {
      applyConfiguration(configuration);
      const callback = sdk.PluginRegistry.handlers[handler];
      if (typeof callback !== 'function') throw new Error('Missing example handler: ' + handler);
      return callback(payload);
    });
  })();\n`;
}
const grants = ['system.clipboard.write','system.network','system.network.https','system.network.scope.public-web-secure','system.network.scope.external-services'];
const content = {items:[{id:'doc-1',name:'Document',kind:'file',webUrl:'https://content.example.test/doc',path:'/doc',size:12,lastModified:'2026-01-01T00:00:00Z'}],nextCursor:'page-2',webUrl:'https://content.example.test/shared'};
function serviceConfig(overrides = {}) {
  return {granted:grants, auth:{start:{result:{sessionId:'coverage-session',accountId:'coverage-user'}},refresh:{result:{sessionId:'coverage-session'}},logout:{result:{ok:true}}},
    content:{request:{result:content}},browser:{open:{result:{ok:true}}},ai:{result:{message:'Coverage summary',commitMessage:'test: exercise staged changes'}},
    assistants:{result:{assistants:[{id:'coverage-assistant',name:'Coverage Assistant',purpose:'automation',provider:'local',model:'fixture',default:true}]}},
    fetch:{result:{default_branch:'main',description:'Fixture repository',stargazers_count:2,visibility:'public'}},...overrides};
}
async function prepareOperationalCoverage(window, pluginId, entry, invoke) {
  if (!isOperationalExample(entry)) return;
  if (entry.relativePath === '18-interactive-ssh-plugin.ts') {
    const result = await invoke(window, pluginId, '__e2e.configureTerminal', {});
    if (!result.ok) throw new Error('Terminal coverage setup failed');
    return;
  }
  const configured = await invoke(window,pluginId,'__e2e.configureServices',serviceConfig());
  if (!configured.ok) throw new Error('Operational test service setup failed');
  if (entry.relativePath.startsWith('13-')) {
    const saved = await invoke(window,pluginId,'serviceHub.v1.saveContext',{providerId:'sharepoint',endpointUrl:'https://graph.microsoft.com/v1.0',sessionId:'coverage-session',workspaceId:'workspace',authConfig:{clientId:'coverage-client',tenantId:'coverage-tenant'}});
    if (!saved.ok) throw new Error('Operational test context setup failed');
  }
}
async function mergedExampleCoverage(window, backendCoverage, entry) {
  const map = createCoverageMap(backendCoverage);
  if (isOperationalExample(entry)) {
    const frontend = await window.evaluate(() => {
      const iframe = document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]');
      return iframe?.contentWindow?.__coverage__ || {};
    });
    if (!frontend[entry.absPath]) throw new Error(`Frontend coverage missing for ${entry.relativePath}; do not silently gate backend-only coverage`);
    map.merge(frontend);
  }
  return map;
}
async function runOperationalCoverage(window, pluginId, entry, invoke, expect) {
  if (!isOperationalExample(entry)) return [];
  if (entry.relativePath === '18-interactive-ssh-plugin.ts') return require('./sdkTerminalCoverage').runTerminalCoverage(window, pluginId, invoke, expect);
  const records=[];
  const run=async(handler,payload,expected={ok:true})=>{
    const response=await invoke(window,pluginId,handler.startsWith('__e2e.') ? handler : '__e2e.invokeScenario',handler.startsWith('__e2e.') ? payload : {handler,payload});
    expect(response, `${handler} ${JSON.stringify(payload)} => ${JSON.stringify(response)}`).toMatchObject(expected);
    records.push({handler,payload,ok:response.ok,code:response.code || response.result?.code || ''});
    return response.result;
  };
  const configure=async config=>{await run('__e2e.configureServices',config);};
  await window.waitForFunction(() => typeof document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]')?.contentWindow?.createBackendReq === 'function', null, {timeout: 15000});
  // Keep real UI_MESSAGE calls to registered plugin handlers. Only OS-facing execution is simulated.
  await window.evaluate(() => {
    const win=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentWindow;
    const bridge=win.createBackendReq.bind(win);
    win.__coverageRawMode='ok';
    win.createBackendReq=async(type,payload)=>{
      if(type !== 'requestPrivilegedAction') {
        const response=await bridge(type, type === 'UI_MESSAGE' ? {handler:'__e2e.invokeScenario',content:{handler:payload.handler,payload:payload.content}} : payload);
        return response?.ok === true && response.result && typeof response.result === 'object' ? response.result : response;
      }
      const request=payload?.request || payload;
      if(win.__coverageRawMode==='error') return {ok:false,correlationId:'coverage-error',code:'PROCESS_EXEC_FAILED',error:'Command failed',result:{stderr:'fatal: not a git repository',stdout:'',exitCode:128}};
      const args=request?.payload?.args || [];
      let stdout='Completed';
      if(args[0]==='status') stdout=win.__coverageRawMode==='clean' ? '# branch.head main\n' : '# branch.head main\n# branch.ab +1 -0\n1 M. N... 100644 100644 100644 a b src/index.ts\n? new.txt\n';
      if(args[0]==='config') stdout='git@github.com:example/repository.git\n';
      if(args[0]==='branch') stdout='* main abc [origin/main] update\n';
      if(args[0]==='log') stdout='abc feat: exercise workflow\n';
      if(args[0]==='diff') stdout=' src/index.ts | 2 +-\n';
      return {ok:true,correlationId:'coverage-success',result:{stdout,stderr:'',exitCode:0,args,cwd:request?.payload?.cwd}};
    };
  });
  await configure(serviceConfig());
  if(entry.relativePath.startsWith('12-')) {
    const prepared=await run('gitOps.v1.prepare',{}); const cwd=prepared.defaultRepoPath;
    for(const invalid of [{},{cwd:'relative/path'}]) await run('gitOps.v1.saveRepoPath',invalid,{ok:false});
    await run('gitOps.v1.saveRepoPath',{cwd});
    await run('gitOps.v1.buildRequest',{operation:'unsupported',cwd},{ok:false});
    for(const operation of ['status','branches','log','diffStat','showHead','fetch','pullFFOnly']) {
      const envelope=await run('gitOps.v1.buildRequest',{operation,cwd,dryRun:true}); expect(envelope.request.payload.cwd).toBe(cwd);
    }
    await run('gitOps.v1.buildCommitRequest',{cwd,message:''},{ok:false});
    for(const dryRun of [false,true]) { const request=await run('gitOps.v1.buildCommitRequest',{cwd,message:'test: preserve staged changes',dryRun}); expect(request.request.payload.args).toContain('test: preserve staged changes'); }
    await run('gitOps.v1.prefetchOriginalRepoRequest',{cwd});
    await run('gitOps.v1.prefetchOriginalRepo',{cwd});
    for(const remoteOriginUrl of ['git@github.com:example/repository.git','https://git.example.test/repository.git','invalid-origin']) await run('gitOps.v1.prefetchOriginalRepo',{cwd,remoteOriginUrl});
    await configure(serviceConfig({fetch:{ok:false,status:503,text:'Service unavailable'}}));
    const degraded=await run('gitOps.v1.prefetchOriginalRepo',{cwd,remoteOriginUrl:'https://github.com/example/repository'}); expect(degraded.warning).toContain('503');
    await configure({granted:grants});
    for(const summary of [{staged:2,modified:1,untracked:1,branch:'main'},{conflicts:1},{modified:1},{branch:'main'}]) for(const task of ['commit-message','summarize-output','suggest-next-command']) await run('fdo.ai.request.v1',{task,summary,repoPath:cwd,commandOutput:'First line\nSecond line'});
    await run('fdo.ai.assistants.list.v1',{});
    await configure(serviceConfig()); await run('fdo.ai.assistants.list.v1',{purpose:'automation',provider:'local',model:'fixture'});
    await run('fdo.ai.request.v1',{task:'commit-message',summary:{staged:1},repoPath:cwd});
    await configure(serviceConfig({ai:{throw:'AI provider unavailable'},assistants:{throw:'Discovery unavailable'}}));
    await run('fdo.ai.request.v1',{task:'commit-message'},{ok:false}); await run('fdo.ai.assistants.list.v1',{}, {ok:false});
    await configure(serviceConfig());
    const click=async(id, mode='ok')=>{
      await window.evaluate(({id,mode,cwd})=>{
        const win=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentWindow, doc=win.document;
        win.__coverageRawMode=mode; doc.getElementById('git-repo-path').value=cwd;
        if(id==='git-run-commit') doc.getElementById('git-commit-message').value='test: preserve staged changes';
        const button=doc.getElementById(id); if(!button || button.disabled) throw new Error('Unavailable Git control: '+id); button.click();
      },{id,mode,cwd});
      await window.waitForFunction(()=>{const doc=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]')?.contentDocument;return doc?.getElementById('git-run-status') && !doc.getElementById('git-run-status').disabled;},null,{timeout:15000});
    };
    for(const id of ['git-save-path','git-prefetch-original','git-run-status','git-run-branches','git-run-log','git-run-diff','git-run-show','git-run-fetch','git-run-pull','git-ai-refresh-assistants','git-ai-commit-message','git-ai-summarize-output','git-ai-suggest-next','git-run-commit','git-run-snapshot']) await click(id);
    await click('git-run-status','clean'); await click('git-run-status','error'); await click('git-run-snapshot','error');
    expect(await window.evaluate(()=>document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentDocument.getElementById('git-output-code').textContent)).toContain('failed');
    await configure(serviceConfig({ai:{throw:'AI unavailable'}})); await click('git-ai-commit-message');
  } else {
    const prefix='serviceHub.v1.', base={providerId:'sharepoint',endpointUrl:'https://graph.microsoft.com/v1.0',sessionId:'coverage-session',workspaceId:'workspace',query:'Document',itemId:'doc-1'};
    for(const [name,payload] of [['content.listWorkspaces',{}],['content.listItems',{}],['content.search',{}],['auth.refresh',{}],['auth.logout',{}]]) await run(prefix+name,{...payload,sessionId:'',workspaceId:'',query:''},{ok:false});
    await run(prefix+'saveContext',{...base,endpointUrl:'file:///tmp/fdo'},{ok:false});
    await run(prefix+'saveContext',base);
    for(const name of ['auth.start','auth.refresh','content.listWorkspaces','content.listItems','content.search','content.createShareLink']) await run(prefix+name,base);
    await run(prefix+'addFavorite',{item:content.items[0]}); await run(prefix+'addFavorite',{item:content.items[0]});
    await run(prefix+'buildClipboardWriteRequest',{text:'https://content.example.test/shared'});
    for(const message of ['token expired','403 forbidden','401 unauthorized','Malformed response']) {
      await configure(serviceConfig({auth:{start:{throw:message}},content:{request:{throw:message}}}));
      await run(prefix+'auth.start',base,{ok:false}); await run(prefix+'content.listItems',base,{ok:false});
    }
    await configure(serviceConfig({auth:{start:{result:{ok:false,error:'invalid_scope status 400'}}}})); await run(prefix+'auth.start',base,{ok:false});
    await configure(serviceConfig({auth:{start:{result:{sessionId:'coverage-session',raw:{verification_uri:'https://login.example.test/device',user_code:'TEST-CODE',device_code:'fixture-device',interval:1,expires_in:900}}}}}));
    const pending=await run(prefix+'auth.start',{...base,authConfig:{clientId:'coverage-client',tenantId:'coverage-tenant'}}); expect(pending.pending).toBe(true);
    await configure(serviceConfig({auth:{refresh:{result:{ok:false,error:'authorization_pending'}}}}));
    const polling=await run(prefix+'auth.refresh',base); expect(polling.pending).toBe(true);
    await configure(serviceConfig({auth:{refresh:{result:{sessionId:'coverage-session',raw:{access_token:'fixture-token',token_type:'Bearer'}}}}})); await run(prefix+'auth.refresh',base);
    await configure(serviceConfig()); await run(prefix+'saveContext',base);
    await window.evaluate(async()=>{
      const win=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentWindow, doc=win.document;
      for(const [id,value] of [['sh-workspace-id','workspace'],['sh-search-query','Document'],['sh-auth-client-id','coverage-client'],['sh-auth-tenant-id','coverage-tenant']]) doc.getElementById(id).value=value;
      await win.__serviceHubRuntime.prepare();
      for(const action of ['saveContext','authStart','authRefresh','listWorkspaces','listItems','nextPage','searchItems','createShareLink','openInBrowser','copyShareLink','addFavorite','summarizeWithAI']) await win.__serviceHubRunAction(action);
    });
    expect(await window.evaluate(()=>document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentDocument.getElementById('sh-meta').textContent)).not.toContain('failed');
    await configure(serviceConfig({content:{request:{throw:'403 forbidden'}},ai:{throw:'AI unavailable'}}));
    await window.evaluate(async()=>{const win=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentWindow; await win.__serviceHubRunAction('listItems');await win.__serviceHubRunAction('summarizeWithAI');});
    await configure(serviceConfig()); await run(prefix+'auth.logout',base);
    await window.evaluate(async()=>{const win=document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]').contentWindow;await win.__serviceHubRuntime.prepare();await win.__serviceHubRunAction('listWorkspaces');});
  }
  return records;
}
module.exports={isOperationalExample, operationalCoverageSupport, prepareOperationalCoverage, mergedExampleCoverage, runOperationalCoverage};
