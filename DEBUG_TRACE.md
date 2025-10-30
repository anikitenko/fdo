# Debug Trace Instructions

## What to do:

1. Open the browser DevTools Console
2. Clear the console
3. Perform ONE of these actions:
   - **Test A**: Open the editor window (initial load)
   - **Test B**: Switch between snapshots

4. Copy ALL console logs and paste them here

## What we're looking for:

### Initial Load Issues:
- When does `[VirtualFS] UI notifications SUPPRESSED` appear?
- When does `[VirtualFS] Opening tabs (initial load)` appear?
- When does `[VirtualFS] Initial load complete` appear?
- Are there `treeLoading: true` or `treeLoading: false` logs?
- When does the skeleton actually appear/disappear in the UI?

### Version Switch Issues:
- When does `[CodeDeployActions] Starting version switch` appear?
- When does `[CodeDeployActions] Adding tabs to UI` appear?
- When does `[CodeDeployActions] Emitting UI notifications` appear?
- When does `[CodeDeployActions] UI update complete` appear?
- When does the file get selected in the tree?
- When does the skeleton reappear (if it does)?

## Please paste the console logs below:

```
[VirtualFS] Restoring sandbox from localStorage: Object
VirtualFS.js:1335 [VirtualFS] Starting initial load...
VirtualFS.js:319 [VirtualFS.setLoading] CALLED - this.loading: false → true
VirtualFS.js:323 [VirtualFS.setLoading] Emitted treeLoading: true
VirtualFS.js:703 [VirtualFS] UI notifications SUPPRESSED during restoration (initial load)
VirtualFS.js:722 [VirtualFS] Storage estimate raw: Object
VirtualFS.js:817 [VirtualFS] Starting restoration of 3 files...
VirtualFS.js:845 [VirtualFS] Restored 1/3: /index.ts (0.3ms)
console.js:28 14:23:32.151 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.multiWindowSync.complete Object
console.js:28 14:23:32.206 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.restore.start Object
VirtualFS.js:845 [VirtualFS] Restored 2/3: /render.tsx (0.2ms)
VirtualFS.js:845 [VirtualFS] Restored 3/3: /package.json (0.3ms)
VirtualFS.js:858 [VirtualFS] All 3 files restored, deferring TypeScript setup...
VirtualFS.js:885 [VirtualFS] treeVersionsUpdate emitted, heavy notifications deferred
VirtualFS.js:907 [VirtualFS] UI notifications RE-ENABLED
VirtualFS.js:909 [VirtualFS] TypeScript diagnostics deferred until after rendering...
VirtualFS.js:919 [VirtualFS] Opening tabs (initial load)...
VirtualFS.js:926 [VirtualFS] Emitting notifications (initial load)...
VirtualFS.js:1340 [VirtualFS] Sandbox restored successfully
console.js:28 14:23:32.244 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.restore.complete Object
console.js:28 14:23:32.248 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.multiWindowSync.complete Object
VirtualFS.js:326 [VirtualFS.stopLoading] CALLED - this.loading: true → false
VirtualFS.js:330 [VirtualFS.stopLoading] Emitted treeLoading: false
VirtualFS.js:937 [VirtualFS] Initial load complete
VirtualFS.js:913 [VirtualFS] Setting up node modules...
VirtualFS.js:915 [VirtualFS] Node modules ready
VirtualFS.js:680 [VirtualFS] Re-enabling TypeScript diagnostics NOW...
VirtualFS.js:686 [VirtualFS] TypeScript diagnostics fully enabled
[CodeDeployActions] Starting version switch...
VirtualFS.js:319 [VirtualFS.setLoading] CALLED - this.loading: false → true
VirtualFS.js:323 [VirtualFS.setLoading] Emitted treeLoading: true
VirtualFS.js:703 [VirtualFS] UI notifications SUPPRESSED during restoration (version switch)
VirtualFS.js:722 [VirtualFS] Storage estimate raw: {quota: 330274549760, usage: 0, usageDetails: {…}}
VirtualFS.js:817 [VirtualFS] Starting restoration of 3 files...
VirtualFS.js:845 [VirtualFS] Restored 1/3: /index.ts (1.6ms)
console.js:28 14:24:33.227 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.restore.start {version: '5x8r0wtbax', fileCount: 3, usage: null, quota: 314974, percent: null, …}
VirtualFS.js:845 [VirtualFS] Restored 2/3: /render.tsx (0.4ms)
VirtualFS.js:845 [VirtualFS] Restored 3/3: /package.json (0.2ms)
VirtualFS.js:858 [VirtualFS] All 3 files restored, deferring TypeScript setup...
VirtualFS.js:885 [VirtualFS] treeVersionsUpdate emitted, heavy notifications deferred
VirtualFS.js:907 [VirtualFS] UI notifications RE-ENABLED
VirtualFS.js:909 [VirtualFS] TypeScript diagnostics deferred until after rendering...
CodeDeployActions.js:208 [CodeDeployActions] Version switch complete, opening tabs...
CodeDeployActions.js:211 [CodeDeployActions] Adding tabs to UI...
CodeDeployActions.js:215 [CodeDeployActions] Tabs added
CodeDeployActions.js:218 [CodeDeployActions] Emitting UI notifications...
console.js:28 14:24:33.250 › [sandbox_g-jhfsg-dfjgsdf] Snapshot.restore.complete {version: '5x8r0wtbax', duration: 25, fileCount: 3, timestamp: '2025-10-29T12:24:33.250Z'}
VirtualFS.js:326 [VirtualFS.stopLoading] CALLED - this.loading: true → false
VirtualFS.js:330 [VirtualFS.stopLoading] Emitted treeLoading: false
CodeDeployActions.js:230 [CodeDeployActions] UI update complete
VirtualFS.js:913 [VirtualFS] Setting up node modules...
VirtualFS.js:915 [VirtualFS] Node modules ready
CodeDeployActions.js:235 [CodeDeployActions] Enabling TypeScript diagnostics...
VirtualFS.js:680 [VirtualFS] Re-enabling TypeScript diagnostics NOW...
VirtualFS.js:686 [VirtualFS] TypeScript diagnostics fully enabled
```



