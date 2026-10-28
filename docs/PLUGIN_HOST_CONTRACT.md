# Plugin host contract and backward compatibility

`contracts/plugin-host.json` is the host's machine-readable contract definition.
`src/utils/sdk/pluginHostContract.js` exports its runtime values. A version is a
promise about a particular surface, not a copy of the FDO or SDK package version.

The host API, handshake and capability-schema versions are explicitly maintained
in this definition. Live UI and the AI Coding Agent receive them automatically
through the host-owned authoring context; they do not infer them from package
versions. The definition is bundled with FDO and changes take effect after a
rebuild/restart. See [version sources and generated default ranges](PLUGIN_COMPATIBILITY.md#where-versions-and-default-ranges-come-from)
for the complete data flow and the distinction between a dynamic version value
and the fixed semver range policy.

## When the SDK is updated: the decision guide

**Updating the SDK dependency does not, by itself, change any host contract
version.** First identify what changed in the SDK and what FDO must implement.
Edit the affected values in `contracts/plugin-host.json`; the JavaScript exports
are derived from that file. Do not copy the SDK package version into them.

These are illustrative version transitions, not announcements of SDK releases:

| SDK update                                                                                              | What FDO must do                                                                          | Host contract version changes                                                                               |
|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Patch, e.g. `1.8.3 → 1.8.4`: internal SDK fix with unchanged public behavior and wire format            | Pin the SDK, update the lockfile and run regression tests                                 | None: host API, handshake and capability schema stay unchanged                                              |
| Minor, e.g. `1.8.3 → 1.9.0`: new DOM helper or SDK utility using existing host operations               | Validate the installed metadata; add a Live UI adapter if needed; test AI authoring       | None for the runtime protocols; review the SDK's independent authoring contract version                     |
| Minor: SDK adds an optional operation requiring a new host handler                                      | Implement and test the handler, preserve old behavior, advertise an optional feature flag | `apiVersion` minor, e.g. `1.0.0 → 1.1.0`; leave handshake/schema unchanged unless their formats also change |
| Any SDK release: FDO fixes an existing host operation to match its documented contract                  | Fix and test that operation, including old clients                                        | Patch the affected host protocol, e.g. API `1.0.0 → 1.0.1`; unrelated versions stay unchanged               |
| SDK introduces an optional diagnostic handshake field that FDO now supports                             | Keep the field optional for older SDKs                                                    | `contractVersion` minor; no API bump just for optional handshake metadata                                   |
| SDK introduces an optional permission declaration understood by a new host reader                       | Implement explicit negotiation and minimum SDK requirements; never grant it by default    | `capabilitySchemaVersion` minor; also bump API minor if a new runtime operation/feature is introduced       |
| SDK/host removes an operation, changes a result shape, or makes an optional runtime argument mandatory  | Implement a migration; preserve an old-major adapter or reject incompatible plugins       | `apiVersion` major, e.g. `1.4.2 → 2.0.0`                                                                    |
| SDK introduces an incompatible handshake or capability encoding, or a new required protocol field       | Implement a reader/migration and coordinate SDK + host releases                           | Major of the affected protocol; with today's single-major host, also an API major                           |
| SDK major, e.g. `1.9.0 → 2.0.0`, changes public SDK exports/types but keeps the host protocol unchanged | Review affected plugins and SDK ranges; provide compatible plugin builds                  | No automatic host protocol bump. Existing SDK `<2` requirements still block SDK-1-only plugins on SDK 2     |

An SDK **major** release always needs a migration audit, but it is not evidence
that all three host protocols changed. Conversely, an SDK **minor** release does
not authorize FDO to make a breaking host change. Classify the actual affected
surface, not the dependency's version label.

### Exactly what patch, minor and major mean

- **No bump:** SDK-only implementation changes, a host refactor with identical
  behavior, documentation spelling fixes, AI prompt improvements, or Live UI
  editor improvements that do not change a plugin-facing protocol.
- **Patch:** correct the implementation of an existing host contract without
  adding functionality or invalidating previously valid clients. Increment only
  the affected protocol's patch, e.g. `1.0.0 → 1.0.1`.
- **Minor:** add optional, backward-compatible functionality. Existing clients
  must keep working without new fields, new required features or permission
  grants. Increment the affected protocol's minor and reset its patch, e.g.
  `1.0.7 → 1.1.0`.
- **Major:** a previously valid client would need a code, configuration, message
  or permission-policy migration. Increment the affected protocol's major and
  reset minor/patch, e.g. `1.9.4 → 2.0.0`. Calling a change a bug fix does not make
  it a patch if it changes the documented promise.

For example, adding a host API feature can produce this definition:

```json
{
  "apiVersion": "1.1.0",
  "contractVersion": "1.0.0",
  "capabilitySchemaVersion": "1.0.0"
}
```

This is an excerpt, not a replacement for the complete definition. It is correct
only when the handshake and permission formats remain unchanged. A plugin using
the new feature should require API `^1.1.0`, its feature flag, and a tested minimum
FDO/SDK version. A plugin using only old behavior can retain `^1.0.0`. Making the
new flag mandatory for **every** plugin would be breaking and requires API 2.

### SDK-update checklist

1. Pin the exact stable SDK version in FDO's package.json and regenerate
   package-lock.json. Read the SDK changelog and its reported API, handshake,
   capability-schema and authoring-metadata versions; package semver alone is
   insufficient.
2. Compare those surfaces with `contracts/plugin-host.json`. If the SDK only
   adds optional metadata that FDO ignores, keep the host's existing expectation;
   accepting an unknown optional field does not require advertising a new format.
3. Implement required host handlers/readers and Live UI adapters before enabling
   flags or adding supported authoring majors. Check that AI receives the real
   installed capabilities. Unknown authoring majors stay disabled until adapted.
4. Apply the smallest **correct** protocol bump using the rules above. Preserve
   old messages, defaults, feature availability and manifest readers within an
   API major. Never widen plugin support ranges to bypass a failed check.
5. Run `npm run check:host-contract`, `npm run release:check-sdk`,
   `npm run check:dependencies`, `npm run test:ci` and `npm run build`. Also run
   native tests for changed host operations and the affected Live UI/AI flows.
   Passing the JSON evolution check alone does not prove protocol compatibility.
6. Document tested old/new SDK consumers, minimum supported FDO versions and any
   migration. If the host contract definition changed, add its released snapshot
   under `contracts/releases/` when releasing; never edit an older snapshot.

Keeping host API 1 does **not** guarantee that a plugin built against SDK 1 works
with SDK 2. Runtime API compatibility and public SDK compatibility are separate;
both the plugin's `api` and `sdk` requirements must be satisfied.

## Which version changes?

| Surface | Definition field | Patch | Minor | Major |
| --- | --- | --- | --- | --- |
| Runtime messages, initialization and stable behavior | `apiVersion` | Correction preserving documented behavior | Optional API/feature added without changing old behavior | Removal, required arguments, incompatible results or changed stable semantics |
| SDK diagnostic handshake envelope | `contractVersion` | Documentation/validation correction preserving valid messages | Optional metadata understood by tolerant readers | Rename/removal of fields, new required fields, incompatible encoding |
| Permission declarations and negotiation format | `capabilitySchemaVersion` | Nonsemantic correction | Optional additive capability with explicit negotiation | Changed permission meaning, required fields, incompatible format |
| Compiled plugin build manifest | `pluginManifestSchemaVersion` | Integer format version: change only when the format needs a different reader | Keep older entries in `supportedPluginManifestSchemaVersions` | Removing released readers is a breaking host policy change |
| SDK DOM/component/preview metadata | Each published SDK artifact's `contractVersion` | Follow the SDK artifact's own policy | Add supported adapters after reviewing the installed schema | Unknown majors remain unsupported until a dedicated adapter is implemented and tested |

The manifest schema version is an integer, not semver. The table's manifest row
describes reader compatibility, not patch/minor arithmetic.

Changing FDO's application version, pinning a newer SDK, updating the AI prompt,
or improving a Live UI control does **not** automatically bump the runtime API,
handshake or capability schema. This authoring integration leaves those versions
at **1.0.0** because it adds no incompatible plugin wire behavior.

## Rules for host changes

1. Identify the affected surface before editing any version. Do not bump all
   constants together. Record a concrete old/new request or behavior example.
2. Preserve old messages, defaults, results and required permissions within an
   API major. A bug fix that changes documented behavior can still be breaking.
3. New optional host functionality gets an API minor version and a host feature
   flag. Add a flag only after implementing and testing the host integration;
   importing a new SDK package is not evidence that a host adapter exists.
4. New plugins declare their required `api` range, minimum supported FDO/SDK
   range and feature flags in `fdo.compatibility`. Do not infer support for an
   older FDO release from an SDK version or a local successful preview/build.
5. Missing optional functionality returns an explicit unsupported/unavailable
   result or prevents an operation from being offered. Never downgrade to a
   broader permission, arbitrary process execution or a different transport.
6. A breaking API change requires an API major, a migration guide, coordinated
   SDK support and tests. Either maintain an explicit old-major adapter with its
   own tests or reject the older plugin before execution. Raising a constant
   alone does not implement a new protocol.

The current host has one handshake major and one capability-schema major, not
multi-major adapters. Changing either major therefore requires a coordinated
runtime API major. To keep the runtime API major while introducing another
protocol major, implement and test simultaneous readers first and explicitly
revise the release policy. Capability-schema minor/patch differences warn;
unknown or malformed major formats block initialization.

SDK 1.x uses closed capability lists in some paths. Even an additive permission
name therefore needs negotiation and the right minimum SDK/host versions; a
schema minor does not magically make old readers understand it. Feature flags
express availability, never permission grants or platform-specific readiness.

## What backward compatibility means today

- Supported semver requirements are checked before installation and activation.
  Generated artifact requirements and package declarations are both enforced.
- SDK/handshake API majors are checked before plugin initialization. Unknown
  handshake majors and malformed version claims are rejected. Older SDK bare
  major aliases such as `"1"` remain understood; new code publishes full semver.
- Legacy plugins without a handshake or support declaration remain usable with
  explicit warnings. That is an unknown support range, not a compatibility
  guarantee. A legacy exception does not disable permissions or signatures.
- Older plugins on the same supported API major keep optional behavior. Newer
  plugins cannot assume that older hosts have newly added methods or features.
- Old build-manifest readers remain registered within the same API major.
  Unknown manifest formats fail closed. Schema adapters must migrate data, never
  execute plugin code to inspect it.
- Supported authoring metadata majors are separate from runtime API majors.
  Live UI's preview is static; it does not execute or certify plugin backends.

## Live UI and the AI Coding Agent

Both tools show the installed FDO, SDK, runtime API, handshake and capability
schema alongside the workspace's supported FDO range. A missing declaration is
shown as a **build target**, not a claim that old releases were tested.

Live UI can retain a read-only preview of an incompatible target, but the host
rejects visual code proposals, apply requests and commit authorization. Source
navigation and AI-assisted diagnosis remain available. The IDE still validates
types and builds a detached candidate before committing a supported visual edit.

The expandable target panel also offers a separate **Adjust supported versions**
editor and **Add missing support fields** action. Versions, default ranges and
available features come from the connected host's contract, not UI constants.
Adding missing fields preserves existing declarations; adopting current host
defaults is an explicit action. Required features remain selected when changing
version defaults.

Support changes use their own draft, diff, Undo/Redo and recovery flow. Apply
requires the maintainer's acknowledgement of the support claims. Both host and
IDE verify that only `package.json.fdo.compatibility` changes; code, dependencies,
scripts and other package metadata cannot use this path. A declaration-only edit
does not need a code build and can repair an incompatible target. It may also
save a deliberate future target; visual editing, builds and execution remain
blocked when the current host does not satisfy it. Saving a range neither proves
compatibility nor updates an installed plugin: rebuild and redeploy separately.

AI requests receive the host-owned contract and support policy. Generated package
changes are checked both during staged generation and when validating the final
merged workspace. AI cannot remove compatibility requirements, silently retarget
existing ranges or remove required features to make a build pass. A maintainer
reviews target changes, edits package.json in the IDE or uses Live UI's reviewed
support editor, and starts a new request
against that baseline. This is deliberate: automatic repair is not evidence of
backward compatibility.

Draft/checkpoint fingerprints include the host identity and contract as well as
SDK metadata. Changes invalidate recovery rather than replaying old edits under
a different contract. Unknown authoring majors remain unavailable to adapters.

## Release review and evidence

`npm run check:host-contract` compares the current definition with immutable
released baselines under `contracts/releases/`. CI and release packaging run it.
Within an API major it prevents removing stable flags, making optional SDK flags
mandatory, dropping a released manifest reader or downgrading protocol versions.
New optional feature flags require at least an API minor bump.

Keep released baseline files immutable; add a new snapshot for each released
contract. Changes to runtime message implementations still require semantic
review and behavior tests: a JSON comparison cannot detect a changed return
value, weakened permission enforcement or a broken adapter.

Required evidence for a contract change:

- Replay representative old handshake and manifest fixtures, including legacy
  aliases, on the new host. Test rejection of unknown majors/malformed messages.
- Exercise the actual changed operation with old and new SDK consumers. Include
  denial, cancellation and missing-feature paths; never rely on version labels
  alone as a protocol conformance test.
- Test Live UI/AI constraints and recovery when authoring contracts change.
- Document migration, default behavior and minimum FDO/SDK requirements.

FDO's release SDK freshness gate remains independent: it verifies the exact
stable SDK package at release validation time, not runtime protocol compatibility.
See [plugin declarations and examples](PLUGIN_COMPATIBILITY.md).
