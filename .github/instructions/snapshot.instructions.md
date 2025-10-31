---
applyTo: '**'
---

## Snapshot architecture and data model

- Location
  - Implemented in VirtualFS.js under `virtualFS.fs`.
- Core data structure
  - `fs.versions`: object keyed by a human-readable version id (two-word adjective-color, e.g., “brave-aquamarine”).
  - Each snapshot entry: `{ version, date, prev, tabs, content }`
    - `version`: snapshot id (string)
    - `date`: ISO timestamp
    - `prev`: previous version id passed at creation time (used for “from <prev>” in UI)
    - `tabs`: list of open tabs at snapshot time, e.g. `[{ id, active }]` excluding “Untitled”
    - `content`: array of files for the snapshot `[{ id, content, state }]`
      - `id`: file path (e.g. “/index.ts”)
      - `content`: full file contents at the time of snapshot
      - `state`: currently always `null` on snapshot; the system doesn’t persist Monaco view state into snapshots
  - `fs.version_latest`: latest snapshot id (string)
  - `fs.version_current`: currently active snapshot id (string)

## Persistence and lifecycle

- Storage
  - Snapshots are persisted to `localStorage` under key `virtualFS.sandboxName` (set by `setupVirtualWorkspace` as `sandbox_<plugin-id>`), compressed via `LZString`.
  - On create:
    - Reads existing persisted FS if present, clones-in the new snapshot, updates `version_latest` and `version_current`, writes back to `localStorage`.
    - If no persisted FS exists, creates a minimal FS object with the new version and persists it.
- Restore on startup
  - `setupVirtualWorkspace(name, displayName, template, dir)` sets up the workspace and:
    - If sandbox exists in `localStorage`: `virtualFS.restoreSandbox()` merges persisted `fs` and calls `fs.set(version_current)`, rebuilding models.
    - Else (new sandbox): creates initial files and immediately calls `virtualFS.fs.create()` to seed the first snapshot.
- Cleanup
  - “Save & Close” (`CodeDeployActions -> triggerSaveAndClose`) removes snapshots for the plugin: `localStorage.removeItem("sandbox_" + name)`.
  - “Clean” in Manage Plugins (not removal): also deletes all snapshots via `localStorage.removeItem("sandbox_" + plugin.id)` with a warning “All snapshots will be deleted. Make sure to save plugin first.”

## Snapshot creation flow

- UI entry point
  - “1. Create snapshot” button in `sCodeDeployActions.js -> saveAll()`.
- Behavior
  - Calls `virtualFS.fs.create(prevVersion, tabs)` where:
    - `prevVersion` is the currently active snapshot id.
    - `tabs` is the current open tabs (excluding “Untitled”), with `active` flag preserved.
  - Internals of `fs.create()`:
    - Sets loading, collects all Monaco models that aren’t under node_modules or dist (full contents only), assigns a human-readable snapshot name and ISO date, writes to memory and `localStorage`, emits `treeVersionsUpdate`, and clears loading.
  - Returns `{ version, date, prev }`.
  - The UI immediately switches to this new snapshot via `handleSwitchFsVersion(newVersion)`.

## Snapshot switching / restoration

- UI entry point
  - “Snapshots” `<Select>` in `CodeDeployActions`, calls `setFsVersion(ver)` which opens an Alert, then `handleConfirmSwitch()` calls `handleSwitchFsVersion(ver)`.
- Behavior
  - `virtualFS.fs.set(version)`:
    - Emits loading, disposes current models and removes extra libs, clears `virtualFS.files`.
    - Resets the tree to root, recreates all files/models from the target snapshot’s `content`.
    - Re-populates TypeScript defaults, re-adds node_modules typings via `fs.setupNodeModules()`.
    - Updates `version_current` and persists that into `localStorage`.
    - Emits:
      - `treeUpdate` with the fresh tree,
      - `fileSelected` with the current selected node (root defaults to plugin name),
      - `treeVersionsUpdate` for the version list.
    - Clears loading and returns `{ tabs }` saved with the snapshot.
  - The UI restores tabs via `virtualFS.tabs.addMultiple(data.tabs)` (keeps `active` states).

Notes on state:
- Monaco editor view state (cursor/scroll/selection) is not captured in snapshots. `fs.create()` always sets `state: null` per file. `fs.set()` assigns `state` from the snapshot to `virtualFS.files[file].state`, and EditorPage.jsx restores from `virtualFS.getModelState(file.id)` upon tab changes, but because snapshot `state` is null, positions do not restore across snapshot switches.

## UI and UX specifics

- Versions list
  - Derived from `fs.list()` which returns `Object.keys(fs.versions).map(...)`; not explicitly sorted. UI displays:
    - version name,
    - “from <prev>” (if prev present),
    - “(x time ago)” using `date-fns/formatDistanceToNow`, refreshed every 20s via a timer.
