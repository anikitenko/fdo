const {evaluateWebToolsWorkbenchScenario} = require("../e2e/helpers/pluginScenarioRubric.cjs");
const {buildWorkbenchMarkupRepairPrompt, needsWorkbenchTestRepair} = require("../e2e/live-ai-scenarios/web-tools-workbench.cjs");

test.each(['declarativeActions', 'visibleStates', 'styleMapRendered'])(
  'repairs missing %s even when every required role is present', check => {
    const rubric = evaluateWebToolsWorkbenchScenario(fixture());
    rubric.checks[check] = false;
    expect(buildWorkbenchMarkupRepairPrompt(rubric)).toContain(`Failed implementation checks: ${check}`);
  });

test.each([
  [{success: true, skipped: true}, true, true],
  [{success: true, skipped: false}, false, true],
  [{success: false, skipped: false}, true, true],
  [{success: true, skipped: false}, true, false],
])('requires executed tests and coverage: %j, coverage=%s', (run, nodeTests, repair) => {
  expect(needsWorkbenchTestRepair(run, {checks: {nodeTests}})).toBe(repair);
});

function fixture(overrides = {}) {
  return {
    "/index.ts": `import {FDO_SDK, FDOInterface, defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
import {Render} from "./render";
export default class WebToolsWorkbench extends FDO_SDK implements FDOInterface {
  private readonly _metadata = {name: "Web Tools Workbench", icon: "applications"};
  get metadata() { return this._metadata; }
  init(): void {}
  render(): string { return Render(); }
  renderOnLoad() { return defineRenderOnLoadActions({handlers: {}, bindings: [
    {selector: '[data-role=\"tool-library-button\"]', event: "click", handler: "library"},
    {selector: '[data-role=\"tool-space-button\"]', event: "click", handler: "space"},
    {selector: '[data-role=\"tool-open-json\"]', event: "click", handler: "openJson"},
    {selector: '[data-role=\"tool-library-close\"]', event: "click", handler: "closeLibrary"},
    {selector: '[data-role=\"tool-back-dashboard\"]', event: "click", handler: "back"},
    {selector: '[data-role=\"tool-format-json\"]', event: "click", handler: "format"},
    {selector: '[data-role=\"tool-space-close\"]', event: "click", handler: "closeSpace"},
  ]}); }
}
const categoryRoles = 'data-role="tool-card-text" data-role="tool-card-data" data-role="tool-card-seo" data-role="tool-card-images" data-role="tool-card-social" data-role="tool-category-workspace" data-role="tool-category-input" data-role="tool-category-action" data-role="tool-category-result" data-role="tool-category-back"';
const categoryBindings = ["tool-card-text", "tool-card-data", "tool-card-seo", "tool-card-images", "tool-card-social", "tool-category-action", "tool-category-back"].map(role => ({selector: role, event: "click"}));
new WebToolsWorkbench();`,
    "/render.tsx": `import {DOM} from "@anikitenko/fdo-sdk";
import css from "./styles.css";
export const setResultState = (element: HTMLElement, failed: boolean) => element.setAttribute("data-state", failed ? "error" : "success");
export const formatJson = (value: string) => JSON.stringify(JSON.parse(value), null, 2);
export const Render = () => { const dom = new DOM(); const shell = dom.createClassFromStyle(css.shell); const dashboard = dom.createClassFromStyle(css.dashboard); const card = dom.createClassFromStyle(css.card); const library = dom.createClassFromStyle(css.library); const workspace = dom.createClassFromStyle(css.workspace); const result = dom.createClassFromStyle(css.result); const dock = dom.createClassFromStyle(css.dock); return dom.renderHTML('<main class="' + shell + '" data-role="tool-workbench"><header data-role="tool-brand">Web Tools Workbench</header><section class="' + dashboard + '" data-role="tool-dashboard"><button type="button" data-role="tool-library-button">Open tools</button><button type="button" data-role="tool-space-button">My space</button><button class="' + card + '" type="button" data-role="tool-card-json">JSON Formatter</button><button class="' + card + '" type="button" data-role="tool-card-case">Text case</button></section><section class="' + library + '" data-role="tool-library" data-state="closed"><input data-role="tool-search" /><button type="button" data-role="tool-open-json">JSON Formatter</button><button type="button" data-role="tool-library-close">Close</button></section><section class="' + workspace + '" data-role="tool-workspace" data-state="empty"><button type="button" data-role="tool-back-dashboard">Back</button><form class="pure-form pure-form-stacked"><textarea data-role="tool-json-input"></textarea><button class="pure-button pure-button-primary" type="button" data-role="tool-format-json">Format JSON</button></form><output class="' + result + '" data-role="tool-json-result" data-state="empty"></output></section><section data-role="tool-space-dialog" data-state="closed"><button type="button" data-role="tool-space-close">Close</button></section><footer class="' + dock + '">Open a tool</footer></main>'); };`,
    "/styles.css": `.shell { min-height: 100vh; background: #102a2a; color: #fff9eb; padding: 1rem; }
.dashboard { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
.card { background: #f5d0b5; }
.library { background: #fff9eb; color: #172a2a; }
.workspace { background: #fffdf6; color: #172a2a; }
.result { background: #e5efe7; }
.dock { position: sticky; bottom: 0; border-top: 1px solid #567; }
.shell { & button { border-radius: .75rem; } }
@keyframes tool-in { from { opacity: .6; } to { opacity: 1; } }
@media (max-width: 40rem) { .dashboard { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .shell { animation: none; } }`,
    "/render.test.ts": `import test from "node:test"; import assert from "node:assert/strict";
test("title", () => assert.ok(true)); test("success state", () => assert.ok(true));`,
    ...overrides,
  };
}

