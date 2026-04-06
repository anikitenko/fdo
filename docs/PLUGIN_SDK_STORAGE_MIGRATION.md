# Plugin SDK Storage Migration

## Why This Change Exists
FDO now treats signed plugin code directories as read-only at runtime.
This protects signature integrity and avoids accidental mutation of shipped plugin files.

## Runtime Paths
- `PLUGIN_CODE_HOME`: read-only plugin assets and bundled code (signed content).
- `PLUGIN_HOME`: writable runtime data directory (`<userData>/plugin-data/<plugin-id>`).

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
