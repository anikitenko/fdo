# TODO: Plugin Iframe Production Hardening

## Goal
Make plugin UI loading/switching deterministic in packaged builds and remove current layout-collapse recoveries as a primary mechanism.

## Phase 1: Stabilize Runtime Topology
- [x] Introduce a persistent iframe pool keyed by `pluginId` (one iframe per active plugin).
- [x] Stop remounting iframe on every plugin switch.
- [x] Keep inactive plugin iframes mounted and switch visibility only.

Acceptance criteria:
- Switching plugins does not recreate iframe document context.
- `PLUGIN_HELLO` is emitted once per iframe lifecycle, not on every switch.

## Phase 2: Safe Visibility Strategy
- [x] Replace any `display: none` hiding of plugin surfaces with non-collapsing strategy:
  - active iframe: `opacity:1; pointer-events:auto`
  - inactive iframe: `opacity:0; pointer-events:none` (or offscreen translate)
- [x] Ensure container layout always gives non-zero geometry to mounted iframes.

Acceptance criteria:
- No `docElRect/bodyRect/rootRect=0x0` after switch in diagnostics.

## Phase 3: Explicit Host/Iframe Readiness Contract
- [x] Add iframe readiness message with geometry payload:
  - `viewport`, `docElRect`, `bodyRect`, `rootRect`
- [x] Host must treat iframe as ready only after non-zero geometry is confirmed.
- [x] Block render post until readiness contract is satisfied.

Acceptance criteria:
- Render posts happen only after geometry-ready handshake.

## Phase 4: Health Recovery and User Fallback
- [x] Keep bounded automatic recovery for collapsed layout as a safety net.
- [x] Add explicit terminal fallback UI after retry budget is exhausted.
- [x] Add user-facing “Reload plugin frame” action.

Acceptance criteria:
- No infinite retries.
- Clear failure state with actionable recovery.

## Phase 5: Event Isolation and Security Correctness
- [x] Keep strict event source binding: `event.source === activeIframe.contentWindow`.
- [x] Keep payload validation and external-link guardrails.
- [x] Add tests for stale iframe event rejection during rapid plugin switching.

Acceptance criteria:
- Stale iframe events cannot mutate active plugin state.

## Phase 6: Observability and Regression Guardrails
- [x] Emit structured metrics:
  - `plugin_iframe_layout_collapsed`
  - `plugin_iframe_recovery_attempt`
  - `plugin_iframe_recovery_success`
  - `plugin_iframe_terminal_failure`
- [x] Add dashboard/alerts for collapse rate and recovery rate by build version.
- [x] Add stress e2e:
  - rapid plugin switching loop
  - packaged build smoke with layout assertions

Acceptance criteria:
- Regression is detectable automatically before release.

## Implementation Order
1. Phase 1 + Phase 2 (largest impact).
2. Phase 3 (formal readiness handshake).
3. Phase 5 (already partly done, finish test coverage).
4. Phase 4 (fallback UX).
5. Phase 6 (metrics + CI/e2e guardrails).
