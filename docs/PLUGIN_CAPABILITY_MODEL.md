# Plugin Capability Model

This host uses a deny-by-default capability model for plugins.

## Source Of Truth

Capabilities are defined in:

- `src/utils/pluginCapabilities.js`

That file is the single place to extend:

- known capability names
- capability descriptions
- host runtime grants (for example: privileged modules)

## Runtime Enforcement

Host runtime policy is generated from granted capabilities and injected into plugin bootstrap:

- `blockedModules` is computed from non-granted capability grants
- plugin runtime denies imports listed in `blockedModules`
- writes are still restricted to `PLUGIN_HOME` regardless of capability grants

Privileged host actions are transported via reserved UI message handler:

- handler: `__host.privilegedAction`
- payload: `{ correlationId, request }`
- response: stable payload containing `correlationId`, `success`, and either result or structured error

Current supported host action:

- `system.hosts.write` (host-mediated `/etc/hosts` tagged section updates only)
- `system.fs.mutate` (host-mediated scoped filesystem mutations)
- `system.process.exec` (host-mediated scoped process execution for approved operational tools only)

Scope policy registry (single source of truth):

- `src/utils/privilegedFsScopeRegistry.js`
- `src/utils/privilegedProcessScopeRegistry.js`
- maps `scope` -> allowed roots/commands, operation types or process policy, and confirmation policy
- capability requirement for scoped mutate:
  - `system.hosts.write`
  - `system.fs.scope.<scope-id>`
- capability requirement for scoped process execution:
  - `system.process.exec`
  - `system.process.scope.<scope-id>`

Supported process scope pattern is intended for operator-style plugins such as:

- Docker Desktop-like plugins
- Kubernetes dashboards / cluster consoles
- Helm managers
- Terraform or similar infrastructure/operator consoles
- Ansible automation panels
- AWS CLI / cloud operations dashboards
- Google Cloud / Azure operator consoles
- Podman, Kustomize, GitHub CLI, Git, Vault, and Nomad workflows
- similar operational dashboards that need approved external tools

## Manage Plugins UX Mapping

In **Manage Plugins -> Capabilities & Privileged Access**, capability toggles are shown as user-facing permissions:

- `Allow privileged host actions` -> `system.hosts.write`
- `Allow scoped filesystem changes (<scope-id>)` -> `system.fs.scope.<scope-id>`
- `Allow Scoped Tool Execution` -> `system.process.exec`
- `Docker CLI Scope` / `kubectl Scope` / `Helm Scope` / `Terraform Scope` -> known `system.process.scope.<scope-id>`
- `Process Scope: <scope-id>` -> fallback for custom `system.process.scope.<scope-id>`

Behavior:

- scoped filesystem toggles are disabled until base privileged access is enabled
- disabling base privileged access removes all `system.fs.scope.*` grants
- scoped process toggles are disabled until process execution base access is enabled
- disabling `system.process.exec` removes all `system.process.scope.*` grants
- capability changes are persisted via host IPC `setCapabilities(...)` and then enforced by host runtime checks

## Monaco Diagnostics

Editor-side diagnostics now surface capability and deprecation hints while coding:

- missing `system.hosts.write` when privileged host actions are detected
- missing `system.fs.scope.<scope-id>` when scoped mutate usage is detected
- deprecated legacy privileged channel/action patterns

These are editor UX markers only. Host-side enforcement remains authoritative.

## How To Add A New Capability

1. Add capability definition to `PLUGIN_CAPABILITY_DEFINITIONS` in `src/utils/pluginCapabilities.js`.
2. If needed, add host runtime grants (for example, `grants.modules`).
3. Persist plugin-level capability grants in plugin registry records (`capabilities`).
4. Add tests:
   - capability normalization/resolution tests
   - runtime policy test for granted vs not granted behavior
5. Update SDK contract (`../fdo-sdk`) for the new capability type and validation rules.

## Best-Practice Defaults

- Keep deny-by-default (`[]`) as the default.
- Grant capabilities explicitly per plugin.
- Explain operator execution as broad capability plus narrow scope: `system.process.exec` + `system.process.scope.<scope-id>`.
- First-slice shared workflows (`system.workflow.run` using `process-sequence`) should reuse that same capability pair rather than introducing a separate broad workflow capability.
- Start operator authoring from the closest fixture under `examples/fixtures/`.
- For known operator tool families, prefer SDK presets such as `createOperatorToolCapabilityPreset("terraform")`.
- For known operator tool families, prefer `createOperatorToolActionRequest(...)` and `requestOperatorTool(...)` before low-level request building.
- For custom process scopes, prefer `createProcessCapabilityBundle("internal-runner")`, `createProcessScopeCapability("internal-runner")`, and `requestScopedProcessExec("internal-runner", ...)`.
- For scoped filesystem mutation, prefer `createFilesystemCapabilityBundle("etc-hosts")`.
- Treat `FDO_PLUGIN_CAPABILITIES` as development/testing override only.
- Do not add generic `system.shell.exec` or unrestricted process execution.
- New operator tools should be added as scoped host policies, not broad shell access.
- AI assistants should recommend scoped host-mediated execution (`system.process.exec` + `system.process.scope.<scope-id>`) instead of raw shell spawning from plugin code.
- For known DevOps/SRE tool families, AI assistants should prefer curated SDK helpers such as `requestOperatorTool(...)` and `createOperatorToolCapabilityPreset(...)`.
- For unknown or internal tools, AI assistants should prefer generic scoped helpers such as `requestScopedProcessExec(...)`, backed by `createProcessCapabilityBundle(...)` and `createProcessScopeCapability(...)`.
- For capability-denied handling, AI assistants should prefer structured SDK diagnostics such as `parseMissingCapabilityError(...)` and `describeCapability(...)`.
- For multi-step host-mediated process orchestration, AI assistants should prefer `createScopedWorkflowRequest(...)` and `requestScopedWorkflow(...)` over plugin-private chaining.
