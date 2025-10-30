# Research: VirtualFS Snapshot Fix

**Status**: Complete  
**Created**: October 28, 2025  
**Updated**: October 28, 2025

## Purpose

This document contains research findings and technical decisions for implementing reliable VirtualFS snapshot creation and restoration.

## Current Implementation Analysis

### Existing Snapshot Mechanism

**Location**: `src/components/editor/utils/VirtualFS.js`

**Current Structure**:
```javascript
fs: {
    versions: {},           // In-memory version storage
    version_latest: 0,      // Latest version ID
    version_current: 0,     // Currently active version
    create(prevVersion, tabs) { ... }
    set(version) { ... }
}
```

### Identified Issues

#### 1. Snapshot Creation (`fs.create()`)

**Current Behavior** (lines 165-214):
- Iterates over all Monaco models
- Excludes node_modules and dist directories
- Uses `LZString.compress()` for localStorage
- Updates both in-memory and localStorage synchronously

**Problems Found**:
- ❌ No validation that files exist before capture
- ❌ No error handling for Monaco model access failures
- ❌ No atomic operation guarantee - partial writes possible
- ❌ Missing progress tracking despite `setLoading()`/`stopLoading()` calls
- ❌ No rollback mechanism if localStorage write fails
- ❌ Race condition: loading state can mismatch actual operation state

#### 2. Snapshot Restoration (`fs.set()`)

**Current Behavior** (lines 215-272):
- Disposes existing models in a loop
- Creates new models from snapshot content
- Updates tree structure and tabs

**Problems Found**:
- ❌ No validation that models are disposed before accessing
- ❌ Model disposal errors not caught (line 223: `this.parent.files[key].model.dispose()`)
- ❌ No cleanup of TypeScript markers before model disposal (can leave orphaned markers)
- ❌ `setupNodeModules()` called during restoration may interfere
- ❌ No progress tracking for multi-step operation
- ❌ Missing rollback if restoration fails midway
- ❌ Notification queue may get out of sync during errors

#### 3. localStorage Integration

**Current Pattern**:
```javascript
localStorage.getItem(this.parent.sandboxName)
localStorage.setItem(this.parent.sandboxName, compressed)
```

**Problems Found**:
- ❌ No quota exceeded error handling
- ❌ No validation of decompressed data integrity
- ❌ No mechanism to detect multi-window modifications
- ❌ Synchronous operations can block UI

## Technical Decisions

### Decision 1: Atomic Transaction Pattern

**Chosen Approach**: Snapshot-before-modify with rollback capability

**Rationale**:
- Enables rollback to previous state on any failure
- Prevents partial/corrupted states
- Standard pattern for reliable state management

**Implementation**:
```javascript
async create(prevVersion, tabs) {
    const backupState = this.captureCurrentState();
    try {
        this.setLoading();
        const snapshot = await this.buildSnapshot(prevVersion, tabs);
        await this.validateSnapshot(snapshot);
        await this.persistSnapshot(snapshot);
        this.updatePointers(snapshot.version);
    } catch (error) {
        await this.rollback(backupState);
        this.logError('create', error);
        throw new AtomicOperationError('Snapshot creation failed', error);
    } finally {
        this.stopLoading();
    }
}
```

**Alternatives Considered**:
- Two-phase commit: Too complex for localStorage
- Write-ahead log: Unnecessary overhead for single-client operations
- Copy-on-write: Requires significant storage overhead

### Decision 2: Progress Tracking Architecture

**Chosen Approach**: Stage-based progress with percentage calculation

**Rationale**:
- Users need visibility into 2-3 second operations (per success criteria)
- Stage names provide context ("Capturing files", "Compressing data")
- Percentage gives concrete progress feedback

**Implementation**:
```javascript
const stages = [
    { name: 'Capturing files', weight: 40 },
    { name: 'Compressing data', weight: 20 },
    { name: 'Validating snapshot', weight: 10 },
    { name: 'Saving to storage', weight: 30 }
];

updateProgress(stage, itemsDone, itemsTotal) {
    const stageProgress = (itemsDone / itemsTotal) * stage.weight;
    const totalProgress = previousStagesWeight + stageProgress;
    this.parent.notifications.addToQueue('snapshotProgress', {
        stage: stage.name,
        percentage: Math.round(totalProgress),
        detail: `${itemsDone}/${itemsTotal}`
    });
}
```

**Alternatives Considered**:
- Indeterminate spinner: Poor UX for long operations
- Time-based estimation: Unreliable across different project sizes
- File-by-file callbacks: Too granular, notification queue overload

### Decision 3: Multi-Window Synchronization

**Chosen Approach**: localStorage events with last-write-wins

**Rationale**:
- localStorage `storage` event available in all browsers
- Last-write-wins is simple and acceptable per clarifications
- No server required (pure client-side)

**Implementation**:
```javascript
// In init or component mount:
window.addEventListener('storage', (e) => {
    if (e.key === this.sandboxName && e.newValue !== e.oldValue) {
        this.handleExternalChange(e.newValue);
    }
});

handleExternalChange(newValue) {
    const external Data = JSON.parse(LZString.decompress(newValue));
    // Update version list UI
    this.parent.notifications.addToQueue('treeVersionsUpdate', externalData.versions);
    
    // If current version was deleted externally
    if (!externalData.versions[this.version_current]) {
        this.handleCurrentVersionDeleted();
    }
}
```

**Alternatives Considered**:
- BroadcastChannel API: Not available in all Electron versions
- Polling: Inefficient, 2-second+ delay unacceptable
- IPC via main process: Unnecessary complexity for localStorage

### Decision 4: Error Handling & Logging Strategy

**Chosen Approach**: electron-log with structured logging

**Rationale**:
- electron-log is likely already a project dependency (Electron app)
- Provides file-based persistence for debugging
- Supports log levels and structured data

**Implementation**:
```javascript
import log from 'electron-log';

class SnapshotLogger {
    logStart(operation, context) {
        log.info(`Snapshot.${operation}.start`, {
            version: context.version,
            fileCount: context.fileCount,
            timestamp: new Date().toISOString()
        });
    }
    
    logComplete(operation, context) {
        log.info(`Snapshot.${operation}.complete`, {
            version: context.version,
            duration: context.duration,
            timestamp: new Date().toISOString()
        });
    }
    
    logError(operation, error, context) {
        log.error(`Snapshot.${operation}.error`, {
            version: context.version,
            error: error.message,
            stack: error.stack,
            failurePoint: context.failurePoint,
            timestamp: new Date().toISOString()
        });
    }
    
    logRollback(operation, context) {
        log.warn(`Snapshot.${operation}.rollback`, {
            version: context.version,
            reason: context.reason,
            timestamp: new Date().toISOString()
        });
    }
}
```

**Alternatives Considered**:
- console.log only: Not persistent, hard to debug production issues
- Custom file logging: Reinventing the wheel
- Remote logging service: Overkill for desktop app, privacy concerns

### Decision 5: Snapshot Deletion UI Pattern

**Chosen Approach**: Inline delete button in version list with confirmation dialog

**Rationale**:
- Standard pattern users expect
- Confirmation prevents accidental deletion
- Shows storage usage context to help user decide

**Implementation**:
```javascript
// Version list UI (likely in EditorPage component)
{versions.map(v => (
    <div key={v.version} className="version-item">
        <span>{formatDate(v.date)}</span>
        {v.current && <Badge>Current</Badge>}
        <Button 
            icon="trash"
            disabled={v.current}
            onClick={() => confirmDeleteSnapshot(v.version)}
        />
    </div>
))}

// Delete confirmation
confirmDeleteSnapshot(version) {
    showDialog({
        title: 'Delete Snapshot?',
        message: `Delete snapshot from ${formatDate(version.date)}?`,
        detail: 'This action cannot be undone.',
        buttons: ['Cancel', 'Delete'],
        callback: (response) => {
            if (response === 1) { // Delete button
                virtualFS.fs.deleteSnapshot(version);
            }
        }
    });
}
```

