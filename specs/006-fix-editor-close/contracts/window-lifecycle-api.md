# Contract: Window Lifecycle API

**Version**: 1.1.0 (Updated for close reliability fix)  
**Date**: October 28, 2025  
**Status**: Active  
**Breaking Changes**: None (backward compatible)

## Overview

This contract defines the IPC communication protocol between the renderer process (EditorPage) and main process (system.js) for editor window lifecycle management, specifically close and reload operations.

## IPC Channels

### Channel Definitions

**Source**: `src/ipc/channels.js`

```javascript
SystemChannels.on_off.CONFIRM_CLOSE  // Main → Renderer: Request close confirmation
SystemChannels.on_off.CONFIRM_RELOAD // Main → Renderer: Request reload confirmation
SystemChannels.EDITOR_CLOSE_APPROVED // Renderer → Main: Close approved by user
SystemChannels.EDITOR_RELOAD_APPROVED // Renderer → Main: Reload approved by user
```

## Message Contracts

### 1. Close Request Flow

#### Message: `CONFIRM_CLOSE`

**Direction**: Main Process → Renderer Process  
**Trigger**: User clicks window close button (OS window control)  
**Transport**: `ipcRenderer.on()`

**Payload**: None (event only)

**Sender Contract** (main process):
```javascript
// In systemOpenEditorWindow()
editorWindowInstance.on('close', (event) => {
    event.preventDefault();  // MUST prevent default to show confirmation
    editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_CLOSE);
});
```

**Receiver Contract** (renderer process):
```javascript
window.electron.system.on.confirmEditorClose((callback) => {
    // callback: () => void
    // MUST show user confirmation
    // MUST call confirmEditorCloseApproved() only if user confirms
    // MUST handle user cancellation (no IPC message sent)
});
```

**Expected Behavior**:
- Renderer MUST display confirmation prompt to user
- Renderer MUST NOT send approval without user interaction
- Multiple CONFIRM_CLOSE messages while prompt is visible MUST be ignored
- If user cancels, no further action required (window remains open)

#### Message: `EDITOR_CLOSE_APPROVED`

**Direction**: Renderer Process → Main Process  
**Trigger**: User confirms close prompt  
**Transport**: `ipcRenderer.send()`

**Payload**: None (fire-and-forget)

**Sender Contract** (renderer process):
```javascript
window.electron.system.confirmEditorCloseApproved();
// MUST be called only after user confirmation
// MUST NOT be called multiple times for same close request
// Component will unmount after this (window closes)
```

**Receiver Contract** (main process):
```javascript
// Handler registration (CHANGED: once → on for persistence)
ipcMain.on(SystemChannels.EDITOR_CLOSE_APPROVED, () => {
    const window = editorWindow.getWindow();
    
    // NEW: Window validation
    if (!window || window.isDestroyed()) {
        cleanupHandlers();
        return;
    }
    
    // NEW: Timeout mechanism
    const timeoutId = setTimeout(() => {
        forceCloseWindow(window);
    }, 2500);
    
    // Attempt normal close
    try {
        window.destroy();
    } catch (err) {
        clearTimeout(timeoutId);
        cleanupHandlers();
        log.error('Window destruction failed', err);
    }
});

// NEW: Cleanup on window closed
editorWindowInstance.on('closed', () => {
    clearTimeout(timeoutId);
    ipcMain.removeHandler(SystemChannels.EDITOR_CLOSE_APPROVED);
    editorWindow.nullWindow();
});
```

**Expected Behavior**:
1. Validate window is not null and not destroyed
2. If invalid, skip destroy and cleanup
3. If valid, start 2.5s timeout
4. Attempt window.destroy()
5. If 'closed' event fires before timeout: clear timeout, cleanup normally
6. If timeout expires: force close window, cleanup
7. Handler remains registered for future editor windows

**Post-Conditions**:
- Window is destroyed or cleanup has executed
- IPC handlers are removed
- Window reference is nulled
- Timeout is cleared (if applicable)

### 2. Reload Request Flow

#### Message: `CONFIRM_RELOAD`

