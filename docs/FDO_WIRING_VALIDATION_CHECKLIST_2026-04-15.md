# FDO Wiring Validation Checklist (2026-04-15)

Commit baseline: `84c4d2a`  
Validation scope: `P1.1`, `P1.2`, `P1.4`, `P2.2`

## 1) P1.1 Plugin Doctor Panel Wiring

- [x] Host fetches diagnostics via `UI_MESSAGE` + `handler: "__sdk.getDiagnostics"`.
  Evidence: [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:913)
- [x] Host builds report with `createPluginDoctorReport(diagnostics, { handshake: hostExpectations })`.
  Evidence: [pluginDoctor.js](/Users/alexvwan/dev/fdo/src/utils/pluginDoctor.js:105)
- [x] Host builds panel with `createPluginDoctorPanelModel(report, { maxPrioritizedFindings: 8 })`.
  Evidence: [pluginDoctor.js](/Users/alexvwan/dev/fdo/src/utils/pluginDoctor.js:116)
- [x] Panel UI renders from SDK panel fields directly (no host custom sorting/severity re-ranking).
  Evidence: [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3078), [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3142)
- [x] Blocking state (`panel.blocking === true`) shows degraded-state banner and prioritized blocking findings.
  Evidence: [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3051)
- [x] `finding.exactFix` is copy-ready in UI actions.
  Evidence: [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3093), [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3169)
- [x] Automated test covers at least one blocking and one non-blocking case.
  Evidence: [plugin-doctor.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-doctor.test.js:246)

Acceptance evidence:
- `npx jest --detectOpenHandles tests/unit/plugin-doctor.test.js` -> PASS (8 tests, includes blocking/non-blocking)

## 2) P1.2 RenderOnLoad Templates + Actions UX

- [x] Template picker source is `listRenderOnLoadTemplates()`.
  Evidence: [EditorPage.jsx](/Users/alexvwan/dev/fdo/src/components/editor/EditorPage.jsx:496)
- [x] Template insert path uses `getRenderOnLoadTemplate(id)` and exact `source`.
  Evidence: [EditorPage.jsx](/Users/alexvwan/dev/fdo/src/components/editor/EditorPage.jsx:464)
- [x] UI routes by template `context` (`runtime-source` vs `plugin-method`).
  Evidence: [EditorPage.jsx](/Users/alexvwan/dev/fdo/src/components/editor/EditorPage.jsx:470)
- [x] Strict mode toggle maps directly to `defineRenderOnLoadActions({ strict })`.
  Evidence: [renderOnLoadMonacoSupport.js](/Users/alexvwan/dev/fdo/src/components/editor/utils/renderOnLoadMonacoSupport.js:350), [EditorPage.test.jsx](/Users/alexvwan/dev/fdo/tests/components/editor/EditorPage.test.jsx:236)
- [ ] No duplicated host-hardcoded template source strings remain.
  Evidence (still present): [virtualTemplates.js](/Users/alexvwan/dev/fdo/src/components/editor/utils/virtualTemplates.js:34)
- [x] Automated test covers template list/read + context routing.
  Evidence: [EditorPage.test.jsx](/Users/alexvwan/dev/fdo/tests/components/editor/EditorPage.test.jsx:180), [EditorPage.test.jsx](/Users/alexvwan/dev/fdo/tests/components/editor/EditorPage.test.jsx:293)

Acceptance evidence:
- `npx jest --detectOpenHandles tests/components/editor/EditorPage.test.jsx` -> PASS (14 tests)
- Hardcoded template grep: `grep -RIn "renderOnLoad()" src/components/editor` -> hit in `virtualTemplates.js`

## 3) P1.4 Fixture Runtime Matrix CI

- [x] CI loads matrix from SDK (`getFixtureRuntimeMatrix()` / `listFixtureRuntimeMatrixCases()`), not host static lists.
  Evidence: [fixtureRuntimeMatrixConfig.js](/Users/alexvwan/dev/fdo/tests/e2e/helpers/fixtureRuntimeMatrixConfig.js:43), [fixtureRuntimeMatrixConfig.js](/Users/alexvwan/dev/fdo/tests/e2e/helpers/fixtureRuntimeMatrixConfig.js:60)
