# Quickstart: Editor Window Close Reliability Fix

**Date**: October 28, 2025  
**Branch**: `006-fix-editor-close`  
**Target Audience**: FDO developers working on editor window lifecycle

## Overview

This guide provides a quick introduction to the editor window close reliability fix, including how to test it, common patterns, and troubleshooting tips.

## What's Fixed?

**Problem**: Editor windows occasionally fail to close after user confirms, requiring application restart

**Root Cause**: One-time event listener (`ipcMain.once()`) was removed after first use, breaking subsequent close attempts

**Solution**: 
- Persistent event handlers (`ipcMain.on()`)
- Window validity checks before operations
- 2.5-second timeout failsafe
- Request deduplication to prevent race conditions

## Quick Start (5 Minutes)

### 1. Build and Run

```bash
cd /Users/onikiten/dev/fdo
git checkout 006-fix-editor-close
npm install  # if dependencies changed
npm start
```

### 2. Basic Test

1. **Open Editor**: Click "Open Editor" on any plugin
2. **Close Window**: Click the window close button (X)
3. **Confirm**: Click "Yes" on the confirmation prompt
4. **Verify**: Window closes within 500ms

**Expected**: Window closes reliably ✅

### 3. Reliability Test

Repeat close → reopen 10 times:

```javascript
// In browser console (for automated testing)
async function testCloseReliability(iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    console.log(`Test ${i + 1}/${iterations}`);
    
    // Open editor (manually trigger)
    // Close editor → confirm yes
    // Wait for window to close
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log('✅ All tests passed');
}
```

**Expected**: All iterations close successfully ✅

### 4. Edge Case Test

**Rapid Clicks**: Click close button 5-10 times rapidly

**Expected**: 
- Only one confirmation prompt appears
- Window closes after single confirmation ✅

## Code Changes Overview

### Files Modified

#### 1. `src/ipc/system.js` (Main Process)

**Before** (line 213):
```javascript
ipcMain.once(SystemChannels.EDITOR_CLOSE_APPROVED, () => {
    const window = editorWindow.getWindow();
    if (window) {
        window.destroy();
    }
});
```

**After**:
```javascript
ipcMain.on(SystemChannels.EDITOR_CLOSE_APPROVED, () => {
    const window = editorWindow.getWindow();
    
    // Validate window
    if (!window || window.isDestroyed()) {
        cleanupHandlers();
        return;
    }
    
    // Start timeout failsafe
    const timeoutId = setTimeout(() => {
        forceCloseWindow(window);
    }, 2500);
    
    // Attempt normal close
    try {
        window.destroy();
    } catch (err) {
        clearTimeout(timeoutId);
        cleanupHandlers();
        console.error('Window destruction failed:', err);
    }
});

// Add cleanup on window close
editorWindowInstance.on('closed', () => {
    if (timeoutId) clearTimeout(timeoutId);
    ipcMain.removeHandler(SystemChannels.EDITOR_CLOSE_APPROVED);
    editorWindow.nullWindow();
});
```

**Key Changes**:
- `once()` → `on()`: Handler persists
- Window validation: Check null + `isDestroyed()`
- Timeout mechanism: 2.5s failsafe
- Explicit cleanup: Remove handlers on 'closed'

#### 2. `src/components/editor/EditorPage.jsx` (Renderer Process)

**Before**:
```javascript
const handleElectronClose = () => {
    const confirmed = window.confirm('Changes will be discarded...');
    if (confirmed) {
        window.electron.system.confirmEditorCloseApproved();
    }
};
```

**After**:
```javascript
const [closeInProgress, setCloseInProgress] = useState(false);

const handleElectronClose = () => {
    // Prevent duplicate requests
    if (closeInProgress) return;
    
    setCloseInProgress(true);
    const confirmed = window.confirm('Changes will be discarded...');
    
    if (confirmed) {
        window.electron.system.confirmEditorCloseApproved();
        // Component will unmount, no need to reset flag
    } else {
        // User cancelled, allow retry
        setCloseInProgress(false);
    }
};
```

**Key Changes**:
- `closeInProgress` flag: Prevents duplicate confirmations
- Flag resets on cancel: Allows retries
- Flag doesn't reset on confirm: Component unmounts

