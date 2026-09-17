# DX Roadmap TODO (Local Closeout)

Date: 2026-04-15  
Baseline commit: `84c4d2a`

## Status Updates

- `P1.1` -> complete (2026-04-15)  
  Evidence: Plugin Doctor contract wiring + panel model rendering + blocking/non-blocking tests.  
  References:
  - [src/utils/pluginDoctor.js](/Users/alexvwan/dev/fdo/src/utils/pluginDoctor.js:105)
  - [src/Home.jsx](/Users/alexvwan/dev/fdo/src/Home.jsx:3051)
  - [tests/unit/plugin-doctor.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-doctor.test.js:246)
  - Test output: `npx jest --detectOpenHandles tests/unit/plugin-doctor.test.js` (PASS)

- `P1.2` -> blocked (remaining criterion) (2026-04-15)  
  Wired and tested: SDK template list/get, context routing, strict mapping.  
  Remaining blocker: host-hardcoded renderOnLoad source still present in scaffold template.
  References:
  - [src/components/editor/EditorPage.jsx](/Users/alexvwan/dev/fdo/src/components/editor/EditorPage.jsx:464)
  - [tests/components/editor/EditorPage.test.jsx](/Users/alexvwan/dev/fdo/tests/components/editor/EditorPage.test.jsx:293)
  - [src/components/editor/utils/virtualTemplates.js](/Users/alexvwan/dev/fdo/src/components/editor/utils/virtualTemplates.js:34)
  - Test output: `npx jest --detectOpenHandles tests/components/editor/EditorPage.test.jsx` (PASS)

- `P1.4` -> blocked (execution environment) (2026-04-15)  
  Matrix contract wiring is in place (SDK-driven, contract checks, required capabilities, probe metadata).  
  Out-of-sandbox run executed successfully to matrix assertion stage, but all fixtures currently fail runtime checks; full-pass CI evidence is still pending.
  References:
  - [tests/e2e/helpers/fixtureRuntimeMatrixConfig.js](/Users/alexvwan/dev/fdo/tests/e2e/helpers/fixtureRuntimeMatrixConfig.js:43)
  - [tests/e2e/sdk-fixture-runtime-matrix.spec.js](/Users/alexvwan/dev/fdo/tests/e2e/sdk-fixture-runtime-matrix.spec.js:463)
  - Matrix artifact: [sdk-fixture-runtime-matrix.md](/Users/alexvwan/dev/fdo/test-results/sdk-fixture-runtime-matrix.md)
  - Matrix artifact JSON: [sdk-fixture-runtime-matrix.json](/Users/alexvwan/dev/fdo/test-results/sdk-fixture-runtime-matrix.json)
  - Test output: `npx playwright test tests/e2e/sdk-fixture-runtime-matrix.spec.js --reporter=line` (FAILED: fixture assertions across all 6 cases)

- `P2.2` -> complete (2026-04-15)  
  Evidence: handshake compatibility evaluation, status gating, exact-fix mapping, and status outcome tests.
  References:
  - [src/utils/pluginHandshakeCompatibility.js](/Users/alexvwan/dev/fdo/src/utils/pluginHandshakeCompatibility.js:266)
  - [src/ipc/plugin.js](/Users/alexvwan/dev/fdo/src/ipc/plugin.js:1973)
  - [src/utils/diagnosticFixTemplates.js](/Users/alexvwan/dev/fdo/src/utils/diagnosticFixTemplates.js:222)
  - [tests/unit/plugin-handshake-compatibility.test.js](/Users/alexvwan/dev/fdo/tests/unit/plugin-handshake-compatibility.test.js:10)
  - Test output: `npx jest --detectOpenHandles tests/unit/plugin-doctor.test.js tests/unit/plugin-handshake-compatibility.test.js` (PASS)

## Notes

- Detailed checklist with per-line evidence is recorded in:  
  [docs/FDO_WIRING_VALIDATION_CHECKLIST_2026-04-15.md](/Users/alexvwan/dev/fdo/docs/FDO_WIRING_VALIDATION_CHECKLIST_2026-04-15.md)
