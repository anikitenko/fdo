# Data Model: Editor Window Lifecycle

**Date**: October 28, 2025  
**Phase**: 1 - Design & Contracts  
**Branch**: `006-fix-editor-close`

## Overview

This document defines the state model for editor window lifecycle management, focusing on the close and reload confirmation flows. The model ensures reliable window closure through state tracking, validation, and timeout mechanisms.

## Entities

### 1. Editor Window Instance

**Location**: `src/utils/editorWindow.js`

**Definition**: Singleton manager for the active editor BrowserWindow instance

```javascript
{
  window: BrowserWindow | null,  // The Electron window instance
  
  // Methods
  createWindow(): BrowserWindow,
  nullWindow(): void,
  getWindow(): BrowserWindow | null
}
```

**State Transitions**:

```
null → created → active → closing → destroyed → null
  ^                                               |
  |_______________________________________________|
```

**Invariants**:
- Only one editor window exists at a time (singleton pattern)
- `window` is null before creation and after destruction
- `createWindow()` must not be called if window already exists
- `nullWindow()` must be called after window destruction

**Validation Rules**:
- Before any window operation: Check `window !== null && !window.isDestroyed()`
- On window creation: Previous window must be null or destroyed
- On window destruction: Cleanup all IPC handlers

### 2. Close Request State

**Location**: `src/components/editor/EditorPage.jsx` (renderer process)

**Definition**: Tracks close request status to prevent duplicates

```javascript
{
  closeInProgress: boolean,  // True when close confirmation is active
  
  // Transitions
  // idle (false) → confirming (true) → idle (false)
  //             ↓                    ↑
  //             └─────timeout────────┘
}
```

**State Transitions**:

```
IDLE (closeInProgress = false)
  │
  ├─ Close button clicked
  │  └→ CONFIRMING (closeInProgress = true)
  │       │
  │       ├─ User confirms → Send IPC → [Wait for window close or timeout]
  │       │                              └→ IDLE (component unmounts)
  │       │
  │       ├─ User cancels → IDLE (closeInProgress = false)
  │       │
  │       └─ Timeout (3s) → Force close → IDLE (component unmounts)
  │
  └─ Additional close clicked while CONFIRMING → Ignored
```

**Invariants**:
- `closeInProgress` resets to `false` only on user cancel (not on confirm)
- Multiple close requests while `true` are silently ignored
- Component unmount during confirmation is handled gracefully

### 3. IPC Close Approval Flow

**Location**: `src/ipc/system.js` (main process)

**Definition**: Message flow between renderer and main process for close approval

```javascript
{
  // Channel: SystemChannels.EDITOR_CLOSE_APPROVED
  // Direction: Renderer → Main
  // Payload: none (fire-and-forget)
  
  // Handler registration
  handlerRegistered: boolean,  // Persistent handler via ipcMain.on()
  
  // Timeout tracking
  timeoutId: NodeJS.Timeout | null,  // Active timeout for force-close
  timeoutDuration: 2500,  // 2.5 seconds (middle of 2-3s range)
}
```

**Message Flow**:

```
RENDERER PROCESS                 MAIN PROCESS
─────────────────               ──────────────

[User clicks close]
      │
      ├─ Prevent default
      │  (event.preventDefault)
      │
      ├─ Check closeInProgress
      │  └─ If true: ignore
      │  └─ If false: continue
      │
      ├─ Set closeInProgress = true
      │
      ├─ Show confirm dialog
      │  └─ "Changes will be discarded..."
      │
      ├─ User confirms?
      │  │
      │  YES: Send IPC message        ──→  Receive CLOSE_APPROVED
      │       "EDITOR_CLOSE_APPROVED"          │
      │                                        ├─ Get window instance
      │                                        │
      │                                        ├─ Validate window
      │                                        │  ├─ Check not null
      │                                        │  ├─ Check not destroyed
      │                                        │  └─ If invalid: cleanup & return
      │                                        │
      │                                        ├─ Start timeout (2.5s)
      │                                        │  └─ setTimeout(() => {
      │                                        │       force destroy
      │                                        │       cleanup
      │                                        │     }, 2500)
      │                                        │
      │                                        ├─ Call window.destroy()
      │                                        │
      │                                        └─ Window 'closed' event
      │                                             │
      │                                             ├─ Clear timeout
      │                                             │
      │                                             ├─ Remove IPC handlers
      │                                             │
      │                                             └─ Call editorWindow.nullWindow()
      │
      └─ Component unmounts
         (window closed)
      
      
      NO: Set closeInProgress = false
          (window stays open)
```

