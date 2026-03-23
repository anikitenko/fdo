# TODO: Editor Snapshot / Restore Stabilization

## Goal

Make editor startup, first-create snapshotting, restore, and version switching feel stable and deliberate:

- no 1-5 second layout thrash on open
- first plugin create still produces an initial snapshot
- snapshot creation does not visibly freeze or rebuild the whole editor
- restore/switch flows show clear progress without glitching tabs/tree/header
- behavior is covered by automated tests, not only manual clicking

## Current Observations

- Editor startup is materially better after gating on workspace readiness.
- Baseline snapshot creation on first create is restored and covered by tests.
- Snapshot creation no longer drives broad workspace loading, but snapshot switching can still feel visually unstable under heavy restore work.
- Restore now has a stronger interaction-blocking overlay, but the remaining glitch is likely caused by post-restore state churn rather than missing progress UI.
- `node_modules` loading, restore, and workspace init are now separated into different loading channels, but the visible editor shell still needs one more pass to eliminate freeze-like repaint behavior during snapshot switching.

## Completed So Far

- `virtualFS.fs.create(..., { quiet: true })` now supports snapshot creation without driving global `treeLoading`.
- Snapshot toolbar, deploy/save flow, and AI auto-apply use quiet snapshot creation.
- Initial baseline snapshot creation was restored for brand-new editor workspaces.
- Baseline snapshot creation now runs after workspace readiness and initial tab/selection stabilization.
- Snapshot toolbar now exposes dedicated local status feedback for:
  - `Saving snapshot…`
  - `Switching snapshot…`
- Snapshot panel now exposes a localized restore-status row during snapshot switching.
- `node_modules` preload now uses its own `nodeModulesLoading` channel instead of reusing `treeLoading`.
- Snapshot switching now uses a dedicated `restoreLoading` channel instead of reusing `treeLoading`.
- Editor shell restore now shows a localized blocking overlay during snapshot switching.
- Editor tree/tabs now use subtle restore / dependency-loading indicators instead of skeletonizing during snapshot restore.
- Editor tree/tabs now block direct interaction during restore / dependency-loading windows so clicks do not queue up and apply late.
- Delayed tab switching now uses a cancellable animation-frame handoff instead of a hardcoded timeout.
- Snapshot restore now stays busy through the `node_modules` / type-loading tail instead of unlocking early.
- Restore debug HUD and phase markers now exist for local diagnosis of shell/tabs/tree rerender churn.
- Automated tests now cover:
  - baseline snapshot creation on new editor startup
  - reopening without duplicate baseline snapshots
  - quiet snapshot-create notification contract
  - snapshot switch restoring saved tabs/current version while staying busy through `node_modules` completion
  - snapshot toolbar visible create/switch UI states
  - snapshot panel restore-status UI state
  - `nodeModulesLoading` vs `treeLoading` notification contract
  - `restoreLoading` vs `treeLoading` notification contract
  - editor chrome restore/node-modules subtle status UI

## Likely Root Causes

### 1. Snapshot creation is too stateful and synchronous

`virtualFS.fs.create()`:
- traverses all Monaco models
- serializes content
- writes compressed state to localStorage
- emits version/tree notifications immediately

That is probably too much work on the critical render path.

### 2. One loading channel is doing too much

`treeLoading` currently covers:
- workspace initialization
- node_modules preload
- version restore / switching
- possibly snapshot persistence side effects

The UI cannot distinguish:
- "preparing workspace"
- "saving snapshot"
- "switching snapshot"

So it flickers or shows loading in places that should remain stable.

### 3. Snapshot creation likely causes broad UI invalidation

If creating a snapshot emits the same notifications as restore/switch flows, the editor tree/tabs/header may re-render even though the active workspace content did not actually change.

### 4. First-create snapshot policy is implicit

Initial snapshot creation is currently not modeled as a first-class step. It seems to have depended on startup ordering and side effects.

## Production-Grade Direction

### Principle A: snapshot creation must not rebuild the active editor

Creating a snapshot should:
- capture content
- persist metadata/content
- update snapshot history

It should not:
- re-select files
- rebuild tabs
- re-run workspace restore
- re-trigger broad editor loading UI