test("passes a complete Web Tools Workbench fixture", () => {
  expect(evaluateWebToolsWorkbenchScenario(fixture())).toMatchObject({passed: true, violations: []});
});

test("reports the exact missing JSON shortcut and requests a focused AI repair", () => {
  const files = fixture();
  // Reproduce the live artifact: only the library-style JSON control exists.
  files["/render.tsx"] = files["/render.tsx"].replace('data-role="tool-card-json"', 'data-role="tool-open-json"');
  const rubric = evaluateWebToolsWorkbenchScenario(files);
  expect(rubric).toMatchObject({
    passed: false,
    checks: {workbenchMarkup: false, actionMarkup: false},
    missingRoles: ["tool-card-json"],
    missingActionRoles: ["tool-card-json"],
  });
  const prompt = buildWorkbenchMarkupRepairPrompt(rubric);
  expect(prompt).toContain("Required data-role values missing from the implementation: tool-card-json.");
  expect(prompt).toContain('type="button" with data-role="tool-card-json"');
  expect(prompt).toContain('Keep the separate library control data-role="tool-open-json"');
  expect(prompt).toContain("defineRenderOnLoadActions");
  expect(prompt).toContain("Do not edit /styles.css or /package.json");
});

test("does not accept role names that occur only in generated test assertions", () => {
  const files = fixture();
  files["/render.tsx"] = files["/render.tsx"].replace('data-role="tool-card-json"', 'data-role="tool-open-json"');
  files["/render.test.ts"] += '\ntest("shortcut", () => assert.ok(html.includes(\'data-role="tool-card-json"\')));';
  expect(evaluateWebToolsWorkbenchScenario(files).missingRoles).toContain("tool-card-json");
});

test("evaluates implementation and tests across nested workspace modules", () => {
  const files = fixture();
  files["/ui/workbench.tsx"] = files["/render.tsx"].replace('"./styles.css"', '"../styles.css"');
  files["/render.tsx"] = 'export {Render} from "./ui/workbench";';
  files["/tests/workbench.test.ts"] = files["/render.test.ts"];
  files["/render.test.ts"] = 'import "./tests/workbench.test";';
  expect(evaluateWebToolsWorkbenchScenario(files)).toMatchObject({passed: true, violations: []});
  // Assertions in nested tests still cannot substitute for real UI markup.
  delete files["/ui/workbench.tsx"];
  expect(evaluateWebToolsWorkbenchScenario(files).checks.workbenchMarkup).toBe(false);
});

test("does not request markup repair when the required controls are present", () => {
  expect(buildWorkbenchMarkupRepairPrompt(evaluateWebToolsWorkbenchScenario(fixture()))).toBe("");
});