**Invariants**:
- IPC handler registered via `ipcMain.on()` (persistent, not `once()`)
- Handler cleanup occurs on window 'closed' event
- Timeout is always set when window.destroy() is called
- Timeout is always cleared on successful window close
- Invalid window references skip destroy but still cleanup

### 4. Timeout Mechanism

**Definition**: Failsafe to force window closure if normal destroy fails

```javascript
{
  startTime: number,          // timestamp when timeout started
  timeoutId: NodeJS.Timeout,  // setTimeout identifier
  duration: 2500,             // milliseconds (2.5 seconds)
  triggered: boolean,         // true if timeout executed
  
  // Actions on trigger
  // 1. window.destroy() (if not already destroyed)
  // 2. window.close() fallback
  // 3. editorWindow.nullWindow()
  // 4. Remove IPC handlers
  // 5. Log timeout event for observability
}
```

**Timeout Flow**:

```
Close Approved Received
    │
    ├─ Create timeout: setTimeout(() => { ... }, 2500)
    │
    ├─ Attempt window.destroy()
    │
    └─ Two possible paths:
       
       PATH 1: Normal Close (< 2.5s)
       ├─ Window destroyed successfully
       ├─ 'closed' event fires
       ├─ Clear timeout: clearTimeout(timeoutId)
       └─ Cleanup handlers
       
       PATH 2: Timeout Triggered (≥ 2.5s)
       ├─ Timeout callback executes
       ├─ Check if window still exists
       │  └─ If yes: Force destroy/close
       │  └─ If no: Already cleaned up
       ├─ Log timeout event (observability)
       └─ Cleanup handlers
```

**Edge Cases Handled**:
- Timeout triggers after window already closed: No-op (window check prevents error)
- Multiple timeouts active: Impossible (only one close operation at a time due to `closeInProgress` flag)
- Timeout clears after handler removed: Safe (clearTimeout with invalid ID is no-op)

## Relationships

### Window → IPC Handlers

**Cardinality**: 1 window : N handlers (close, reload, other channels)

**Lifecycle**: Handlers registered on window creation, removed on window destruction

**Integrity**: If window is destroyed without cleanup, handlers become orphaned (memory leak risk) → Mitigated by explicit cleanup in 'closed' event

### Renderer State → Main Process State

**Communication**: One-way (renderer → main) via IPC

**Consistency**: Renderer `closeInProgress` flag is independent from main process state (no synchronization needed)

**Failure Modes**: 
- IPC message lost: Timeout mechanism in main process handles (force close after 2.5s)
- Renderer crashes during confirmation: Main process window cleanup handles gracefully

## State Validation Rules

### Pre-Destroy Validation

**Must check before calling `window.destroy()`**:

```javascript
function canDestroyWindow(window) {
  if (!window) return false;                    // Null check
  if (window.isDestroyed()) return false;       // Already destroyed
  // Additional checks possible:
  // if (window.isClosing()) return false;      // Closing in progress (future)
  return true;
}
```

**Actions on validation failure**:
1. Skip destroy operation
2. Execute cleanup (remove handlers, null reference)
3. Clear any active timeouts
4. Log validation failure (observability)

### Post-Destroy Cleanup

**Must execute after window destruction (success or failure)**:

```javascript
function cleanupWindow(window) {
  // 1. Remove IPC handlers
  ipcMain.removeHandler(SystemChannels.EDITOR_CLOSE_APPROVED);
  ipcMain.removeHandler(SystemChannels.EDITOR_RELOAD_APPROVED);
  // Note: removeHandler is idempotent (safe to call multiple times)
  
  // 2. Clear any active timeouts
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  
  // 3. Null window reference
  editorWindow.nullWindow();
  
  // 4. Log cleanup (observability)
  log.info('Editor window cleanup complete');
}
```

## Data Flow Diagrams

### Normal Close Flow

```
┌─────────────┐                 ┌──────────────┐
│  Renderer   │                 │ Main Process │
│ (EditorPage)│                 │ (system.js)  │
└──────┬──────┘                 └──────┬───────┘
       │                               │
       │ 1. Close button clicked       │
       │ 2. closeInProgress = true     │
       │ 3. Show confirm dialog        │
       │ 4. User confirms              │
       │                               │
       │ 5. IPC: CLOSE_APPROVED ──────>│
       │                               │
       │                               │ 6. Validate window
       │                               │ 7. Start timeout (2.5s)
       │                               │ 8. window.destroy()
       │                               │
       │                               │ 9. 'closed' event
       │                               │ 10. clearTimeout()
       │                               │ 11. Remove handlers
       │                               │ 12. nullWindow()
       │                               │
       │ 13. Component unmounts        │
       │ (window gone)                 │
       │                               │
```

### Timeout Activation Flow

```
┌─────────────┐                 ┌──────────────┐
│  Renderer   │                 │ Main Process │
└──────┬──────┘                 └──────┬───────┘
       │                               │
       │ IPC: CLOSE_APPROVED ──────────>│
       │                               │
       │                               │ Validate window
       │                               │ Start timeout (2.5s)
       │                               │ window.destroy()
       │                               │ [HANGS - no response]
       │                               │
       │                               │ ... 2.5 seconds pass ...
       │                               │
       │                               │ TIMEOUT TRIGGERED
       │                               │ ├─ Check window exists
       │                               │ ├─ Force destroy/close
       │                               │ ├─ Log timeout event
       │                               │ ├─ Remove handlers
       │                               │ └─ nullWindow()
       │                               │
       │ Component unmounts            │
       │ (window force-closed)         │
       │                               │
```

## Error States & Recovery

| Error Condition | Detection | Recovery Action | User Impact |
|----------------|-----------|-----------------|-------------|
| Window already destroyed | `window.isDestroyed() === true` | Skip destroy, run cleanup | None (graceful) |
| Window reference null | `window === null` | Skip destroy, run cleanup | None (graceful) |
| IPC message lost | Timeout expires | Force close window | 2.5s delay, then closes |
| destroy() throws error | try-catch | Log error, run cleanup | Logged, window may persist |
| Renderer crash during confirm | Main process detects window gone | Normal cleanup on 'closed' | Window closes immediately |
| Multiple simultaneous close | `closeInProgress` flag check | Ignore subsequent requests | None (first request wins) |

## Performance Characteristics

**Memory**: 
- Window reference: ~8 bytes (pointer)
- Timeout object: ~100 bytes
- Boolean flag: 1 byte
- **Total overhead**: < 150 bytes per window

**Time Complexity**:
- Window validation: O(1)
- Handler registration/removal: O(1)
- Timeout setup/clear: O(1)
- **All operations**: O(1)

**Latency**:
- Normal close: 165-265ms (measured)
- With timeout: Maximum 2.5s
- Validation overhead: < 5ms

## Future Extensions

### Potential Enhancements

1. **Window State Machine**: Full FSM tracking (idle → closing → closed)
2. **Abort Signal**: Allow cancellation of in-progress close
3. **Close Reason Tracking**: Track why window closed (user, timeout, error, etc.)
4. **Metrics Collection**: Track close success rate, timeout frequency
5. **Multiple Window Support**: Extend to multiple editor windows (if needed)

### Backward Compatibility

All changes maintain backward compatibility:
- No changes to IPC channel definitions
- No changes to public APIs
- No changes to window creation/management interfaces
- Purely internal state management improvements

