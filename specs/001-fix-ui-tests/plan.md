# Implementation Plan: Fix UI Test Launches and Address Failing Tests

**Branch**: `001-fix-ui-tests` | **Date**: 2025-10-30 | **Spec**: ./spec.md
**Input**: Feature specification from `/specs/001-fix-ui-tests/spec.md`

## Summary

Ensure Electron-based E2E tests launch reliably and fix failing UI tests around Monaco content visibility and skeleton behavior. Implement retry strategy (2s linear backoff), fail-fast port conflict handling, robust cleanup (force-kill on failure), JUnit XML reporting, and deterministic timeouts with diagnostics.

## Technical Context

**Language/Version**: JavaScript/Node.js (Electron 37.7.1)
**Primary Dependencies**: Jest 30.x, ws 8.x, React Testing Library, Electron
**Storage**: N/A (test infra only)
**Testing**: Jest (unit, integration, E2E)
**Target Platform**: Desktop (macOS local dev), CI Ubuntu with Xvfb
**Project Type**: Desktop app (Electron + React)
**Performance Goals**: E2E suite < 60s; version switch < 3s; content display < 2s
**Constraints**: Launch success ≥ 95%; deterministic CI with JUnit XML
**Scale/Scope**: Single-runner local; CI parallel at job level

## Constitution Check

- Plugin-First Architecture: Not applicable to test infra changes (no core feature logic added) – PASS
- Process Isolation: No changes to plugin isolation – PASS
- Developer Experience First: Improves local test reliability – PASS
- Observability & Transparency: Adds deterministic diagnostics and reporting – PASS
- Test-First Development: Tightens E2E assertions and stability – PASS

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-ui-tests/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── README.md
└── spec.md
```

### Source Code (repository root)

```text
src/
├── components/
├── ipc/
└── utils/

tests/
├── e2e/
│   ├── launcher.js          # adjust retries, error messages
│   ├── client.js            # port conflict handling
│   ├── run-e2e.sh           # env & wait loops
│   └── snapshot-loading.test.js
├── integration/
└── unit/
```

**Structure Decision**: Single project. E2E infra updated in `tests/e2e/*`; no new packages.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | — | — |
