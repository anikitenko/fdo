# Plugin Debug Flags (Development Only)

These localStorage flags are for debugging plugin lifecycle behavior during development and E2E.
They should not be enabled in normal production usage.

## Flags
- `fdo:plugin-stage-debug`
  - Enables plugin lifecycle stage logging for host/container diagnostics.
- `fdo:plugin-stage-debug-ui`
  - Enables PluginContainer in-frame stage text in loading/error overlays.

## Notes
- Keep these flags disabled by default in production workflows.
- Use them only for troubleshooting render lifecycle, activation/deactivation, and iframe host communication.
