# Process Scope Policy Versioning

## Purpose

Process scope policies are host-enforced security controls for `system.process.exec` + `system.process.scope.<scope-id>`.
They are versioned so policy schema changes can be rolled out safely without breaking existing plugin scope records.

## Current Version

- `policyVersion` on each custom/shared process scope: `1`
- `argumentPolicy.version` inside scope argument policy: `1`

If these fields are missing in older records, host normalization defaults them to `1`.

## Where It Is Configured

- Shared scopes:
  Settings -> Shared Process Scopes
- Plugin-owned scopes:
  Manage Plugins -> Plugin-Specific Process Scopes

Both editors support first-arg policy controls:

- Allowed subcommands
- Blocked subcommands
- Allowed leading options
- Path-restricted leading options

Validation rule:

- every token in `pathRestrictedLeadingOptions` must also exist in `allowedLeadingOptions`

## Security Model

`pathRestrictedLeadingOptions` marks options that carry filesystem paths (for example `git -C`, `terraform -chdir`).

For these options, host validation enforces:

1. option is allowed by scope argument policy
2. option value is an absolute path
3. option value is under `allowedCwdRoots`

The host returns structured violation metadata (`scopeViolation.reason`, `argument`, `argumentPath`, `pathSource`) so UI actions are reason-driven (not text parsing).

## Compatibility and Migration

- Existing scopes without `policyVersion` or `argumentPolicy.version` are treated as version `1`.
- Existing advanced policy modes (for example `first-arg-by-executable`) are preserved in editors unless the user explicitly sets first-arg policy fields.
- Runtime additive overrides remain additive and are merged onto effective policy during scope resolution.

## Test Coverage

Updated tests validating versioning + policy wiring:

- `tests/unit/plugin-ipc-capability-settings.test.js`
  - built-in scopes expose `argumentPolicy.version`
  - plugin/shared scope upsert persists `policyVersion` + `argumentPolicy.version`
- `tests/unit/host-privileged-actions.test.js`
  - structured scope violation payloads for argument/path/cwd policy failures
- `tests/components/Home.capability-denied-flow.test.jsx`
  - reason-driven remediation actions (`Allow This Argument` vs `Allow This Directory`)
- `tests/components/ManagePluginsDialog.capabilities.test.jsx`
  - plugin scope editor exposes argument policy controls
