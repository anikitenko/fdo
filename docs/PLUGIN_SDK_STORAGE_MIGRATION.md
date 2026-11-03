# Plugin SDK Storage Migration

## Why This Change Exists
FDO now treats signed plugin code directories as read-only at runtime.
This protects signature integrity and avoids accidental mutation of shipped plugin files.

## Runtime Paths
- `PLUGIN_CODE_HOME`: read-only plugin assets and bundled code (signed content).
- `PLUGIN_HOME`: writable runtime data directory (`<userData>/plugin-data/<plugin-id>`).
- `HOME`, profile/config/cache paths and temp directories now point into
  `PLUGIN_HOME`; they do not refer to the operator's desktop home.

## Read Access And Credentials

Installed-plugin workers can read their own code/assets, runtime data, generated
bundle, and bundled runtime dependencies. Reads of other plugins' directories,
FDO settings, `~/.aws`, `~/.ssh`, and other files outside these roots are denied
by the runtime API guards, including reads through symlinks and module imports.
Glob and recursive directory reads are unavailable; use non-recursive `readdir`
and check each directory through the normal APIs.

Host shell variables, API keys, cloud credentials and SSH agent sockets are no
longer inherited. Configure credentials through FDO's host services and request
the corresponding SDK secrets/profile/tool capabilities. Use scoped host tools
for CLI access instead of reading desktop CLI login caches directly. Configuration
and secrets deliberately supplied to a plugin remain accessible to that plugin.

These controls require trusted plugin authors; see the
[trust boundary](../SECURITY.md#plugin-trust-boundary). They are not an OS sandbox.

## Required Migration For Plugin Authors
1. Move all writable state from `PLUGIN_CODE_HOME` into `PLUGIN_HOME`.
2. Keep templates/static assets in `PLUGIN_CODE_HOME`.
3. Do not write logs/cache/snapshots/temp files under `PLUGIN_CODE_HOME`.

## Example
```js
import path from "node:path";
import fs from "node:fs";

const writableStateDir = process.env.PLUGIN_HOME;
const staticAssetsDir = process.env.PLUGIN_CODE_HOME;

const cacheFile = path.join(writableStateDir, "cache.json");
if (!fs.existsSync(writableStateDir)) {
  fs.mkdirSync(writableStateDir, { recursive: true });
}
fs.writeFileSync(cacheFile, JSON.stringify({ updatedAt: Date.now() }));
```

## Development Diagnostics
In development mode, FDO now emits a warning notification if plugin files under
`PLUGIN_CODE_HOME` are modified while the plugin is running.