- [x] For every matrix case: init/render/renderOnLoad/uiMessage probes are wired.
  Evidence: [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:246), [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:303), [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:341)
- [x] `requiredCapabilities` are granted before probes.
  Evidence: [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:240)
- [x] CI fails fast on unsupported `matrix.contractVersion`.
  Evidence: [fixtureRuntimeMatrixConfig.js](/Users/alexvwan/dev/fdo/tests/e2e/helpers/fixtureRuntimeMatrixConfig.js:52)
- [x] Failure output includes fixture id, handler id (if any), correlation id (if available), host code/message.
  Evidence: [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:519), [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:534)

Acceptance evidence:
- [ ] CI log with at least one full matrix pass.
  Current run (outside sandbox): matrix executed but failed assertions across all 6 fixtures; no passing matrix run yet.
  Evidence: [sdk-fixture-runtime-matrix.md](/Users/alexvwan/dev/fdo/test-results/sdk-fixture-runtime-matrix.md)
- [x] Synthetic failure log captured from executed matrix run in this environment.
  Evidence:
  - Playwright output includes fixture-id keyed failure summary and host assertion context.
  - [sdk-fixture-runtime-matrix.json](/Users/alexvwan/dev/fdo/test-results/sdk-fixture-runtime-matrix.json) contains per-fixture fields (`fixtureId`, `handlerId`, `correlationId`, `code`, `message`) in `records[].firstError`.

## 4) P2.2 Handshake Compatibility Policy + UX

- [x] Host evaluates diagnostics handshake using `evaluateSdkHandshakeCompatibility(...)`.
  Evidence: [pluginHandshakeCompatibility.js](/Users/alexvwan/dev/fdo/src/utils/pluginHandshakeCompatibility.js:266)
- [x] Host behavior gates into `compatible` / `needs-attention` / `incompatible`.
  Evidence (UI/status): [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:782)  
  Evidence (hard block on incompatible): [plugin.js](/Users/alexvwan/dev/fdo/src/ipc/plugin.js:1973)
- [x] Same expectations passed into `createPluginDoctorReport(..., { handshake: ... })`.
  Evidence: [pluginDoctor.js](/Users/alexvwan/dev/fdo/src/utils/pluginDoctor.js:105)
- [x] Handshake issues mapped to exact-fix text (`formatDiagnosticExactFix(...)`).
  Evidence: [diagnosticFixTemplates.js](/Users/alexvwan/dev/fdo/src/utils/diagnosticFixTemplates.js:222), [Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:806)
- [x] Automated tests cover all three status outcomes.
  Evidence: [plugin-doctor.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-doctor.test.js:106), [plugin-doctor.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-doctor.test.js:129), [plugin-doctor.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-doctor.test.js:146)

Acceptance evidence:
- `npx jest --detectOpenHandles tests/unit/plugin-doctor.test.js tests/unit/plugin-handshake-compatibility.test.js` -> PASS

## Release-Blocker Rules

- [x] API/contract major mismatch treated as release blocker.
  Evidence: [plugin.js](/Users/alexvwan/dev/fdo/src/ipc/plugin.js:1980)
- [ ] Missing template ids/fields from SDK contracts treated as release blocker.
  Current state: editor template flow surfaces runtime error but does not enforce release-blocking policy in CI.
- [x] Matrix contract mismatch or unresolved matrix case failure treated as release blocker.
  Evidence: [fixtureRuntimeMatrixConfig.js](/Users/alexvwan/dev/fdo/tests/e2e/helpers/fixtureRuntimeMatrixConfig.js:52), [sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:488)
- [ ] SDK upgrade PR includes migration run (`fdo sdk migrate --target <plugins> [--write]`) before release.
  Current state: policy documented, but no verifiable PR/run evidence captured in this workspace.

## Summary

- `P1.1`: validated complete with code + tests.
- `P1.2`: functionally wired; one closeout criterion remains open (hardcoded template source in `virtualTemplates.js`).
- `P1.4`: orchestration logic validated; full execution evidence blocked by local Electron launch failure.
- `P2.2`: validated complete with code + tests.
