# SDK Examples Live E2E Fix Report

This file tracks SDK example issues found by live FDO E2E runs and the exact fixes to apply in `../fdo-sdk/examples`.

## Scope

- Source of truth: `../fdo-sdk/examples` and `../fdo-sdk/examples/fixtures`
- Validation path: FDO live Electron + Playwright tests
- Goal: every example plugin should do exactly what its code claims

## Current Findings

Status summary (2026-04-07, latest run):
- `tests/e2e/sdk-examples-smoke.spec.js`: 19/19 passing
- `tests/e2e/sdk-examples-behavior.spec.js`: 2/2 passing (`02`, `03`)

### 0) Missing bootstrap instantiation in examples

Status: fixed in local SDK checkout (`../fdo-sdk`).

Applied fixes:
- `01-basic-plugin.ts` -> `new BasicPlugin();`
- `02-interactive-plugin.ts` -> `new InteractivePlugin();`
- `03-persistence-plugin.ts` -> `new PersistencePlugin();`
- `04-ui-extensions-plugin.ts` -> `new UIExtensionsPlugin();`
- `07-injected-libraries-demo.ts` -> `new InjectedLibrariesDemoPlugin();`
- `08-privileged-actions-plugin.ts` -> `new PrivilegedActionsPlugin();`
- `09-operator-plugin.ts` -> `new OperatorPluginExample();`
- `dom_elements_plugin.ts` -> `new DOMElementsExamplePlugin();`

Impact:
- required for deterministic plugin startup in the host runtime
- removes one major source of example load/init drift

### 1) `02-interactive-plugin.ts`

Status: fixed.

Applied fixes:
- bridge helper pattern adopted with explicit host contract:
  - `callHandler(handler, content) -> window.createBackendReq("UI_MESSAGE", { handler, content })`
- moved UI event binding to `renderOnLoad()`
- fixed template-string escaping bug in `renderOnLoad()`

### 2) `03-persistence-plugin.ts`

Status: fixed.

Applied fixes:
- removed render-time button callbacks that referenced browser globals in backend context
- added stable button IDs and UI-side wiring
- adopted bridge helper pattern:
  - `callHandler(handler, content) -> window.createBackendReq("UI_MESSAGE", { handler, content })`

### 3) Render hardening fixes for example/fixture set

Status: fixed in local SDK checkout.

Root cause:
- several examples could throw `document is not defined` during `render()`
- this surfaced as `plugin.render.error` in runtime logs and "Failed to render UI" in host UX

Applied fixes:
- added render `try/catch` fallback markup (plain HTML fallback, no DOM helper dependency) in:
  - `04-ui-extensions-plugin.ts`
  - `05-advanced-dom-plugin.ts`
  - `dom_elements_plugin.ts`
  - `fixtures/advanced-ui-plugin.fixture.ts`

### 4) Import alignment for SDK-packaged examples

Status: fixed.

Applied fixes:
- replaced local-source imports (`../src`) with package imports (`@anikitenko/fdo-sdk`) in:
  - `07-injected-libraries-demo.ts`
  - `08-privileged-actions-plugin.ts`
  - `09-operator-plugin.ts`

### 5) Generic guidance for all interactive examples

Use this pattern consistently:

1. `init()`:
- register handlers only

2. `render()`:
- return static UI structure only
- avoid runtime DOM logic and avoid large inline `<script>` blocks

3. `renderOnLoad()`:
- attach listeners with `document.getElementById(...)`
- call backend through `window.createBackendReq("UI_MESSAGE", { handler, content })`

4. Error handling:
- write visible UI fallback for handler failures
- return structured error objects in handlers

### 6) Operator examples stuck on iframe loader (resolved)

Status: fixed.

Root cause:
- rich UI scaffolds in operator examples (including complex inline UI behavior) caused iframe render instability in live host runtime for these cases.

Applied fixes:
- simplified operator example `render()` output to static, deterministic markup.
- removed non-essential inline UI glue from fixture render path and kept operator behavior in backend handlers.

Updated files:
- `09-operator-plugin.ts`
- `fixtures/operator-kubernetes-plugin.fixture.ts`

Best-practice rule:
- keep `render()` and `renderOnLoad()` lightweight and deterministic in SDK examples.
- demonstrate operator/process/workflow behavior through backend handlers and SDK helpers, not heavy inline UI orchestration.

Validation hardening retained:
- smoke fails explicitly with `PLUGIN_IFRAME_STUCK_LOADER` if iframe remains on loader markup.
- failure payload includes `uiState` + plugin log tail.

## Copy-Ready Bridge Pattern

```js
const call = async (handler, content = {}) => {
  return await window.createBackendReq("UI_MESSAGE", {
    handler,
    content,
  });
};
```

Applied in local SDK checkout:
- `02-interactive-plugin.ts`
- `03-persistence-plugin.ts`

## Why this report exists

Example plugins can have bugs or drift from host runtime behavior. This file is the explicit contract for what must be fixed in SDK examples to keep live E2E green and trustworthy.
