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
- external privileged filesystem and process operations are host-mediated, scoped, and audited

This reduces risk from plugin-side SDK bypass attempts and keeps signed plugin code immutable while running.

Capability policy is deny-by-default in host runtime:

- if a plugin has no granted capabilities, it receives `[]`
- grants are resolved from plugin registry capability settings
- `FDO_PLUGIN_CAPABILITIES` is treated as an explicit override (primarily for development/testing)

## Scoped Operator Tooling

FDO host now supports scoped privileged process execution for operational plugins via:

- base capability: `system.process.exec`
- scoped capability: `system.process.scope.<scope-id>`
- privileged action: `system.process.exec`

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

## Residual Risk

FDO still reads bundled SDK files from the installed app for host tooling. That is acceptable, but it means:

- FDO must adapt when the packaged SDK layout changes
- those reads should stay in backend/host code paths
- they must not become implied plugin authoring contracts
