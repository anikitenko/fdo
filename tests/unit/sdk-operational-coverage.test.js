const vm = require('node:vm');
const {createInstrumenter} = require('istanbul-lib-instrument');
const {isOperationalExample,operationalCoverageSupport,mergedExampleCoverage,prepareOperationalCoverage} = require('../e2e/helpers/sdkOperationalCoverage');

test('operational coverage is limited to the two split-runtime examples', () => {
  expect(isOperationalExample({relativePath:'12-git-operations-plugin.ts'})).toBe(true);
  expect(isOperationalExample({relativePath:'13-service-content-hub-plugin.ts'})).toBe(true);
  expect(isOperationalExample({relativePath:'01-basic-plugin.ts'})).toBe(false);
});
test.each([false, true])('serialized frontend callbacks receive their own counter runtime (function initializer: %s)', async invokeInitializer => {
  const filename='/fixture/12-git-operations-plugin.ts';
  const instrumenter=createInstrumenter({coverageGlobalScope:'globalThis',coverageGlobalScopeFunc:false,esModules:false,compact:false});
  const compiled=instrumenter.instrumentSync('module.exports = function frontend() { return 42; };',filename);
  const handlers={};
  let backend;
  class SDK {serializeRenderOnLoad(){return JSON.stringify(invokeInitializer ? backend.module.exports.toString() : `(${backend.module.exports.toString()})();`);}}
  const sdk={FDO_SDK:SDK,PluginRegistry:{registerHandler:(name,handler)=>{handlers[name]=handler;}}};
  backend={module:{exports:{}},require:name=>{if(name!=='@anikitenko/fdo-sdk')throw Error(name);return sdk;}};
  vm.runInNewContext(compiled+operationalCoverageSupport(compiled,invokeInitializer),backend);
  const instance=new SDK(); sdk.PluginRegistry.pluginInstance=instance;
  handlers['__e2e.configureServices']({});
  const source=JSON.parse(instance.serializeRenderOnLoad());
  expect(source).not.toContain('new Function');
  const ast=require('@babel/parser').parse(`const initialize = ${source};`);
  expect(ast.program.body).toHaveLength(1);
  expect(ast.program.body[0].declarations[0].init.type).toBe('ArrowFunctionExpression');
  const frontend={};expect(vm.runInNewContext(`(${source})()`,frontend)).toBe(42);
  expect(Object.values(backend.__coverage__[filename].f)).toEqual([0]);
  expect(Object.values(frontend.__coverage__[filename].f)).toEqual([1]);
  const merged=await mergedExampleCoverage({evaluate:async()=>frontend.__coverage__},backend.__coverage__,{relativePath:'12-git-operations-plugin.ts',absPath:filename});
  expect(merged.fileCoverageFor(filename).toSummary().functions.pct).toBe(100);
  expect(merged.fileCoverageFor(filename).toSummary().statements.pct).toBe(100);
  expect(typeof handlers['__e2e.configureServices']).toBe('function');
});
test('a missing frontend counter map is an error, not an easier backend-only denominator', async()=>{
  await expect(mergedExampleCoverage({evaluate:async()=>({})},{},{relativePath:'12-git-operations-plugin.ts',absPath:'/fixture/git.ts'})).rejects.toThrow('Frontend coverage missing');
});
test('unrelated examples retain their existing deployment behavior',async()=>{
  const invoke=jest.fn();await prepareOperationalCoverage({},'plugin',{relativePath:'01-basic-plugin.ts'},invoke);expect(invoke).not.toHaveBeenCalled();
});
test('missing instrumentation cannot silently enable a partial coverage bridge',()=>{
  expect(()=>operationalCoverageSupport('module.exports = 42;')).toThrow('counter bootstrap');
});

test('HostsManager UI proof checks visible content instead of its nonvisual metadata name', () => {
  const {getBehaviorSpec}=require('../e2e/helpers/sdkExampleBehaviorManifest');
  expect(getBehaviorSpec({relativePath:'11-hosts-manager-plugin/index.ts',expectations:{uiMarkers:['HostsManager']}}).uiMarkerAnyOf).toEqual(['System Hosts']);
});

test('coverage wrapper returns frontend cleanup without executing it during setup', () => {
  const compiled=createInstrumenter({coverageGlobalScope:'globalThis',coverageGlobalScopeFunc:false,compact:false})
    .instrumentSync('module.exports = () => () => { globalThis.cleaned = true; };','/fixture/cleanup.js');
  let backend;
  class SDK {serializeRenderOnLoad(){return JSON.stringify(`(${backend.module.exports.toString()})();`);}}
  const sdk={FDO_SDK:SDK,PluginRegistry:{registerHandler:()=>{}}};
  backend={module:{exports:{}},require:()=>sdk};
  vm.runInNewContext(compiled+operationalCoverageSupport(compiled),backend);
  const source=JSON.parse(new SDK().serializeRenderOnLoad());
  const frontend={};
  const cleanup=vm.runInNewContext(`(${source})()`,frontend);
  expect(typeof cleanup).toBe('function'); expect(frontend.cleaned).toBeUndefined();
  cleanup(); expect(frontend.cleaned).toBe(true);
  class Unrelated extends SDK {serializeRenderOnLoad(){return JSON.stringify('() => 7');}}
  expect(new Unrelated().serializeRenderOnLoad()).toBe(JSON.stringify('() => 7'));
});