test("accepts a binding table declared in its own module and looped category bindings", () => {
  const files = fixture();
  files["/index.ts"] = files["/index.ts"]
    .replace(/renderOnLoad\(\) \{ return defineRenderOnLoadActions\(\{handlers: \{\}, bindings: \[[\s\S]*?\]\}\); \}/,
      'renderOnLoad() { return defineRenderOnLoadActions({handlers: {}, bindings: categoryBindings}); }')
    .replace(/const categoryBindings = \[[\s\S]*?\}\)\);/, "");
  files["/actions/bindings.ts"] = `export const categoryBindings = [
  {selector: '[data-role="tool-library-button"]', event: "click", handler: "library"},
  {selector: '[data-role="tool-space-button"]', event: "click", handler: "space"},
  {selector: '[data-role="tool-open-json"]', event: "click", handler: "openJson"},
  {selector: '[data-role="tool-library-close"]', event: "click", handler: "closeLibrary"},
  {selector: '[data-role="tool-back-dashboard"]', event: "click", handler: "back"},
  {selector: '[data-role="tool-format-json"]', event: "click", handler: "format"},
  {selector: '[data-role="tool-space-close"]', event: "click", handler: "closeSpace"},
  {selector: '[data-role="tool-card-json"]', event: "click", handler: "openJson"},
];
for (const key of ["text", "data", "seo", "images", "social"]) {
  categoryBindings.push({selector: '[data-role="tool-card-' + key + '"]', event: "click", handler: "openCategory"});
  categoryBindings.push({selector: '[data-role="tool-category-action"]', event: "click", handler: "runCategory"});
  categoryBindings.push({selector: '[data-role="tool-category-back"]', event: "click", handler: "backFromCategory"});
}
const roles = 'tool-card-text tool-card-data tool-card-seo tool-card-images tool-card-social';`;
  expect(evaluateWebToolsWorkbenchScenario(files).checks.declarativeActions).toBe(true);
});

test("requires local JSON formatting and a declarative formatter action", () => {
  const result = evaluateWebToolsWorkbenchScenario({
    ...fixture(),
    "/render.tsx": fixture()["/render.tsx"].replace("JSON.stringify(JSON.parse(value), null, 2)", "value"),
  });
  expect(result.checks.localJsonFormatting).toBe(false);
  expect(result.passed).toBe(false);
});

test("accepts a flex-wrap dashboard with responsive card widths", () => {
  const files = fixture();
  files["/styles.css"] = files["/styles.css"]
    .replace(".dashboard { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }", ".dashboard { display: flex; flex-wrap: wrap; gap: 1rem; }")
    .replace(".card { background: #f5d0b5; }", ".card { width: calc(50% - .5rem); background: #f5d0b5; }")
    .replace("@media (max-width: 40rem) { .dashboard { grid-template-columns: 1fr; } }", "@media (max-width: 40rem) { .card { width: 100%; } }");
  expect(evaluateWebToolsWorkbenchScenario(files)).toMatchObject({passed: true, violations: []});
});

test("accepts a nested categories grid inside the dashboard", () => {
  const files = fixture();
  files["/styles.css"] = files["/styles.css"]
    .replace(".dashboard { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }", ".dashboard { background: #f4eedf; } .categories { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }")
    .replace("@media (max-width: 40rem) { .dashboard { grid-template-columns: 1fr; } }", "@media (max-width: 40rem) { .categories { grid-template-columns: 1fr; } }");
  expect(evaluateWebToolsWorkbenchScenario(files)).toMatchObject({passed: true, violations: []});
});

test("accepts a dedicated tools grid inside the dashboard", () => {
  const files = fixture();
  files["/styles.css"] = files["/styles.css"]
    .replace(".dashboard { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }", ".dashboard { min-height: 100vh; } .tools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }")
    .replace("@media (max-width: 40rem) { .dashboard { grid-template-columns: 1fr; } }", "@media (max-width: 40rem) { .tools { grid-template-columns: 1fr; } }");
  expect(evaluateWebToolsWorkbenchScenario(files)).toMatchObject({passed: true, violations: []});
});

test("accepts a Pure-style category row with half-width cards", () => {
  const files = fixture();
  files["/styles.css"] = files["/styles.css"]
    .replace(".dashboard { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }", ".dashboard { min-height: 100vh; } .pure-g { display: flex; gap: 1rem; }")
    .replace(".card { background: #f5d0b5; }", ".card { width: calc(50% - .5rem); background: #f5d0b5; }")
    .replace("@media (max-width: 40rem) { .dashboard { grid-template-columns: 1fr; } }", "@media (max-width: 40rem) { .card { width: 100%; } }");
  expect(evaluateWebToolsWorkbenchScenario(files)).toMatchObject({passed: true, violations: []});
});

test("accepts role and style-map helpers that preserve concrete rendered values", () => {
  const files = fixture();
  files["/render.tsx"] = files["/render.tsx"].replace(
    'const shell = dom.createClassFromStyle(css.shell); const dashboard = dom.createClassFromStyle(css.dashboard); const card = dom.createClassFromStyle(css.card); const library = dom.createClassFromStyle(css.library); const workspace = dom.createClassFromStyle(css.workspace); const result = dom.createClassFromStyle(css.result); const dock = dom.createClassFromStyle(css.dock);',
    'const cls = (key: string) => dom.createClassFromStyle((css as any)[key]); const shell = cls("shell"); const dashboard = cls("dashboard"); const card = cls("card"); const library = cls("library"); const workspace = cls("workspace"); const result = cls("result"); const dock = cls("dock");',
  ).replace(
    '<button class="' + "' + card + '" + '" type="button" data-role="tool-card-json">JSON Formatter</button><button class="' + "' + card + '" + '" type="button" data-role="tool-card-case">Text case</button>',
    '<button class="' + "' + card + '" + '" type="button" data-role="tool-card-json">JSON Formatter</button><button class="' + "' + card + '" + '" type="button" data-role="tool-card-case">Text case</button>',
  );
  files["/index.ts"] += '\nconst cards = [["text", "tool-card-text"], ["data", "tool-card-data"], ["seo", "tool-card-seo"], ["images", "tool-card-images"], ["social", "tool-card-social"]]; const roleAttrs = cards.map(([, role]) => ({"data-role": role}));';
  expect(evaluateWebToolsWorkbenchScenario(files).checks.styleMapRendered).toBe(true);
  expect(evaluateWebToolsWorkbenchScenario(files).checks.workbenchMarkup).toBe(true);
});

test("accepts the current FDOPlugin lifecycle and a style-value wrapper", () => {
  const files = fixture();
  files["/index.ts"] = files["/index.ts"]
    .replace('import {FDO_SDK, FDOInterface, defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";', 'import {FDOPlugin, defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";')
    .replace('extends FDO_SDK implements FDOInterface', 'extends FDOPlugin');
  files["/render.tsx"] = files["/render.tsx"].replace(
    'const shell = dom.createClassFromStyle(css.shell); const dashboard = dom.createClassFromStyle(css.dashboard); const card = dom.createClassFromStyle(css.card); const library = dom.createClassFromStyle(css.library); const workspace = dom.createClassFromStyle(css.workspace); const result = dom.createClassFromStyle(css.result); const dock = dom.createClassFromStyle(css.dock);',
    'const style = (value: unknown) => dom.createClassFromStyle(value as Record<string, string>); const shell = style(css.shell); const dashboard = style(css.dashboard); const card = style(css.card); const library = style(css.library); const workspace = style(css.workspace); const result = style(css.result); const dock = style(css.dock);',
  );
  const result = evaluateWebToolsWorkbenchScenario(files);
  expect(result.checks.pluginEntry).toBe(true);
  expect(result.checks.styleMapRendered).toBe(true);
});

test("accepts a direct plugin lifecycle and concrete category-card helper calls", () => {
  const files = fixture();
  files["/index.ts"] = `
class WebToolsWorkbenchPlugin {
  init(): void {}
  render(): string { return ""; }
  renderOnLoad() {}
}
const plugin = new WebToolsWorkbenchPlugin();
export default plugin;
const categoryCard = (key: string) => ({"data-role": \`tool-card-\${key}\`});
categoryCard("text"); categoryCard("data"); categoryCard("seo"); categoryCard("images"); categoryCard("social");
const fixed = 'data-role="tool-workbench" data-role="tool-brand" data-role="tool-dashboard" data-role="tool-library-button" data-role="tool-space-button" data-role="tool-card-json" data-role="tool-card-case" data-role="tool-library" data-role="tool-search" data-role="tool-open-json" data-role="tool-library-close" data-role="tool-workspace" data-role="tool-back-dashboard" data-role="tool-json-input" data-role="tool-format-json" data-role="tool-json-result" data-role="tool-space-dialog" data-role="tool-space-close" data-role="tool-category-workspace" data-role="tool-category-input" data-role="tool-category-action" data-role="tool-category-result" data-role="tool-category-back"';
`;
  const result = evaluateWebToolsWorkbenchScenario(files);
  expect(result.checks.pluginEntry).toBe(true);
  expect(result.checks.workbenchMarkup).toBe(true);
});
