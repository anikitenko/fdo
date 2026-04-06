# Plugin UX Production TODO

## Goal
Ship plugin open/render lifecycle with deterministic behavior, clear recovery, and release-grade observability.

## Reliability
- [x] Add Electron E2E stress test: activate/open/render/deactivate loop (50+ iterations) and fail build on instability.
- [x] Add E2E scenario for transient runtime status failures and delayed `PLUGIN_READY`.
- [x] Add explicit host metric for time-to-first-plugin-paint (TTFP) and track p95.
- [x] Add structured event IDs for plugin lifecycle events (activate, ready, init, render, unload).

## User Experience
- [x] Add "Open plugin logs" action from plugin error toasts.
- [x] Add "Retry" and "Report issue" actions for non-manual unload/error toasts.
- [x] Normalize wording:
  - user-safe summary in toast
  - technical details only in optional debug view
- [x] Keep currently opened plugin view stable unless user explicitly switches/closes.

## Error Handling
- [x] Distinguish errors in UI copy:
  - signature/verification errors
  - runtime startup errors
  - render payload/iframe errors
- [x] Add backoff retry policy for render request when runtime is not ready yet.
- [x] Prevent duplicate toasts for the same plugin+reason within a short window.

## Security / Signing
- [x] Keep signed plugin code immutable at runtime (use separate `PLUGIN_HOME` data directory).
- [x] Add migration note for plugin SDK authors to use `PLUGIN_HOME` for writable state and `PLUGIN_CODE_HOME` for read-only assets.
- [x] Add diagnostic warning if plugin writes into code directory (best-effort detection in development mode).

## Cleanup
- [x] Remove temporary `fdo:plugin-trace` instrumentation after stability is confirmed in E2E.
- [x] Keep `fdo:plugin-stage-debug` but document it as development-only.
