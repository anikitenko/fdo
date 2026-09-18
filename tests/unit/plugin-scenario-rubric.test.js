const {evaluateJsonInspectorScenario} = require("../e2e/helpers/pluginScenarioRubric.cjs");

function fixture(overrides = {}) {
  return {
    "/index.ts": `import {DOM, FDO_SDK, FDOInterface, PluginRegistry, defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
import css from './styles.css';
export default class JsonInspector extends FDO_SDK implements FDOInterface {
 init() { PluginRegistry.registerHandler('inspectJson', ({json}) => { try { const value = JSON.parse(json); return {valid:true, value}; } catch (error) { return {valid:false, message:String(error)}; } }); }
 render() { const dom = new DOM(); const panel = dom.createClassFromStyle(css.panel); const input = dom.createClassFromStyle(css.input); const action = dom.createClassFromStyle(css.action); const result = dom.createClassFromStyle(css.result); return dom.renderHTML('<div class="' + panel + '"><textarea class="' + input + '"></textarea><button class="' + action + '"></button><p class="' + result + '"></p></div>'); }
 renderOnLoad() { return window.createBackendReq('UI_MESSAGE', {handler:'inspectJson', content: '{}'}); }
}
new JsonInspector();
const actionBindings = defineRenderOnLoadActions({handlers: {}, bindings: [{selector: "[data-role=\\"inspect-json\\"]", event: "click", handler: "inspectJson"}]});`,
    "/bindings.ts": `defineRenderOnLoadActions({handlers: {}, bindings: [{selector: "[data-role=\\"inspect-json\\"]", event: "click", handler: "inspectJson"}]});`,
    "/render.tsx": `export const Render = () => '<form class="pure-form pure-form-stacked"><div class="pure-g"><div class="pure-u-1"><textarea data-role="json-input"></textarea><button type="button" class="pure-button pure-button-primary" data-role="inspect-json">Inspect JSON</button><p data-role="result"></p></div></div></form>';`,
    "/styles.css": `.panel { max-width: 42rem; padding: 1rem; border: 1px solid #456; border-radius: 12px; box-shadow: 0 8px 24px #0003; color: #123; &:focus { outline: 2px solid #456; } }
.input { width: 100%; min-height: 12rem; }
.action { color: white; background: #2463eb; }
.result { padding: 1rem; background: #eef3ff; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }`,
    "/render.test.ts": `import test from 'node:test'; import assert from 'node:assert/strict';
test('title', () => assert.ok(true)); test('action', () => assert.ok(true));`,
    ...overrides,
  };
}

test("passes a local JSON Inspector fixture", () => {
  expect(evaluateJsonInspectorScenario(fixture())).toMatchObject({passed: true, violations: []});
});

test("accepts a typed init method and nested descendant stylesheet rules", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("init() {", "init(): void {"),
    "/styles.css": `.panel { max-width: 42rem; padding: 1rem; border: 1px solid #456; border-radius: 12px; box-shadow: 0 8px 24px #0003;\n  h1 { color: #123; }\n  .result { border-color: #456; }\n}\n.input { width: 100%; min-height: 12rem; }\n.action { color: white; background: #2463eb; }\n.result { padding: 1rem; background: #eef3ff; }\n@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }\n@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }`,
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.handlerInInit).toBe(true);
  expect(result.checks.nestedStyles).toBe(true);
  expect(result.passed).toBe(true);
});

