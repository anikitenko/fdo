# Tasks: Fix UI Test Launches and Address Failing Tests

Branch: `001-fix-ui-tests`  
Spec: `./spec.md`

## Phase 1 — Setup

- [X] T001 Ensure JUnit XML reporting enabled in jest.config.js
- [X] T002 Add port conflict fail-fast messaging in tests/e2e/client.js
- [X] T003 Add retry spacing constant (2s) in tests/e2e/launcher.js

## Phase 2 — Foundational

- [X] T004 Update cleanup to force-kill Electron on failure in tests/e2e/launcher.js
- [X] T005 Emit detailed diagnostics on Monaco timeout in tests/e2e/snapshot-loading.test.js
- [X] T006 Ensure run-e2e.sh exits non-zero on infra failures in tests/e2e/run-e2e.sh

## Phase 3 — User Story 1 (P1): Developers Run E2E Tests Locally

Goal: Reliable local E2E runs; launch success ≥ 95%  
Independent Test: Run `npm run test:e2e` 5 times; all start Electron and execute tests

- [X] T007 [US1] Implement 3-attempt retry with 2s delay in tests/e2e/launcher.js
- [X] T008 [P] [US1] Add clear error for launch timeout in tests/e2e/launcher.js
- [X] T009 [US1] Validate server readiness loop (port 9555) in tests/e2e/run-e2e.sh

## Phase 4 — User Story 2 (P1): UI Tests Validate Editor Content Display

Goal: Monaco shows index content within 2s; after switch also visible  
Independent Test: Create plugin, open editor; verify content visible; switch versions

- [X] T010 [US2] Implement exponential-backoff polling (≤2s total) in tests/e2e/snapshot-loading.test.js
- [X] T011 [US2] On timeout, collect models and active path diagnostics in tests/e2e/snapshot-loading.test.js
- [X] T012 [P] [US2] Trigger Monaco refresh after restore in src/components/editor/utils/VirtualFS.js

## Phase 5 — User Story 3 (P2): Skeleton Loading States Work Correctly

Goal: OFF→ON→OFF exactly twice; appear <200ms; no flicker  
Independent Test: Switch versions; verify 2 transitions and timing

- [X] T013 [US3] Ensure single source of truth for treeLoading notifications in src/components/editor/*
- [X] T014 [P] [US3] Remove any redundant stopLoading calls in src/components/editor/CodeDeployActions.js
- [X] T015 [US3] Tighten mutation count assertions (<400) in tests/e2e/snapshot-loading.test.js

## Phase 6 — User Story 4 (P2): CI/CD Pipeline Runs Tests Reliably

Goal: Deterministic CI runs with JUnit XML on Ubuntu + Xvfb  
Independent Test: CI job passes consistently; artifacts include XML report

- [ ] T016 [US4] Ensure JUnit XML output path and upload in .github/workflows/* (if present)
- [ ] T017 [P] [US4] Add xvfb-run invocation docs in specs/001-fix-ui-tests/quickstart.md
- [ ] T018 [US4] Fail fast on port conflict with clear messaging in tests/e2e/client.js

## Final Phase — Polish & Cross-Cutting

- [ ] T019 Review logs for actionable context across failures in tests/e2e/*
- [ ] T020 Ensure tasks’ acceptance criteria are met via local run notes in specs/001-fix-ui-tests/quickstart.md

## Dependencies

1 → 2 → 3 (US1) → 4 (US2) → 5 (US3) → 6 (US4) → Final

## Parallelization Opportunities

- T008 can run in parallel with T007 (different code paths)
- T011 can run in parallel with T012 (test vs app code)
- T014 in parallel with T015 (logic vs tests)
- T017 in parallel with T016 (docs vs CI config)

## Implementation Strategy

- MVP: Complete Phase 1-3 to stabilize local runs and launch reliability.
- Then: Address content visibility (Phase 4) and skeleton behavior (Phase 5).
- Finally: CI hardening and polish (Phases 6 and Final).
