# Fixture Runtime Matrix

FDO CI includes a dedicated SDK fixture runtime matrix to catch host lifecycle regressions against the canonical SDK fixture set.

## What It Checks

The matrix is loaded from installed `@anikitenko/fdo-sdk` editor/runtime helpers:

- `getFixtureRuntimeMatrix()`
- `listFixtureRuntimeMatrixCases()`
- `getFixtureRuntimeMatrixCase(id)`

FDO does not keep a duplicate fixture ID list in source. For each SDK matrix case, CI resolves the fixture from the SDK examples directory and runs these host-level checks:

- `PLUGIN_INIT`: the host `window.electron.plugin.init(...)` call returns without error and the plugin reaches the ready/inited runtime state.
- `PLUGIN_RENDER`: the host `window.electron.plugin.render(...)` call emits a render event with a valid payload shape.
- Render-prep safety: the plugin UI opens without blocked-pattern preparation failures, render-loader deadlocks, or render/init error log signals.
- `__sdk.getDiagnostics`: the diagnostics bridge returns a structured response with `apiVersion`, `capabilities`, and `health`.
- Optional `renderOnLoad` probe execution inside the plugin iframe sandbox.
- Canonical `UI_MESSAGE` probes from matrix case definitions using `window.createBackendReq("UI_MESSAGE", { handler, content })`.
- Required capability grants from `requiredCapabilities` before lifecycle probing.

The matrix writes both:

- `test-results/sdk-fixture-runtime-matrix.json`
- `test-results/sdk-fixture-runtime-matrix.md`

These artifacts are uploaded by `.github/workflows/editor_ui_tests.yml` for debugging.

## How To Add A New Fixture

1. Add the new SDK fixture file under the SDK examples `fixtures/` directory.
2. Add or update the fixture entry in the SDK fixture runtime matrix contract (`getFixtureRuntimeMatrix()` and case helpers).
3. Define lifecycle and `UI_MESSAGE` probes in the SDK matrix entry, including `requiredCapabilities` when needed.
4. Run `npm run test:e2e:fixtures:matrix` locally in FDO.

Fixture additions/renames in SDK are automatically pulled by contract and must resolve in host CI, otherwise the matrix fails fast.

If SDK matrix `contractVersion` is not supported by host CI wiring, the suite fails immediately with remediation text.

## How To Debug Failures

- Open the uploaded `sdk-fixture-runtime-matrix.json` or `.md` artifact first to see the fixture-by-fixture status.
- Check the first recorded error message, stack, and correlation ID in the JSON report.
- Re-run the matrix locally with:

```bash
npm run test:e2e:fixtures:matrix
```

- If needed, narrow investigation to the fixture source listed in the report and compare its registered handlers and diagnostics output with the current host lifecycle expectations.
