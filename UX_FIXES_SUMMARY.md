# UX Fixes Summary

## Issue #1: Skeleton Never Turns OFF During Version Switch

### Root Cause
In `VirtualFS.js`, the `set()` method was calling `setLoading()` to turn the skeleton ON for version switches (line 674), but it **NEVER called `stopLoading()`** to turn it OFF again.

```javascript
// Line 673-675: Skeleton turns ON
if (!isInitialLoad && !this.loading) {
    this.setLoading();  // ✅ Turns skeleton ON
}

// Line 894-940: Two code paths
if (isInitialLoad) {
    // Initial load path - correctly does NOT call stopLoading()
} else {
    // Version switch path - ❌ MISSING stopLoading() call!
    // Just had a comment and returned
}
```

### Fix Applied
Added `stopLoading()` call for version switch path:

```javascript
} else {
    // For version switch, turn OFF skeleton and let CodeDeployActions handle tab restoration
    this.stopLoading();  // ✅ Now turns skeleton OFF
}
```

### Expected Result After Fix
- Version switch skeleton should now have exactly **2 transitions**:
  1. **OFF → ON**: When switch starts (line 674 `setLoading()`)
  2. **ON → OFF**: When restoration completes (line 937 `stopLoading()`)
- Skeleton should appear smoothly and not stay stuck ON

---

## Issue #2: Understanding Initial Load Skeleton Behavior

### Current Flow
1. Editor window opens
2. `FileBrowserComponent` initializes with `treeLoading = false` (explicitly set)
3. `restoreSandbox()` is called
4. `fs.set(version_current, { userInitiated: false })` is called
5. Since `userInitiated: false`, the code treats it as initial load
6. **NO `setLoading()` call** - skeleton should never appear

### Why Skeleton Might Still Appear
If you're still seeing skeleton during initial load after this fix, it could be:

1. **Timing issue**: React component renders BEFORE restoration starts
2. **Multiple restoration calls**: Something might be calling `fs.create()` or `fs.set()` multiple times
3. **External trigger**: Some other code path calling `setLoading()`

### Debug Steps
To diagnose remaining initial load issues, add this logging to `VirtualFS.js`:

```javascript
setLoading() {
    console.log('[VirtualFS.setLoading] CALLED FROM:', new Error().stack);
    this.loading = true;
    this.parent.notifications.addToQueue("treeLoading", true);
}
```

This will show you the exact call stack when skeleton turns ON.

---

## Files Modified
1. `/Users/onikiten/dev/fdo/src/components/editor/utils/VirtualFS.js`
   - **Line 935-938**: Added `else` branch with `stopLoading()` call for version switches

---

## Next Steps
1. ✅ Build the application
2. ✅ Run E2E tests
3. ✅ Manually test version switching
4. ❌ If initial load skeleton still appears, add debug logging to trace the source

---

## Critical Fix Summary
**The main bug was**: Version switch turned skeleton ON but never turned it OFF, leaving it stuck in loading state permanently.

**The fix**: Added the missing `stopLoading()` call after version switch restoration completes.