### Principle B: restore/switch should be explicit and isolated

Switching to a snapshot can legitimately show progress and change active content, but that flow should be separate from simple snapshot creation.

### Principle C: first-create snapshot should be explicit

For a new plugin workspace:
- create workspace
- create initial baseline snapshot exactly once
- do it after workspace content is ready
- avoid replaying full startup UI transitions afterward

### Principle D: loading UX should reflect intent

Use separate states for:
- `workspaceInitializing`
- `snapshotCreating`
- `snapshotSwitching`
- `nodeModulesLoading`

Do not overload one spinner/skeleton for all four.

## Implementation Plan

## Phase 1: Instrument And Confirm

- Add temporary timing logs around:
  - `setupVirtualWorkspace()`
  - `virtualFS.fs.create()`
  - `virtualFS.fs.set()`
  - `setupNodeModules()`
- Measure:
  - cold editor open
  - first plugin create
  - manual snapshot create
  - snapshot switch
- Record which notification bursts fire during each action.

Exit criteria:
- we know exactly whether the 1-5 second churn is dominated by:
  - localStorage compression/persist
  - Monaco model traversal
  - tree notifications
  - restore path

## Phase 2: Separate Snapshot Create From Restore

- Refactor `virtualFS.fs.create()` so snapshot creation only:
  - captures models
  - persists versions
  - emits `treeVersionsUpdate`
- Do not emit:
  - `treeUpdate`
  - `fileSelected`
  - `tabSwitched`
  unless content actually changes
- Keep current editor selection/tab state untouched after snapshot creation.

Exit criteria:
- clicking `Snapshot` does not visibly rebuild the editor surface
- tree/tabs/header remain stable during snapshot creation

Status:
- Largely complete.
- Quiet snapshot creation is implemented and tested.
- `nodeModules` preload no longer reuses `treeLoading`.
- Remaining work is mostly around the last visual freeze/repaint churn during snapshot switching, not snapshot-create coupling.

## Phase 3: Restore Initial Snapshot Policy

- Add explicit first-create baseline snapshot logic for brand-new plugin workspaces.
- Run it only once per new sandbox/workspace.
- Ensure it happens after:
  - workspace files exist
  - initial selected file/tab exists
  - `node_modules` preload is at least kicked off
- Do not block first paint on snapshot toast/history rendering if avoidable.

Exit criteria:
- a brand-new plugin shows one baseline snapshot
- reopening the same workspace does not create duplicates

Status:
- Partially complete.
- Baseline snapshot creation on first create is restored and tested.
- Reopen/no-duplicate coverage is implemented and tested.

## Phase 4: Async Snapshot Persistence

- Move heavy snapshot serialization/compression off the visible UI path as much as possible.
- Candidate approach:
  - capture current in-memory models synchronously
  - defer compression/persist to microtask / idle slice / async boundary
- Keep UI responsive while snapshot is being persisted.

Possible implementation options:
- `queueMicrotask`
- `requestIdleCallback` with fallback
- a dedicated async persist helper

Exit criteria:
- snapshot button reacts immediately
- editor typing/focus/tabs do not visibly hitch during snapshot save

## Phase 5: Separate Loading State Channels

- Introduce separate UI state instead of only `treeLoading`:
  - `workspaceLoading`
  - `snapshotCreating`
  - `snapshotSwitching`
  - `nodeModulesLoading`
- Update UI:
  - full-page loading shell only for initial workspace init
  - small inline spinner/progress for snapshot create
  - stronger blocking state only for snapshot switch

Exit criteria:
- opening editor no longer shows snapshot-side effects as global loading
- creating snapshot does not skeletonize tabs/tree

Status:
- Largely complete.
- Snapshot create no longer uses global `treeLoading`.
- `nodeModulesLoading` is now separated from `treeLoading`.
- `restoreLoading` is now separated from `treeLoading`.
- Editor shell now distinguishes:
  - initial workspace init
  - snapshot switch / restore
  - dependency/type loading
- Remaining work is to further reduce visible rerender churn during restore, not to introduce more loading channels.

