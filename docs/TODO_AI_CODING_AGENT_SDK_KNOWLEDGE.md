# TODO: AI Coding Agent SDK Knowledge

## Goal

Make the Editor AI Coding Agent use the bundled `@anikitenko/fdo-sdk` as the runtime source of truth for FDO plugin help, scaffolding, and code generation.

This must be:
- local-first
- packaged-safe
- version-correct for the installed FDO build
- test-covered

## Why local bundled SDK wins

- GitHub can drift from the installed FDO version.
- The packaged app already ships `node_modules/@anikitenko/fdo-sdk`.
- App Store / Microsoft Store builds should not depend on live network lookups for core coding assistance.

## Phase 1

- [x] Build a local SDK knowledge index from bundled SDK files
- [x] Expose IPC retrieval for relevant SDK chunks
- [x] Replace dead “load all sdk types” prompt stuffing with focused per-request retrieval in Editor AI Coding Agent
- [x] Cover chunking/search logic with unit tests

## Phase 2

- [ ] Add lightweight symbol manifest:
  - exported classes
  - interfaces
  - functions
  - enums
  - high-value lifecycle hooks and DOM helpers
- [ ] Pin exact symbol matches into context before generic chunk search
- [ ] Add ranking boosts for:
  - `FDO_SDK`
  - `FDOInterface`
  - `PluginMetadata`
  - `DOMTable`
  - `DOMInput`
  - `DOMButton`
  - `DOMText`

## Phase 3

- [ ] Add curated packaged docs if available:
  - README
  - CHANGELOG
  - migration notes
  - examples
- [ ] Build task-specific retrieval profiles:
  - scaffold / plan
  - edit / fix
  - explain
- [ ] Add token budgeting so SDK knowledge never crowds out current file/project context

## Phase 4

- [ ] Add editor e2e that proves AI Coding Agent requests SDK-backed context for common prompts
- [ ] Add packaged-build verification for SDK path resolution
- [ ] Add observability/debug view for “which SDK chunks were attached”

## Product rules

- Runtime knowledge comes from bundled SDK, not GitHub.
- GitHub can still be used at build/release time for validation or fixture refresh.
- Retrieval should be selective, not full-dump prompt stuffing.
- Operator-style plugins are supported through scoped host-mediated execution, not unrestricted shell access.
- Preferred capability model for tool execution:
  - `system.process.exec`
  - `system.process.scope.<scope-id>`
- Explain the pair as broad capability plus narrow scope.
- Treat `examples/fixtures/` as the primary authoring entry point for operator-style plugins.
- AI guidance should recommend scoped Docker/kubectl/Helm/Terraform execution patterns instead of raw shell spawning.
- Prefer the SDK operator-response helpers over ad hoc response-shape checks:
  - `createPrivilegedActionCorrelationId(...)`
  - `isPrivilegedActionSuccessResponse(...)`
  - `isPrivilegedActionErrorResponse(...)`
  - `unwrapPrivilegedActionResponse(...)`
- Prefer curated operator helpers for known DevOps/SRE tool families:
  - `createOperatorToolCapabilityPreset(...)`
  - `createOperatorToolActionRequest(...)`
  - `requestOperatorTool(...)`
- Prefer generic scoped helpers for host-defined/custom tools:
  - `createProcessCapabilityBundle(...)`
  - `createProcessScopeCapability(...)`
  - `requestScopedProcessExec(...)`
- Prefer structured capability and denial helpers:
  - `createCapabilityBundle(...)`
  - `createFilesystemCapabilityBundle(...)`
  - `describeCapability(...)`
  - `parseMissingCapabilityError(...)`
- Prioritize these packaged references for operator-style generation/help:
  - `docs/OPERATOR_PLUGIN_PATTERNS.md`
  - `examples/fixtures/operator-kubernetes-plugin.fixture.ts`
  - `examples/fixtures/operator-terraform-plugin.fixture.ts`
  - `examples/fixtures/operator-custom-tool-plugin.fixture.ts`

## Example: Scoped Process Execution

```ts
const response = await requestOperatorTool("docker-cli", {
  command: "/usr/local/bin/docker",
  args: ["ps", "--format", "json"],
  timeoutMs: 5000,
  dryRun: true,
  reason: "list running containers"
});

if (isPrivilegedActionSuccessResponse(response)) {
  console.log(response.result);
} else if (isPrivilegedActionErrorResponse(response)) {
  console.error(response.code, response.error);
}
```

Requirements:

- requires `system.process.exec`
- requires `system.process.scope.docker-cli`
- host validates executable path, args, cwd, env, and timeout
- prefer `createOperatorToolCapabilityPreset(...)` + `requestOperatorTool(...)` for known tool families such as Docker, kubectl, Helm, Terraform, Ansible, AWS CLI, gcloud, Azure CLI, Podman, Kustomize, GitHub CLI, Git, Vault, and Nomad
- prefer `createProcessCapabilityBundle(...)` + `createProcessScopeCapability(...)` + `requestScopedProcessExec(...)` for unknown or host-specific tool families
- prefer `createFilesystemCapabilityBundle(...)` for scoped filesystem mutation capability setup
- prefer `parseMissingCapabilityError(...)` + `describeCapability(...)` for capability-denied remediation
- prefer `requestPrivilegedAction(...)` over raw `window.createBackendReq("requestPrivilegedAction", ...)` when you need the low-level transport helper
- for serialized `renderOnLoad()` strings, prefer the self-contained `requestPrivilegedAction(...)` helper rather than preset helpers that are less suitable for `.toString()` embedding