test("accepts a named backend handler that returns the inspection payload", () => {
  const files = fixture({
    "/index.ts": `import {DOM, FDO_SDK, FDOInterface, PluginRegistry} from '@anikitenko/fdo-sdk';
import css from './styles.css';
export function inspectJson({json}: {json: string}) {
  try { const value = JSON.parse(json); return {valid: true, value}; }
  catch (error) { return {valid: false, message: String(error)}; }
}
export default class JsonInspector extends FDO_SDK implements FDOInterface {
 init(): void { PluginRegistry.registerHandler('inspectJson', inspectJson); }
 render() { const dom = new DOM(); const panel = dom.createClassFromStyle(css.panel); const input = dom.createClassFromStyle(css.input); const action = dom.createClassFromStyle(css.action); const result = dom.createClassFromStyle(css.result); return dom.renderHTML('<div class="' + panel + '"><textarea class="' + input + '"></textarea><button class="' + action + '"></button><p class="' + result + '"></p></div>'); }
 renderOnLoad() { return window.createBackendReq('UI_MESSAGE', {handler:'inspectJson', content: {json: '{}'}}); }
}
new JsonInspector();`,
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.handlerReturnsResult).toBe(true);
  expect(result.passed).toBe(true);
});

test("accepts a registered callback that returns the named inspection helper result", () => {
  const files = fixture({
    "/index.ts": `import {DOM, FDO_SDK, FDOInterface, PluginRegistry} from '@anikitenko/fdo-sdk';
import css from './styles.css';
export function inspectJson(json: unknown) { try { return {valid: true, value: JSON.parse(String(json))}; } catch { return {valid: false, message: "Malformed JSON."}; } }
export default class JsonInspector extends FDO_SDK implements FDOInterface {
 init(): void { PluginRegistry.registerHandler('inspectJson', (data: {json?: unknown}) => { return inspectJson(data.json); }); }
 render() { const dom = new DOM(); const panel = dom.createClassFromStyle(css.panel); const input = dom.createClassFromStyle(css.input); const action = dom.createClassFromStyle(css.action); const result = dom.createClassFromStyle(css.result); return dom.renderHTML('<div class="' + panel + '"><textarea class="' + input + '"></textarea><button class="' + action + '"></button><p class="' + result + '"></p></div>'); }
 renderOnLoad() { return window.createBackendReq('UI_MESSAGE', {handler:'inspectJson', content: {json: '{}'}}); }
}
new JsonInspector();`,
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.handlerReturnsResult).toBe(true);
  expect(result.passed).toBe(true);
});

test("rejects a named backend handler that does not return a payload", () => {
  const files = fixture({
    "/index.ts": `import {DOM, FDO_SDK, FDOInterface, PluginRegistry} from '@anikitenko/fdo-sdk';
import css from './styles.css';
function inspectJson({json}: {json: string}) { JSON.parse(json); }
export default class JsonInspector extends FDO_SDK implements FDOInterface {
 init(): void { PluginRegistry.registerHandler('inspectJson', inspectJson); }
 render() { const dom = new DOM(); const panel = dom.createClassFromStyle(css.panel); const input = dom.createClassFromStyle(css.input); const action = dom.createClassFromStyle(css.action); const result = dom.createClassFromStyle(css.result); return dom.renderHTML('<div class="' + panel + '"><textarea class="' + input + '"></textarea><button class="' + action + '"></button><p class="' + result + '"></p></div>'); }
 renderOnLoad() { return window.createBackendReq('UI_MESSAGE', {handler:'inspectJson', content: {json: '{}'}}); }
}
new JsonInspector();`,
  });
  expect(evaluateJsonInspectorScenario(files).checks.handlerReturnsResult).toBe(false);
});

test("rejects calling createClassFromStyle as a static DOM method", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("dom.createClassFromStyle(css.panel)", "DOM.createClassFromStyle(css.panel)"),
  });
  expect(evaluateJsonInspectorScenario(files).checks.styleMapRendered).toBe(false);
});

test("rejects style maps accessed with CSS selector keys", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("css.panel", 'css[".panel"]'),
  });
  expect(evaluateJsonInspectorScenario(files).checks.styleMapUsesClassKeys).toBe(false);
});

test("requires every visible JSON Inspector region to receive its stylesheet entry", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("const result = dom.createClassFromStyle(css.result);", "const result = \"\";"),
  });
  expect(evaluateJsonInspectorScenario(files).checks.styleMapEntriesRendered).toBe(false);
});

test("requires the injected Pure CSS foundation for the interactive tool", () => {
  const files = fixture({
    "/render.tsx": fixture()["/render.tsx"].replace("pure-button-primary", "pure-button"),
  });
  expect(evaluateJsonInspectorScenario(files).checks.pureCssFoundation).toBe(false);
});

