# Plugin version compatibility

For contract versioning, backward compatibility, Live UI and AI policy, see
[Plugin host contract](PLUGIN_HOST_CONTRACT.md).

Declare supported versions in the **plugin's** `package.json`. FDO's own
`package.json` describes the application, not a plugin's support policy.

```json
{
  "name": "team-tools",
  "source": "index.ts",
  "main": "dist/index.cjs",
  "fdo": {
    "compatibility": {
      "fdo": ">=1.0.3 <2.0.0",
      "sdk": ">=1.8.3 <2.0.0",
      "api": "^1.0.0",
      "features": []
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `fdo` | Required semver range of supported FDO application versions. |
| `sdk` | Supported runtime SDK range. Normal FDO builds use the SDK shipped with the host. |
| `api` | Supported host plugin API range, independent of the FDO and SDK package versions. |
| `features` | Required feature names exposed by the SDK handshake, such as `pluginDoctorReport`. These do not grant permissions or certify platform-specific host-service readiness. |

Only declare versions on which the plugin has been verified. A successful build
on today's FDO does not prove that the plugin works on older FDO installations.
For example, `>=1.0.3 <2.0.0` permits FDO 1.0.3 and later 1.x releases, while
`>=1.0.3 <1.1.0` restricts support to the 1.0 release line. Prereleases must be
explicitly included in the range; stable ranges do not opt into beta releases.

## Where versions and default ranges come from

The example above is illustrative; `>=1.0.3 <2.0.0` is not a hardcoded runtime
value. The host supplies the facts used by Live UI and the AI Coding Agent:

| Value | Authoritative source |
| --- | --- |
| FDO application version | FDO's root `package.json.version` |
| Installed SDK version | `@anikitenko/fdo-sdk/package.json.version` from the installed package, not the dependency range or npm's latest tag |
| Runtime API, handshake and capability-schema versions; host feature flags | `contracts/plugin-host.json`, exported through `src/utils/sdk/pluginHostContract.js` |
| Existing plugin support claims | The plugin workspace's `package.json.fdo.compatibility` |

`pluginAuthoringHost()` collects these facts. `workspaceAuthoringContract()`
provides them, the existing declaration and `defaultRequirements` to Live UI over
IPC and to the AI Coding Agent in its host-owned authoring context. UI code and
generated plugins must consume that context rather than copy example versions.

`defaultPluginRequirements(host)` implements a fixed **range policy** using those
version values:

```text
fdo:      >=<host FDO version> < <next FDO major>.0.0
sdk:      >=<installed SDK version> < <next SDK major>.0.0
api:      ^<host API version>
features: []
```

For example, FDO `1.0.3` generates `>=1.0.3 <2.0.0`; FDO `1.2.4` generates
`>=1.2.4 <2.0.0`; FDO `2.1.0` generates `>=2.1.0 <3.0.0`. The upper bound is
a semver policy choice, not evidence that every permitted release was tested.
The API range uses semver caret rules, including their narrower behavior for
`0.x` APIs. Empty required features do not mean the host has no features.

These source imports are bundled when FDO builds. Updating package or contract
source files requires rebuilding and restarting FDO; an installed application
does not poll npm or reload edited JSON files. Live UI reads the connected
host's context automatically. Host protocol versions are explicitly maintained
by FDO developers, not inferred from or incremented with the SDK version; follow
the [contract versioning decision guide](PLUGIN_HOST_CONTRACT.md#when-the-sdk-is-updated-the-decision-guide).

Existing declarations remain the maintainer's support policy when the host
changes. AI must preserve them, use supplied defaults for new declarations, and
never infer older-host support from a successful local build. Adopting new host
defaults for an existing policy requires an explicit maintainer edit in the IDE
or Live UI support editor, followed by rebuilding and redeploying the plugin.

## New builds and existing plugins

New starter projects include requirements for the installed FDO, SDK, and API.
If an older source project has no declaration, building it generates conservative
requirements starting at the build host's FDO and SDK versions and ending before
their next major versions. If only `fdo` is declared, omitted SDK/API requirements
use those conservative defaults. Authors can edit the declaration to express a
wider tested support range, then rebuild and redeploy.

Every FDO-generated CommonJS artifact starts with a versioned compatibility
comment recording the requirements and exact FDO, SDK, and API versions used for
the build. Export retains this comment inside the signed runtime file. Inspection
reads it as data without executing the plugin. Both the package declaration and
compiled requirements are enforced: changing package.json cannot weaken an older
artifact's requirements. Rebuild after changing the support policy.

Import previews and Manage Plugins show the supported FDO range, current
installation, build provenance when available, and specific mismatch reasons.
Incompatible imports are blocked; activation rechecks requirements before
recompilation or starting the plugin process. CLI validation/deployment and
GitOps imports use the same policy.

Older bundles without a declaration or compatibility comment show **Supported
FDO: Not declared**. They remain usable with a warning for backward compatibility;
this is an unknown support range, not a compatibility guarantee. Adding the
declaration above and rebuilding supplies the missing information. Existing
runtime SDK handshake checks still apply to all plugins.

## Editing support in Live UI

Expand the **Supported FDO** / **Build target FDO** section and choose
**Adjust supported versions**. Edit the FDO, SDK and host API semver ranges and
required features. The editor reads the connected host's versions, defaults and
feature flags automatically. **Use current host defaults** updates the ranges
while retaining your required features; it does not test other installations.

When fields are missing, **Add missing support fields** fills them from the host
without replacing existing declarations. A valid plugin `package.json` is
required; create or repair a malformed package in the IDE first.

**Preview support changes** stages a separate metadata-only draft. Review the
package diff and warnings, use Undo/Redo if needed, acknowledge the support claims,
then **Apply to workspace**. Apply or discard any visual code draft before
changing the support policy. Neither previewing nor saving modifies the host
contract or upgrades the SDK.

An explicit range can target another host version. You can save it after review,
but an incompatible current host keeps visual code editing, builds and execution
blocked. The support editor remains available to correct the declaration. A
workspace change does not alter an installed plugin or its compiled manifest;
rebuild and redeploy on a supported host to publish the new policy.

## FDO and SDK releases

FDO pins an exact SDK release in package.json and package-lock.json. The Release
Matrix preflight runs `npm run release:check-sdk` against npm's stable `latest`
tag and blocks packaging when either file does not contain that version. A
registry failure also fails the check; it never silently accepts stale metadata.
Daily Dependabot checks propose SDK updates. Update, test, and commit the exact
SDK version before releasing FDO.

This guarantees the latest stable SDK **at release validation time**. An already
installed FDO release does not silently replace its SDK when npm publishes a new
version; users receive that SDK through a subsequent FDO release.
