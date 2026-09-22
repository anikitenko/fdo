const {evaluateRoseCalculatorScenario} = require("../e2e/helpers/pluginScenarioRubric.cjs");

function fixture(overrides = {}) {
  return {
    "/index.ts": `import {FDO_SDK, FDOInterface, defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
import {Render} from "./render";
export default class RoseCalculator extends FDO_SDK implements FDOInterface {
  private readonly _metadata = {name: "Rose Calculator", icon: "calculator"};
  get metadata() { return this._metadata; }
  init(): void {}
  render(): string { return Render(); }
  renderOnLoad() { return defineRenderOnLoadActions({handlers: {}, bindings: [
    {selector: "[data-role=\\"calculator-equals\\"]", event: "click", handler: "equals"},
    {selector: "[data-role=\\"calculator-clear\\"]", event: "click", handler: "clear"},
    {selector: "[data-role=\\"calculator-quick-double\\"]", event: "click", handler: "double"},
    {selector: "[data-role=\\"calculator-quick-half\\"]", event: "click", handler: "half"},
    {selector: "[data-role=\\"calculator-quick-add-ten\\"]", event: "click", handler: "addTen"},
    {selector: "[data-role=\\"calculator-sidebar-history\\"]", event: "click", handler: "history"},
    {selector: "[data-role=\\"calculator-sidebar-theme\\"]", event: "click", handler: "theme"},
  ]}); }
}
new RoseCalculator();`,
    "/render.tsx": `import {DOM} from "@anikitenko/fdo-sdk";
import css from "./styles.css";
export const Render = () => { const dom = new DOM(); const shell = dom.createClassFromStyle(css.shell); const display = dom.createClassFromStyle(css.display); const quick = dom.createClassFromStyle(css.quick); const result = dom.createClassFromStyle(css.result); const sidebar = dom.createClassFromStyle(css.sidebar); const cat = dom.createClassFromStyle(css.cat); const catHead = dom.createClassFromStyle(css.catHead); const catEar = dom.createClassFromStyle(css.catEar); const catEye = dom.createClassFromStyle(css.catEye); const catTail = dom.createClassFromStyle(css.catTail); return dom.renderHTML('<span class="' + cat + '" data-role="calculator-cat" aria-hidden="true"><span class="' + catHead + '" data-role="calculator-cat-head"><span class="' + catEar + '" data-role="calculator-cat-ear-left"></span><span class="' + catEar + '" data-role="calculator-cat-ear-right"></span><span class="' + catEye + '" data-role="calculator-cat-eye-left"></span><span class="' + catEye + '" data-role="calculator-cat-eye-right"></span></span><span class="' + catTail + '" data-role="calculator-cat-tail"></span></span><main class="' + shell + '" data-role="calculator-shell"><form class="pure-form pure-form-stacked"><input class="' + display + '" data-role="calculator-display" /></form><button type="button" class="pure-button pure-button-primary" data-role="calculator-equals">Equals</button><button type="button" class="pure-button" data-role="calculator-clear">Clear</button><section class="' + quick + '" data-role="calculator-quick-actions"><button type="button" data-role="calculator-quick-double">Double</button><button type="button" data-role="calculator-quick-half">Half</button><button type="button" data-role="calculator-quick-add-ten">+10</button></section><output class="' + result + '" data-role="calculator-result"></output><aside class="' + sidebar + '" data-role="calculator-sidebar"><button type="button" data-role="calculator-sidebar-history">History</button><button type="button" data-role="calculator-sidebar-theme">Theme</button></aside><h1>Rose Calculator</h1></main>'); };`,
    "/styles.css": `.shell { padding: 1rem; border: 1px solid #b54870; border-radius: 18px; box-shadow: 0 14px 32px #8a1d4b33; background: #fff3f7; display: grid; grid-template-columns: minmax(0, 1fr) 12rem; color: #5b1632;\n  .sidebar { background: #ffe1eb; }\n}\n.display { color: #5b1632; }\n.quick { display: grid; grid-template-columns: repeat(3, 1fr); }\n.result { background: #fff; }\n.sidebar { padding: .75rem; }\n.cat { position: fixed; inset: 0; pointer-events: none; opacity: .4; }
.catHead { border-radius: 50%; }
.catEar { border-radius: 50% 50% 0 0; }
.catEye { border-radius: 50%; }
.catTail { border-radius: 50%; }\n@keyframes rose-pulse { from { opacity: .7; } to { opacity: 1; } }\n@media (prefers-reduced-motion: reduce) { .shell { animation: none; } }\n@media (max-width: 40rem) { .shell { grid-template-columns: 1fr; } }`,
    "/render.test.ts": `import test from "node:test"; import assert from "node:assert/strict";\ntest("title", () => assert.ok(true)); test("actions", () => assert.ok(true)); test("sidebar", () => assert.ok(true));`,
    ...overrides,
  };
}