test("accepts a single-column Pure CSS form without an unnecessary grid", () => {
  const files = fixture({
    "/render.tsx": fixture()["/render.tsx"]
      .replace('<div class="pure-g"><div class="pure-u-1">', "")
      .replace("</div></div></form>", "</form>"),
  });
  expect(evaluateJsonInspectorScenario(files).checks.pureCssFoundation).toBe(true);
});

test("rejects unsupported onLoad options in declarative action bindings", () => {
  const files = fixture({
    "/index.ts": `${fixture()["/index.ts"]}\ndefineRenderOnLoadActions({handlers: {}, bindings: [], onLoad: () => {}});`,
  });
  expect(evaluateJsonInspectorScenario(files).checks.supportedRenderOnLoadOptions).toBe(false);
});

test("rejects React JSX passed to the SDK HTML renderer", () => {
  const files = fixture({
    "/render.tsx": `const dom = new DOM(); dom.renderHTML(<main className="panel"><h1>JSON Inspector</h1></main>);`,
  });
  expect(evaluateJsonInspectorScenario(files).checks.noUnsupportedJsx).toBe(false);
});

test("rejects static DOM.createElement calls", () => {
  const files = fixture({
    "/render.tsx": `const view = DOM.createElement("main", {class: "panel"}, "JSON Inspector");`,
  });
  expect(evaluateJsonInspectorScenario(files).checks.noStaticDomCreateElement).toBe(false);
});

test("rejects DOM helper constructors used as markup factories", () => {
  const files = fixture({
    "/render.tsx": `const view = new DOMNested([new DOMText("JSON Inspector")]);`,
  });
  expect(evaluateJsonInspectorScenario(files).checks.noMisusedDomHelperConstructors).toBe(false);
});

test("rejects validation responses that are interpreted as host failures", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("valid:false", "ok:false"),
  });
  expect(evaluateJsonInspectorScenario(files).checks.validationKeepsBridgeSuccessful).toBe(false);
});

test("rejects use of the host's reserved data-bound marker for a plugin listener", () => {
  const files = fixture({
    "/render.tsx": `${fixture()["/render.tsx"]}\nconst form = document.querySelector("form"); if (form?.dataset.bound) return; form.dataset.bound = "true";`,
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.reservedHostBindingMarker).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires the supported declarative click binding for the JSON action", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace(/defineRenderOnLoadActions/g, "manualRenderOnLoadActions"),
    "/bindings.ts": `manualRenderOnLoadActions({handlers: {}, bindings: [{selector: "[data-role=\\"inspect-json\\"]", event: "click", handler: "inspectJson"}]});`,
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.declarativeClickBinding).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires the declarative action to be a button rather than a form submit control", () => {
  const files = fixture({
    "/render.tsx": fixture()["/render.tsx"].replace('type="button"', 'type="submit"'),
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.declarativeActionButton).toBe(false);
  expect(result.passed).toBe(false);
});

test("rejects a handler that mistakenly reads nested UI request content", () => {
  const files = fixture({
    "/index.ts": fixture()["/index.ts"].replace("({json})", "(data: {content?: {json?: string}})").replace("JSON.parse(json)", "JSON.parse(data.content?.json || '')"),
  });
  const result = evaluateJsonInspectorScenario(files);
  expect(result.checks.backendReceivesContentDirectly).toBe(false);
  expect(result.passed).toBe(false);
});

test.each([
  ["missing handler return", {"/index.ts": fixture()["/index.ts"]
    .replace("return {valid:true, value};", "const ignored = value;")
    .replace("return {valid:false, message:String(error)};", "const ignoredError = error;")}],
  ["Jest assertions", {"/render.test.ts": "import test from 'node:test'; test('bad', () => expect(true).toBe(true));"}],
  ["host import", {"/render.tsx": "import electron from 'electron'; export const Render = () => '';"}],
])("fails %s", (_name, overrides) => {
  expect(evaluateJsonInspectorScenario(fixture(overrides)).passed).toBe(false);
});