#### 3. `src/utils/editorWindow.js` (Window Manager)

**Additions**:
```javascript
// Add helper for window validation
function isWindowValid(window) {
    return window !== null && !window.isDestroyed();
}

// Add helper for cleanup
function cleanupEditorWindow() {
    const window = editorWindow.getWindow();
    
    // Remove IPC handlers
    ipcMain.removeHandler(SystemChannels.EDITOR_CLOSE_APPROVED);
    ipcMain.removeHandler(SystemChannels.EDITOR_RELOAD_APPROVED);
    
    // Clear any timeouts
    if (editorWindowCloseTimeout) {
        clearTimeout(editorWindowCloseTimeout);
        editorWindowCloseTimeout = null;
    }
    
    // Null reference
    editorWindow.nullWindow();
}
```

**Key Changes**:
- Validation helper: Centralized window checks
- Cleanup helper: Ensures consistent cleanup

## Common Patterns

### Pattern 1: Window Validation Before Operations

**Always validate before touching window**:

```javascript
const window = editorWindow.getWindow();

// ❌ BAD
if (window) {
    window.someMethod();  // May throw if window destroyed
}

// ✅ GOOD
if (window && !window.isDestroyed()) {
    try {
        window.someMethod();
    } catch (err) {
        console.error('Operation failed:', err);
        cleanupHandlers();
    }
}
```

### Pattern 2: Timeout Mechanism

**Use for any potentially blocking operation**:

```javascript
const timeoutId = setTimeout(() => {
    console.warn('Operation timed out, forcing completion');
    forceComplete();
}, TIMEOUT_MS);

try {
    await normalOperation();
    clearTimeout(timeoutId);  // Clear on success
} catch (err) {
    clearTimeout(timeoutId);  // Clear on error
    throw err;
}
```

### Pattern 3: Request Deduplication

**Prevent duplicate IPC messages**:

```javascript
const [operationInProgress, setOperationInProgress] = useState(false);

const handleOperation = () => {
    if (operationInProgress) {
        console.log('Operation already in progress, ignoring');
        return;
    }
    
    setOperationInProgress(true);
    
    // ... perform operation ...
    
    // Reset on completion or cancellation
    if (userCancelled) {
        setOperationInProgress(false);
    }
    // If operation succeeds and component unmounts, no reset needed
};
```

## Troubleshooting

### Issue 1: Window Still Won't Close

**Symptom**: Window hangs even after fix

**Debug Steps**:

1. **Check console logs**: Look for timeout messages
```javascript
// Should see after 2.5s if not closing
"Close timeout expired, forcing window closure"
```

2. **Verify handler registered**: In main process console
```javascript
// Check handler exists
ipcMain.listenerCount(SystemChannels.EDITOR_CLOSE_APPROVED) > 0
// Should be 1
```

3. **Check window state**: In main process console
```javascript
const window = editorWindow.getWindow();
console.log({
    exists: !!window,
    destroyed: window?.isDestroyed(),
    closable: window?.isClosable()
});
```

**Solution**: If timeout doesn't fire, check `setTimeout` implementation or increase timeout

### Issue 2: Multiple Confirmation Prompts

**Symptom**: User sees multiple "Changes will be discarded" dialogs

**Cause**: `closeInProgress` flag not working correctly

**Debug Steps**:

1. **Check React state**: Add logging
```javascript
const handleElectronClose = () => {
    console.log('closeInProgress:', closeInProgress);
    if (closeInProgress) {
        console.log('Ignoring duplicate close request');
        return;
    }
    // ...
};
```

2. **Verify flag resets**: After cancellation
```javascript
if (!confirmed) {
    console.log('User cancelled, resetting flag');
    setCloseInProgress(false);
}
```

**Solution**: Ensure `setCloseInProgress(false)` is called on cancel branch

### Issue 3: Memory Leaks

**Symptom**: Application memory grows after many editor open/close cycles

**Cause**: IPC handlers not being cleaned up

**Debug Steps**:

1. **Check handler count**: After each close
```javascript
editorWindowInstance.on('closed', () => {
    const count = ipcMain.listenerCount(SystemChannels.EDITOR_CLOSE_APPROVED);
    console.log('Handlers remaining:', count);  // Should be 0 after removal
});
```

