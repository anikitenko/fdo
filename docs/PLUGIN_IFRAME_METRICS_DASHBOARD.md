# Plugin Iframe Metrics Dashboard and Alerts

## Scope
This runbook defines production monitoring for plugin iframe rendering stability.

Metrics emitted by host:
- `plugin_iframe_layout_collapsed`
- `plugin_iframe_recovery_attempt`
- `plugin_iframe_recovery_success`
- `plugin_iframe_terminal_failure`

Each metric event includes at least:
- `metric`
- `plugin`
- `ts` (epoch ms)

## Collection Contract
1. Read from `window.__FDO_PLUGIN_METRICS__` in renderer.
2. Batch-upload every 30s or on app idle/close.
3. Attach release/build tags to each uploaded event:
- `app_version`
- `build_channel`
- `platform`
- `os_version`

## Recommended Dashboard Panels
1. `layout_collapsed_rate`
- Query: `count(plugin_iframe_layout_collapsed) / count(plugin_iframe_recovery_attempt + plugin_iframe_recovery_success + plugin_iframe_terminal_failure + 1)`
- Breakdown: by `app_version`, `plugin`, `platform`
- Window: 1h rolling

2. `terminal_failure_rate`
- Query: `count(plugin_iframe_terminal_failure) / active_plugin_sessions`
- Breakdown: by `app_version`, `plugin`
- Window: 1h and 24h

3. `recovery_success_ratio`
- Query: `count(plugin_iframe_recovery_success) / max(count(plugin_iframe_recovery_attempt), 1)`
- Breakdown: by `app_version`, `plugin`
- Window: 1h rolling

4. `collapse_to_terminal_funnel`
- Stage counts:
  - `plugin_iframe_layout_collapsed`
  - `plugin_iframe_recovery_attempt`
  - `plugin_iframe_recovery_success`
  - `plugin_iframe_terminal_failure`

## Alert Rules
1. Critical: terminal failures spike
- Condition: `terminal_failure_rate > 2%` for 15m
- Filter: `active_plugin_sessions >= 50`
- Action: page on-call + block release promotion

2. Warning: collapse regression
- Condition: `layout_collapsed_rate > 5%` for 30m
- Filter: `active_plugin_sessions >= 50`
- Action: create incident ticket + assign plugin/runtime owner

3. Warning: recovery degraded
- Condition: `recovery_success_ratio < 80%` for 30m
- Filter: `count(plugin_iframe_recovery_attempt) >= 30`
- Action: triage with latest failing plugins and app versions

## Release Gate
Before promoting a build:
1. Run stress e2e (`plugin-iframe-switch-stress.spec.js`).
2. Run packaged smoke e2e (`plugin-packaged-layout-smoke.spec.js` with `FDO_E2E_PACKAGED_EXECUTABLE` set).
3. Verify last 24h:
- `terminal_failure_rate < 1%`
- `layout_collapsed_rate` non-increasing vs previous stable build.

