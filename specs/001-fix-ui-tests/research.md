# Research: Fix UI Test Launches and Address Failing Tests

**Branch**: 001-fix-ui-tests  
**Date**: 2025-10-30  
**Source Spec**: ./spec.md

## Decisions

1. Retry Strategy for Electron Launch
- Decision: Linear backoff; wait 2s between retries (max 3 attempts)
- Rationale: Stabilizes intermittent resource contention without long delays; aligns with 60s suite budget
- Alternatives:
  - Immediate retries (0s) – lower success rate
  - Exponential (1s,2s,4s) – added latency with little benefit here

2. Port Conflict Handling (9555)
- Decision: Fail immediately with clear error, suggest killing stale Electron
- Rationale: Avoids indefinite waits/queueing; keeps failures explicit
- Alternatives:
  - Queue up to 60s – hides issues, increases flakiness
  - Auto-select next port – breaks test client expectations

3. Cleanup Failures
- Decision: Log error and force-kill (SIGKILL), do not fail the run
- Rationale: Prevents cascading failures in subsequent runs while surfacing issues
- Alternatives:
  - Ignore silently – leads to zombie processes
  - Fail the test run – obscures original result

4. CI Report Format
- Decision: JUnit XML
- Rationale: Broad CI support, easy parsing, trend reporting
- Alternatives: JSON (custom), TAP, Allure (heavier infra)

5. Monaco Content Timeout
- Decision: Fail with diagnostics (models, active path, recent errors)
- Rationale: Deterministic tests with actionable data
- Alternatives:
  - Extend wait by +3s – hides real perf issues
  - Mark flaky and retry – encourages instability

## Best Practices Consulted
- Electron E2E: ensure visible window or active stdout in headless contexts
- Port hygiene: fail-fast on conflicts for deterministic CI
- Test diagnostics: capture enough context to fix quickly (timestamps, models)
- Reporting: JUnit XML for CI interoperability

## Open Items
None – all clarifications resolved in spec.