test("passes a complete Rose Calculator fixture", () => {
  expect(evaluateRoseCalculatorScenario(fixture())).toMatchObject({passed: true, violations: []});
});

test("rejects unsafe arithmetic evaluation", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/index.ts": `${fixture()["/index.ts"]}\nconst calculate = (value) => eval(value);`,
  });
  expect(result.checks.noUnsafeEvaluation).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires every quick and sidebar action to use a declarative binding", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/index.ts": fixture()["/index.ts"].replace('{selector: "[data-role=\\"calculator-sidebar-theme\\"]", event: "click", handler: "theme"},', ""),
  });
  expect(result.checks.declarativeActions).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires the decorative cat to be rendered through the style map", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/render.tsx": fixture()["/render.tsx"].replaceAll("calculator-cat", "missing-calculator-cat").replace("css.cat", "css.shell"),
  });
  expect(result.checks.decorativeCat).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires the cat to be a full-background layer", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/styles.css": fixture()["/styles.css"].replace("position: fixed; inset: 0;", "position: absolute;"),
  });
  expect(result.checks.catStyles).toBe(false);
  expect(result.passed).toBe(false);
});

test("requires at least two focused node tests", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/render.test.ts": `import test from "node:test"; import assert from "node:assert/strict";
test("single assertion", () => assert.ok(true));`,
  });
  expect(result.checks.nodeTests).toBe(false);
  expect(result.passed).toBe(false);
});

test("accepts descendant and attribute nested CSS selectors", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/styles.css": fixture()["/styles.css"].replace("  .sidebar { background: #ffe1eb; }", "  & h2 { color: #5b1632; }\n  &[data-theme=\"night\"] { color: #fff; }"),
  });
  expect(result.checks.nestedStyles).toBe(true);
  expect(result.passed).toBe(true);
});

test("accepts reusable button markup and a role-mapped declarative binding list", () => {
  const result = evaluateRoseCalculatorScenario({
    ...fixture(),
    "/index.ts": `import {FDO_SDK, FDOInterface} from "@anikitenko/fdo-sdk";
import {render, renderOnLoad} from "./render";
export default class RoseCalculator extends FDO_SDK implements FDOInterface {
  private readonly _metadata = {name: "Rose Calculator", icon: "calculator"};
  get metadata() { return this._metadata; }
  init(): void {}
  render(): string { return render(); }
  renderOnLoad() { return renderOnLoad(); }
}
new RoseCalculator();`,
    "/render.tsx": `import {DOM, defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
import css from "./styles.css";
export const render = () => { const dom = new DOM();
  const cat = dom.createClassFromStyle(css.cat); const catHead = dom.createClassFromStyle(css.catHead); const catEar = dom.createClassFromStyle(css.catEar); const catEye = dom.createClassFromStyle(css.catEye); const catTail = dom.createClassFromStyle(css.catTail);
  const formClass = "pure-form pure-form-stacked";
  const button = (role: string) => dom.createElement("button", {type: "button", class: "pure-button pure-button-primary", "data-role": role}, role);
  return dom.renderHTML(dom.createElement("main", {"data-role": "calculator-shell", class: dom.createClassFromStyle(css.shell)},
    dom.createElement("div", {"data-role": "calculator-cat", class: cat}, dom.createElement("span", {"data-role": "calculator-cat-head", class: catHead}, dom.createElement("span", {"data-role": "calculator-cat-ear-left", class: catEar}) + dom.createElement("span", {"data-role": "calculator-cat-ear-right", class: catEar}) + dom.createElement("span", {"data-role": "calculator-cat-eye-left", class: catEye}) + dom.createElement("span", {"data-role": "calculator-cat-eye-right", class: catEye})) + dom.createElement("span", {"data-role": "calculator-cat-tail", class: catTail})) +
    dom.createElement("input", {"data-role": "calculator-display"}) +
    button("calculator-equals") + button("calculator-clear") +
    dom.createElement("section", {"data-role": "calculator-quick-actions"}, button("calculator-quick-double") + button("calculator-quick-half") + button("calculator-quick-add-ten")) +
    dom.createElement("output", {"data-role": "calculator-result"}) +
    dom.createElement("aside", {"data-role": "calculator-sidebar"}, button("calculator-sidebar-history") + button("calculator-sidebar-theme")) + "Rose Calculator"));
};
export const renderOnLoad = () => defineRenderOnLoadActions({handlers: {}, bindings: [
  ["equals", "calculator-equals"], ["clear", "calculator-clear"], ["double", "calculator-quick-double"],
  ["half", "calculator-quick-half"], ["addTen", "calculator-quick-add-ten"], ["history", "calculator-sidebar-history"], ["theme", "calculator-sidebar-theme"],
].map(([handler, role]) => ({selector: \`[data-role="\${role}"]\`, event: "click", handler}))});`,
  });
  expect(result).toMatchObject({passed: true, violations: []});
});