**Direction**: Main Process → Renderer Process  
**Trigger**: User presses Ctrl+R / Cmd+R  
**Transport**: `ipcRenderer.on()`

**Payload**: None (event only)

**Sender Contract** (main process):
```javascript
editorWindowInstance.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_RELOAD);
    }
});
```

**Receiver Contract** (renderer process):
```javascript
window.electron.system.on.confirmEditorReload((callback) => {
    // Same pattern as CONFIRM_CLOSE
    // MUST show user confirmation
    // MUST call confirmEditorReloadApproved() only if user confirms
});
```

**Expected Behavior**: Same as CONFIRM_CLOSE (show prompt, wait for user decision)

#### Message: `EDITOR_RELOAD_APPROVED`

**Direction**: Renderer Process → Main Process  
**Trigger**: User confirms reload prompt  
**Transport**: `ipcRenderer.send()`

**Payload**: None (fire-and-forget)

**Sender Contract** (renderer process):
```javascript
window.electron.system.confirmEditorReloadApproved();
```

**Receiver Contract** (main process):
```javascript
ipcMain.on(SystemChannels.EDITOR_RELOAD_APPROVED, () => {
    const window = editorWindow.getWindow();
    if (window && !window.isDestroyed()) {
        window.reload();
    }
});
```

**Expected Behavior**: Same validation pattern as close, but calls `reload()` instead of `destroy()`

## API Changes Summary

### Changed Behavior

| Component | Before | After | Reason |
|-----------|--------|-------|--------|
| CLOSE_APPROVED handler | `ipcMain.once()` | `ipcMain.on()` | Enable multiple close attempts |
| Window validation | Null check only | Null + `isDestroyed()` check | Prevent operations on invalid windows |
| Close operation | Immediate destroy | Destroy + 2.5s timeout fallback | Ensure closure even on failure |
| Handler cleanup | None (auto-removed by `once`) | Explicit on 'closed' event | Prevent memory leaks |
| Duplicate prevention | None | Renderer-side flag | Prevent race conditions |

### Unchanged Behavior

- IPC channel names (no changes)
- Message payloads (still empty)
- Preload script exposure (`window.electron.system.*`)
- User confirmation flow (still uses `window.confirm()`)
- Security model (context isolation maintained)

## Error Handling

### Main Process Error Scenarios

| Error | Detection | Handling | User Impact |
|-------|-----------|----------|-------------|
| **Null window reference** | `window === null` | Skip destroy, cleanup handlers | None (graceful) |
| **Destroyed window** | `window.isDestroyed()` | Skip destroy, cleanup handlers | None (graceful) |
| **destroy() throws** | try-catch | Log error, cleanup | Logged, timeout will handle |
| **Timeout expires** | setTimeout callback | Force close, cleanup | 2.5s delay, then closes |
| **IPC handler missing** | N/A (defensive) | Window closes anyway (timeout) | None (failsafe active) |

### Renderer Process Error Scenarios

| Error | Detection | Handling | User Impact |
|-------|-----------|----------|-------------|
| **Component unmount during prompt** | React lifecycle | Prompt dismissed automatically | Window may stay open (safe) |
| **Duplicate close requests** | `closeInProgress` flag | Ignore additional requests | None (first request proceeds) |
| **IPC send fails** | N/A (fire-and-forget) | No confirmation, window stays open | User retries close |

## Backward Compatibility

### Compatibility Matrix

| Consumer | Version | Compatible | Notes |
|----------|---------|------------|-------|
| **Plugins** | All | ✅ Yes | No plugin-facing API changes |
| **Editor Components** | All | ✅ Yes | Internal implementation only |
| **Main Window** | All | ✅ Yes | Independent of editor window lifecycle |
| **Live UI Window** | All | ✅ Yes | Different window management path |

### Migration Requirements

**None** - This is a bug fix with no API changes. Existing code continues to work without modification.

### Deprecation Policy

No APIs are deprecated. This change strengthens existing contracts without removing functionality.

## Testing Requirements

### Contract Validation Tests

**Unit Tests** (`tests/unit/editorWindow.test.js`):
```javascript
describe('Editor Window Lifecycle', () => {
  test('CLOSE_APPROVED handler is persistent', async () => {
    // Send message twice, both should be handled
    ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED);
    // Wait for window close
    ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED);
    // Should not throw or error
  });
  
  test('Null window reference skips destroy', () => {
    editorWindow.nullWindow();
    ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED);
    // Should not throw
  });
  
  test('Timeout activates after 2.5s', async () => {
    // Mock slow destroy
    jest.spyOn(BrowserWindow.prototype, 'destroy').mockImplementation(() => {
      // Never fires 'closed' event
    });
    
    ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED);
    await wait(2600);
    
    // Verify timeout cleanup executed
    expect(editorWindow.getWindow()).toBeNull();
  });
});
```

**Integration Tests** (`tests/integration/editor-close-flow.test.js`):
```javascript
describe('Editor Close Flow Integration', () => {
  test('Full close flow with confirmation', async () => {
    // Open editor → trigger close → confirm → verify window closed
    const editor = await openEditor();
    editor.window.emit('close', mockEvent);
    // Simulate renderer confirmation
    ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED);
    await waitForWindowClose();
    expect(editorWindow.getWindow()).toBeNull();
  });
  
  test('50 consecutive close-reopen cycles', async () => {
    for (let i = 0; i < 50; i++) {
      const editor = await openEditor();
      await closeEditor(editor, confirm: true);
      expect(editorWindow.getWindow()).toBeNull();
    }
  });
});
```

## Security Considerations

### Threat Model

**No new attack surface introduced**

Existing security measures maintained:
- Context isolation: Renderer cannot access Node.js directly
- IPC channel whitelist: Only approved channels in preload script
- No user input in messages: All payloads are empty
- No privilege escalation: Window management stays in main process

### Audit Points

1. **IPC Handler Registration**: Verify `ipcMain.on()` only in trusted main process code
2. **Timeout Cleanup**: Verify timeout clears prevent resource exhaustion
3. **Window Validation**: Verify no operations on destroyed windows (prevent use-after-free)

## Performance Considerations

### Latency Budget

| Operation | Target | Typical | Maximum (with timeout) |
|-----------|--------|---------|------------------------|
| Close request to prompt | <50ms | ~50ms | N/A |
| Confirmation to destroy | <20ms | ~15ms | N/A |
| Destroy to closed event | <500ms | ~150ms | 2500ms (timeout) |
| **Total normal path** | **<570ms** | ~215ms | N/A |
| **Total with timeout** | N/A | N/A | ~2565ms |

### Resource Usage

- **Memory**: <150 bytes per window (timeout + flags)
- **CPU**: Negligible (validation checks are O(1))
- **IPC overhead**: No change from existing (same message count)

## Observability

### Logging Points

**Recommended log events**:

```javascript
// On close approved
log.info('Editor close approved by user');

// On window validation failure
log.warn('Window validation failed', { 
  isNull: !window, 
  isDestroyed: window?.isDestroyed() 
});

// On timeout activation
log.warn('Close timeout expired, forcing window closure', { 
  timeoutMs: 2500 
});

// On successful close
log.info('Editor window closed successfully', { 
  duration: closeEnd - closeStart 
});

// On cleanup
log.debug('Editor window cleanup complete');
```

### Metrics to Track

- Close success rate (closed event / approval message)
- Timeout activation rate (timeout fired / approval message)
- Average close duration (approval → closed event)
- Validation failure rate (invalid window / approval message)

## Version History

| Version | Date | Changes | Breaking |
|---------|------|---------|----------|
| 1.0.0 | 2024-XX-XX | Initial contract (with `ipcMain.once()` bug) | N/A |
| 1.1.0 | 2025-10-28 | Fix: Persistent handlers, validation, timeout | No ✅ |

## References

- **Specification**: `specs/006-fix-editor-close/spec.md`
- **Research**: `specs/006-fix-editor-close/research.md`
- **Data Model**: `specs/006-fix-editor-close/data-model.md`
- **Implementation**: 
  - `src/ipc/system.js`
  - `src/utils/editorWindow.js`
  - `src/components/editor/EditorPage.jsx`
- **FDO Constitution**: `.specify/memory/constitution.md` (Section VI: Process Isolation & Safety)