## Phase 6: Stabilize Notification Fan-Out

- Audit which components subscribe to:
  - `treeLoading`
  - `treeUpdate`
  - `treeVersionsUpdate`
  - `fileSelected`
  - `fileTabs`
  - `tabSwitched`
- Prevent snapshot creation from sending notifications intended only for restore/switch flows.
- Batch notifications where possible.

Exit criteria:
- snapshot create produces a small predictable notification set
- no redundant rerender storms in:
  - `EditorPage`
  - `FileTabComponent`
  - `FileBrowserComponent`
  - `CodeDeployActions`
  - `SnapshotContext`

## Phase 7: UX Progress And Feedback

- Show a tiny non-blocking "Saving snapshot…" indicator in the snapshot toolbar.
- Show a stronger but localized "Switching snapshot…" state only when applying another version.
- Avoid replacing the entire editor with a loading shell except on true workspace initialization failures.

Exit criteria:
- progress UI matches user intent
- no false perception that the whole editor is reloading during snapshot create

Status:
- Partially complete.
- Added non-blocking toolbar status for save/switch.
- Added panel restore-status row during snapshot switching.
- Added a localized blocking editor-shell overlay for snapshot switching.
- Added subtle non-skeleton status UI in file tree and file tabs.

## Automated Testing

## Unit / State Tests

- `virtualFS.fs.create()`:
  - creates a new version entry
  - updates `version_latest` / `version_current` as intended
  - does not emit restore-only notifications
- initial workspace create:
  - produces exactly one baseline snapshot
  - does not duplicate baseline snapshot on reopen
- snapshot switch:
  - restores saved tabs atomically
  - restores current version correctly

## Notification Contract Tests

- Assert exact notification set for:
  - first workspace create
  - snapshot create
  - snapshot switch
- Fail if snapshot create emits:
  - `treeUpdate`
  - `fileSelected`
  - `tabSwitched`
  unless explicitly intended

## Component Tests

- `EditorPage`:
  - initial loading shell -> stable editor once
  - no empty header/tab on first render
- `SnapshotContext`:
  - creating snapshot toggles local `creating` state without forcing workspace reload
- `CodeDeployActions`:
  - version list updates without unnecessary editor churn

Implemented:
- `tests/components/editor/EditorPage.test.jsx`
- `tests/components/snapshots/SnapshotToolbarActions.test.jsx`
- `tests/components/snapshots/SnapshotPanel.test.jsx`

## Performance / Regression Tests

- Add a lightweight timing harness around:
  - editor open
  - first snapshot create
  - snapshot switch
- Store thresholds for regression checks in test/dev logs.

Implemented:
- restore-tail notification contract coverage in `tests/unit/editor-snapshot-state.test.js`
- editor chrome restore / dependency status UI coverage in `tests/components/editor/EditorChromeStatus.test.jsx`
- localized restore overlay coverage in `tests/components/editor/EditorPage.test.jsx`

## Manual Validation Checklist

### New plugin

1. Create a brand-new plugin.
2. Open editor.
3. Confirm:
   - initial tab exists
   - `node_modules` appears
   - exactly one baseline snapshot exists
   - editor does not visibly thrash for several seconds

### Snapshot create

1. Edit a file.
2. Click `Snapshot`.
3. Confirm:
   - snapshot appears in history
   - tree/tabs/header remain stable
   - no full-page loading shell appears

### Snapshot switch

1. Create two snapshots with different file content/tabs.
2. Switch between them.
3. Confirm:
   - content changes correctly
   - tabs restore correctly
   - progress is visible but localized

### Reopen existing workspace

1. Close and reopen editor for the same sandbox/plugin.
2. Confirm:
   - no duplicate baseline snapshot
   - current version restores correctly
   - startup remains stable

## Next Recommended Steps

1. instrument any remaining editor-model or Monaco view-state churn during snapshot switching to isolate the last visible freeze
2. suppress or coalesce any remaining non-essential post-restore mutations while `restoreLoading` is active
3. decide whether post-restore `nodeModules` tree updates should remain visible or be deferred further
4. remove the temporary restore debug HUD once the last visual glitch is resolved