- Safety confirmation
  - When switching snapshots, an Alert warns: “Make sure to create snapshot before switching... Unsaved changes will be discard. Proceed?”
- Close/reload confirmations (related safeguard)
  - EditorPage.jsx intercepts window close/reload via preload IPC and warns: “Changes will be discarded unless a snapshot is created!”. If confirmed, `window.electron.system.confirmEditorCloseApproved()` or `confirmEditorReloadApproved()` is called.
  - Spec spec.md details reliability requirements and timeout behavior; this doesn’t change snapshot logic, but ties the UX together.

## Eventing and async behavior

- Notifications bus
  - `virtualFS.notifications` provides: `subscribe(event)`, `addToQueue(eventType, data)`, and a queued dispatcher that processes one event at a time with a 50ms delay, ensuring order and reducing cascaded re-render churn.
- Typical events involved in snapshots
  - `treeVersionsUpdate` (versions list)
  - `treeLoading` (loading indicator)
  - `treeUpdate` (FS tree changes)
  - `fileSelected` (selection changes)
  - `fileTabs`, `tabSwitched`, `tabClosed` (tabs)
- Build/deploy/save flows
  - Build uses `virtualFS.build` (status + content); deploy/save use IPC with `window.electron.plugin.*` and can require certificate selection.

## Integration boundaries

- Monaco Editor
  - Models are created/disposed around snapshot switching; TS extra libs updated accordingly.
- IPC to main
  - For deploy/save; not used directly for snapshot create/switch (purely renderer-local with `localStorage`).
- Persistence
  - `localStorage` + `LZString`, with key: `sandbox_<plugin-id>`.

## Edge cases and limitations

- What’s captured
  - Full file contents for all non-node_modules and non-dist files, and the list of tabs with `active` flags.
  - Monaco view state is not captured in snapshots.
- Order of versions
  - Not explicitly sorted; relies on object key iteration order (which can be insertion order but isn’t guaranteed to be meaningful to users). UI shows the `current` flag correctly.
- Storage limits
  - All snapshots live in `localStorage`. Large projects or many snapshots may hit browser `localStorage` quotas (typically 5–10 MB per origin). No quota detection or user feedback is implemented.
- Space efficiency
  - No deduping—each snapshot stores full contents for all files (except node_modules/dist). This can balloon storage quickly.
- Deletion granularity
  - There’s no API/UI to delete an individual snapshot. Users can only wipe all snapshots via “Clean” or “Save & Close”.
- Untitled buffer
  - “Untitled” is excluded from snapshot tabs. That’s intentional and avoids storing ephemeral temp buffers.
- Error handling
  - `localStorage` writes and `LZString` parsing aren’t wrapped in try/catch; failures would throw.

## Likely user pain points (based on code)

- Can’t delete a single snapshot or rename it; it’s all-or-nothing cleanup.
- Versions list can feel unordered for users; no date-sort by default.
- Snapshot switching doesn’t restore editor cursor/scroll (view state), which can feel jarring.
- Potential for silent failures when `localStorage` quota is exceeded.
- No automatic snapshot; users have to explicitly click “Create snapshot” (other than the initial auto snapshot on workspace creation).

## Small, low-risk improvements

- Sort versions by date (newest first) in `fs.__list()` before emitting; improves UX with minimal code.
- Capture Monaco view state in snapshots:
  - When creating, store `state: monaco.editor.saveViewState()` for the active file(s) instead of `null`.
  - On `fs.set()`, after creating models, associate and emit a selection so EditorPage.jsx restores from `virtualFS.getModelState(file.id)`.
- Quota handling
  - Wrap `localStorage` reads/writes with try/catch and surface a notification if snapshot persistence fails due to size.
- Provide single-snapshot deletion
  - Add `fs.delete(version)` to remove an entry from `versions` and update persisted data, then emit `treeVersionsUpdate`.
- Clarify “Unsaved changes will be discard” message to correct grammar (“discarded”).

If you want, I can implement the sorted versions list and add basic quota-safe persistence in a small patch next.

## Quick reference: key files and functions

- VirtualFS.js
  - `fs.create(prevVersion, tabs)` — creates snapshot
  - `fs.set(version)` — applies snapshot (restores files/models and returns `{ tabs }`)
  - `fs.list()` / `fs.version()` — versions and current version info
  - `notifications.*` — event queue/dispatch
- CodeDeployActions.js
  - Snapshot UI (list, create, switch confirmation), build/deploy/save actions
- setupVirtualWorkspace.js
  - Workspace init, sandbox restore, initial snapshot creation
- ManagePluginsDialog.jsx
  - “Clean” removes all snapshots in local storage
- EditorPage.jsx
  - Close/reload confirmation UX; tab switching, selection, view state restore (if present in `virtualFS`)