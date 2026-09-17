# SDK Host Boundary

This document defines the boundary between the exported `@anikitenko/fdo-sdk` contract and FDO's host implementation.

## Source Of Truth

### SDK owns

The SDK is the source of truth for:

- exported package surface from `@anikitenko/fdo-sdk`
- public TypeScript types and interfaces
- plugin metadata validation rules
- serialized render payload contract
- host message and UI message contract validators
- documented plugin authoring/runtime guidance

FDO should treat SDK package internals as unstable unless they are explicitly exported and documented.

### FDO owns

FDO is the source of truth for:

- the plugin backend utility-process lifecycle
- the sandboxed iframe host page
- the render preparation pipeline in the host
- preload and IPC bridging
- bundled-SDK lookup for host features such as local type injection or knowledge indexing
- the concrete runtime behavior of the host page and plugin container

## Rules

1. Do not import package-internal SDK paths from renderer code.

Bad:

```js
import domMetadata from "@anikitenko/fdo-sdk/dist/dom-metadata.json";
```

Good:

- use the SDK root export when the symbol is exported there
- or read bundled SDK artifacts from the FDO backend/preload bridge when host tooling needs them

2. Prefer SDK validation helpers over handwritten host validation where practical.

Examples:

- `validatePluginMetadata(...)`
- `validateSerializedRenderPayload(...)`
- `validateHostMessageEnvelope(...)`
- `validateUIMessagePayload(...)`

If FDO must add host-specific checks, they should be clearly labeled as host guardrails rather than SDK rules.

3. Keep runtime scopes separate.

- SDK docs define backend runtime vs iframe UI runtime expectations
- FDO implements the actual host runtime
- injected iframe helpers/libraries are not backend guarantees

4. Use bundled SDK introspection only for host tooling.

Examples:

- Monaco extra libs
- SDK knowledge retrieval
- Live UI metadata loading

Those are FDO host features, not plugin author imports.

## Practical Implications For FDO

- Plugin codegen should only rely on exported/documented SDK surface.
- Renderer code should not reach into `@anikitenko/fdo-sdk/dist/...`.
- When SDK package exports change, FDO host tooling may need backend-side adaptation, but plugin code should continue to target the public SDK contract.

## Host-Enforced Runtime Policy

FDO now enforces critical policy in the plugin runtime bootstrap (host side), not only in SDK helper code:

- capability gate for privileged module access (`sudo.prompt` required for `@expo/sudo-prompt` and `child_process`)
- write-path boundary: plugin writes are allowed only under `PLUGIN_HOME`
- writes to `PLUGIN_CODE_HOME` are blocked at runtime
- network access is deny-by-default and requires base capability + transport capability + matching destination scope
- external privileged filesystem and process operations are host-mediated, scoped, and audited

This reduces risk from plugin-side SDK bypass attempts and keeps signed plugin code immutable while running.

Capability policy is deny-by-default in host runtime:

- if a plugin has no granted capabilities, it receives `[]`
- grants are resolved from plugin registry capability settings
- `FDO_PLUGIN_CAPABILITIES` is treated as an explicit override (primarily for development/testing)

For direct networking, host runtime is the real boundary:

- `system.network` alone does nothing
- `system.network.<transport>` alone does nothing without `system.network`
- `system.network` + transport grant still does nothing without a matching `system.network.scope.<scope-id>`
- both backend and iframe runtime paths enforce this policy before traffic is allowed

This is intended to reduce SSRF-style abuse, unrestricted egress, local network pivoting, and accidental plaintext transport usage from plugins.

## Scoped Operator Tooling

FDO host now supports scoped privileged process execution for operational plugins via:

- base capability: `system.process.exec`
- scoped capability: `system.process.scope.<scope-id>`
- privileged action: `system.process.exec`
- first-slice workflow action: `system.workflow.run` using process-oriented scoped sequences on the same trust model

Authoring guidance should describe this as broad capability plus narrow scope, with the closest operator fixture under `examples/fixtures/` as the default starting point.

This is the supported host-side pattern for:

- Docker Desktop-like plugins
- Kubernetes dashboards / operator consoles
- Helm managers
- Terraform or similar infrastructure consoles

Important constraint:

- this is not generic shell access
- FDO must not expose unrestricted `system.shell.exec`
- new tools should be added as explicit host scope policies with executable allowlists, cwd restrictions, env allowlists, timeout ceilings, and confirmation policy
- editor diagnostics and AI guidance should steer plugin authors toward this scoped model instead of raw shell spawning
- curated SDK operator presets are an authoring convenience only; host capability checks and scope policy enforcement remain the real security boundary
- curated helper guidance should be presented before transport-level troubleshooting whenever a curated preset exists
- multi-step operator workflows should remain scoped, auditable, and host-mediated, with per-step typed results and preserved step correlation IDs

Practical note for diagnostics tooling:

- host fallback scopes may allow utilities such as `ping` under `system.process.scope.network-diagnostics`
- this is allowed because `ping` is a narrow, operator-facing diagnostics command for reachability troubleshooting
- this is still host-mediated process execution, with allowlisted binaries, cwd/env restrictions, timeout ceilings, and confirmation policy
- it must not be interpreted as blanket permission for plugin code to open arbitrary sockets or bypass transport-specific network capabilities

Plugin diagnostics UX should prefer the SDK Plugin Doctor model:

- raw diagnostics still come from the plugin `UI_MESSAGE` handler `__sdk.getDiagnostics`
- the host should build `createPluginDoctorReport(diagnostics, options?)` and then `createPluginDoctorPanelModel(report, options?)`
- host diagnostics UI should render from panel model fields (`prioritizedFindings`, `sections`, `blocking`, normalized counts/status) without host-side severity/category sorting logic
- raw diagnostics remain the underlying transport/debug payload and should still be available as a legacy fallback when the installed SDK does not expose Plugin Doctor yet

## Handshake Compatibility Policy

Host compatibility gating must be sourced from SDK contract helpers, not duplicated host logic:

- read plugin handshake payload from `__sdk.getDiagnostics` before enabling advanced host UX paths
- evaluate with `evaluateSdkHandshakeCompatibility(handshake, expectations)` where expectations include:
  - `expectedContractVersion`
  - `expectedApiVersion`
  - `expectedCapabilitySchemaVersion`
  - `requiredFeatureFlags`
- optional fast gate checks may use `isSdkHandshakeCompatible(...)` for boolean allow/deny decisions
- diagnostics presentation should pass the same `handshake` expectations into `createPluginDoctorReport(...)`

Status handling policy:

- `compatible`: enable full host UX path
- `needs-attention`: keep fallback behavior enabled and surface warnings
- `incompatible`: block incompatible path and surface code-specific remediation

Handshake findings must render code-specific fixes via:

- `getDiagnosticFixTemplate(code)`
- `formatDiagnosticExactFix(code)`

so users get exact remediation text instead of generic runtime errors.

## SDK Upgrade Rollout Policy

For every SDK/FDO rollout, migration and compatibility gating stay coupled:

1. Run migration dry-run and apply as needed:
   - `fdo sdk migrate --target <path>`
   - `fdo sdk migrate --target <path> --write`
2. Update host handshake expectations in the same PR as SDK version bump.
3. Require handshake compatibility checks in CI before release.
4. Treat contract or API major mismatch findings as release blockers.
5. Document capability schema and required feature-flag changes in release notes with migration guidance.

## Residual Risk

FDO still reads bundled SDK files from the installed app for host tooling. That is acceptable, but it means:

- FDO must adapt when the packaged SDK layout changes
- those reads should stay in backend/host code paths
- they must not become implied plugin authoring contracts