2. **Verify cleanup**: Add logging
```javascript
function cleanupHandlers() {
    console.log('Cleaning up IPC handlers');
    ipcMain.removeHandler(SystemChannels.EDITOR_CLOSE_APPROVED);
    console.log('Cleanup complete');
}
```

**Solution**: Ensure cleanup executes in all paths (success, timeout, error)

## Testing Checklist

### Manual Testing

- [ ] **Normal close**: Window closes in <500ms
- [ ] **Rapid clicks**: Only one confirmation appears
- [ ] **Cancel + retry**: Can close after cancelling once
- [ ] **Multiple cycles**: 10+ open→close→open cycles work
- [ ] **Timeout test**: (Mock slow destroy) Timeout fires at 2.5s
- [ ] **Invalid window**: (Mock null ref) No crash, graceful cleanup

### Automated Testing

```bash
# Run unit tests
npm test tests/unit/editorWindow.test.js

# Run integration tests
npm test tests/integration/editor-close-flow.test.js

# Run full test suite
npm test
```

**Expected**: All tests pass ✅

### Performance Testing

```javascript
// Measure close duration
const start = performance.now();
// Trigger close → confirm
window.addEventListener('beforeunload', () => {
    const duration = performance.now() - start;
    console.log(`Close duration: ${duration}ms`);  // Should be <500ms
});
```

**Expected**: <500ms for normal close, <2500ms for timeout close ✅

## Common Gotchas

### ❌ Don't: Use `ipcMain.once()` for Repeatable Operations

```javascript
// BAD - Handler removed after first use
ipcMain.once(channel, handler);
```

**Why**: If operation fails, no handler exists for retry

**Instead**: Use `ipcMain.on()` + manual cleanup

### ❌ Don't: Skip Window Validation

```javascript
// BAD - May throw on destroyed window
window.destroy();
```

**Why**: Window may be destroyed between getting reference and calling method

**Instead**: Check `window && !window.isDestroyed()`

### ❌ Don't: Forget to Clear Timeouts

```javascript
// BAD - Timeout fires even after success
setTimeout(() => forceClose(), 2500);
window.destroy();
```

**Why**: Timeout will still execute, potentially double-closing or crashing

**Instead**: Store timeout ID and clear on success

### ✅ Do: Use Defensive Programming

```javascript
// GOOD - Defense in depth
const window = editorWindow.getWindow();

if (!window || window.isDestroyed()) {
    cleanupHandlers();
    return;
}

const timeoutId = setTimeout(() => forceClose(window), 2500);

try {
    window.destroy();
} catch (err) {
    clearTimeout(timeoutId);
    cleanupHandlers();
    console.error(err);
}
```

## Next Steps

### After This Fix Works

1. **Add Observability**: Implement logging per `contracts/window-lifecycle-api.md`
2. **Collect Metrics**: Track close success rate, timeout frequency
3. **Replace Confirm**: Migrate from `window.confirm()` to Blueprint modal (better UX)
4. **Multiple Windows**: Extend pattern to support multiple editor windows (if needed)

### Related Improvements

- Apply same pattern to reload flow (shares same root cause)
- Add state machine for full window lifecycle tracking
- Implement abort signal for cancellable operations

## Support

### Documentation

- **Specification**: `specs/006-fix-editor-close/spec.md`
- **Research**: `specs/006-fix-editor-close/research.md`
- **Data Model**: `specs/006-fix-editor-close/data-model.md`
- **API Contract**: `specs/006-fix-editor-close/contracts/window-lifecycle-api.md`

### Key Files

- Main process: `src/ipc/system.js`
- Window manager: `src/utils/editorWindow.js`
- Renderer UI: `src/components/editor/EditorPage.jsx`
- IPC channels: `src/ipc/channels.js`

### Contact

For questions or issues with this fix, reference:
- Branch: `006-fix-editor-close`
- Spec: `specs/006-fix-editor-close/`
- Constitution: Section VI (Process Isolation & Safety)

---

**Happy Coding!** 🚀 This fix improves developer experience and aligns with FDO's constitution principles of safety and reliability.