**Alternatives Considered**:
- Right-click context menu: Less discoverable
- Bulk delete: Complex, not needed per clarifications
- Automatic deletion: Rejected in clarification phase

### Decision 6: Storage Quota Monitoring

**Chosen Approach**: Proactive quota checking with user warnings

**Rationale**:
- Prevents silent failures (per FR-023)
- Gives users time to clean up before critical failures
- localStorage quota is queryable via `navigator.storage.estimate()`

**Implementation**:
```javascript
async checkStorageQuota() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const {usage, quota} = await navigator.storage.estimate();
        const usagePercent = (usage / quota) * 100;
        
        if (usagePercent >= 80) {
            this.parent.notifications.addToQueue('storageWarning', {
                usage: Math.round(usage / 1024 / 1024), // MB
                quota: Math.round(quota / 1024 / 1024), // MB
                percent: Math.round(usagePercent)
            });
        }
        
        return usagePercent < 95; // Block operations at 95%
    }
    return true; // Assume OK if API unavailable
}
```

**Alternatives Considered**:
- Try-catch on write: Too late, partial data already written
- Fixed snapshot limit: Arbitrary, doesn't account for project size variation
- No monitoring: Leads to silent failures (explicitly rejected)

### Decision 7: Monaco Model Lifecycle Management

**Chosen Approach**: Explicit validation before disposal with marker cleanup

**Rationale**:
- Prevents "model already disposed" errors
- Clears TypeScript markers to avoid orphaned UI elements
- Follows Monaco best practices

**Implementation**:
```javascript
async cleanupModels(modelPaths) {
    for (const path of modelPaths) {
        try {
            const model = monaco.editor.getModel(monaco.Uri.file(path));
            if (model && !model.isDisposed()) {
                // Clear markers first
                if (path.endsWith('.ts') || path.endsWith('.tsx')) {
                    monaco.editor.setModelMarkers(model, 'typescript', []);
                }
                
                // Clear extra libs for TypeScript
                monaco.languages.typescript.typescriptDefaults.addExtraLib('', path);
                
                // Dispose model
                model.dispose();
            }
            
            // Clean up internal tracking
            delete this.parent.files[path];
            this.parent.notifications.addToQueue('fileRemoved', path);
            
        } catch (error) {
            // Log but don't fail entire restoration
            log.warn('Model cleanup failed', { path, error: error.message });
        }
    }
}
```

**Alternatives Considered**:
- Dispose all without checking: Causes errors
- Keep old models around: Memory leak
- Dispose after new models created: Temporary memory spike, potential OOM

## Technology Stack Assessment

### Required Dependencies

| Dependency | Status | Purpose | Notes |
|------------|--------|---------|-------|
| `monaco-editor` | ✅ Existing | Code editor | Already in use |
| `lz-string` | ✅ Existing | Compression | Already in use |
| `lodash` | ✅ Existing | Utilities | Already in use |
| `electron-log` | ⚠️ **Verify** | Logging | Need to confirm presence |
| `@blueprintjs/*` | ✅ Existing | UI components | Seen in imports |

### Verification Needed

**electron-log**: Check package.json to confirm. If not present:
- **Option A**: Add it (recommended for Electron apps)
- **Option B**: Use console.log with timestamp wrapping (fallback)

## Performance Optimization Strategies

### 1. Compression Strategy

**Current**: `LZString.compress()` - synchronous, blocks UI

**Optimization**: Use Web Workers for compression/decompression on large snapshots

**Threshold**: If snapshot size > 1MB raw, offload to worker

**Implementation**:
```javascript
// compression-worker.js
self.addEventListener('message', ({data}) => {
    const compressed = LZString.compress(data.content);
    self.postMessage({id: data.id, result: compressed});
});

// In VirtualFS:
async compressInWorker(content) {
    if (content.length < 1024 * 1024) {
        return LZString.compress(content); // Small enough for main thread
    }
    
    return new Promise((resolve, reject) => {
        const worker = new Worker('compression-worker.js');
        const id = Math.random().toString(36);
        
        worker.onmessage = ({data}) => {
            if (data.id === id) {
                worker.terminate();
                resolve(data.result);
            }
        };
        
        worker.onerror = reject;
        worker.postMessage({id, content});
    });
}
```

**Tradeoff**: Complexity vs. UI responsiveness. Worth it for 50+ file projects.

### 2. Incremental Snapshot Strategy (Future Enhancement)

**Not implemented in this fix** (scope creep), but documented for future:

Instead of full snapshots, store deltas between versions. Reduces storage by ~70%.

**Why deferred**: Bug fix focus, adds complexity, existing compression is adequate.

## Risk Analysis

### High Risk Areas

1. **Monaco Model Disposal Errors**
   - **Risk**: Disposing non-existent models crashes editor
   - **Mitigation**: Explicit `isDisposed()` checks before all operations
   - **Detection**: Try-catch with logging

2. **localStorage Quota Exceeded**
   - **Risk**: Silent failure or partial write
   - **Mitigation**: Proactive quota checking, user warnings at 80%
   - **Detection**: Catch QuotaExceededError, rollback transaction

3. **Multi-Window Race Conditions**
   - **Risk**: Two windows write simultaneously, corrupt data
   - **Mitigation**: Last-write-wins acceptable per clarifications
   - **Detection**: Storage event listeners, version conflict checks

4. **Memory Leaks During Restoration**
   - **Risk**: Old models not cleaned up, accumulate over time
   - **Mitigation**: Comprehensive cleanup before restoration, disposal validation
   - **Detection**: Memory profiling tests (SC-006)

### Medium Risk Areas

1. **Progress Notification Queue Overflow**
   - **Risk**: Too many progress updates overwhelm queue
   - **Mitigation**: Throttle progress updates to max 20/second
   - **Detection**: Queue depth monitoring

2. **Compression Performance**
   - **Risk**: Large projects freeze UI during compression
   - **Mitigation**: Web Worker offload for >1MB snapshots
   - **Detection**: Performance testing with 50-file projects

## Testing Strategy

### Unit Tests

- `fs.create()` with various file counts (0, 1, 5, 20, 50)
- `fs.set()` with valid/invalid version IDs
- `fs.deleteSnapshot()` with edge cases (current, non-existent)
- Compression/decompression roundtrip
- Storage quota simulation

### Integration Tests

- Full create → restore → verify cycle
- Multi-window synchronization scenarios
- Storage quota exceeded handling
- Rollback on failure scenarios
- Progress notification sequence validation

### Performance Tests

- SC-004: Create snapshot <2s for 20 files/5MB
- SC-005: Restore snapshot <3s for 20 files/5MB
- SC-006: Memory stability over 10 operations
- SC-013: Multi-window sync <2s latency

## Open Questions & Assumptions

### Assumptions

1. ✅ electron-log is available (or can be added)
2. ✅ localStorage is the correct storage mechanism (not IndexedDB)
3. ✅ Compression ratio of 50% is achievable with LZString
4. ✅ Web Workers are available in Electron renderer process
5. ✅ Blueprint UI components available for dialogs/notifications

### Resolved Questions

All questions from spec.md clarification phase have been resolved:
- ✅ Manual trigger only
- ✅ Warn + manual deletion at 80% quota
- ✅ Show error + rollback confirmation
- ✅ Progress bar with percentage + stages
- ✅ Timestamps only, no custom names
- ✅ electron-log for diagnostics
- ✅ Shared storage, last-write-wins

## Implementation Priorities

### Phase 1: Core Reliability (P0)
1. Atomic transaction pattern with rollback
2. Monaco model lifecycle fixes
3. Error handling and logging
4. Storage quota validation

### Phase 2: User Experience (P1)
5. Progress indicators
6. Multi-window synchronization
7. Snapshot deletion UI
8. Storage warnings

### Phase 3: Polish (P2)
9. Compression optimization (Web Workers)
10. Performance tuning
11. Comprehensive test coverage

## References

- Mozilla localStorage documentation: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- Monaco Editor API: https://microsoft.github.io/monaco-editor/api/index.html
- Storage API: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
- LZString library: https://github.com/pieroxy/lz-string
- electron-log: https://github.com/megahertz/electron-log
