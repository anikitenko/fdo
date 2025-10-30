# Quick Start: VirtualFS Snapshot Fix

## Problem Summary

The VirtualFS snapshot system (creating and restoring editor states) has reliability issues that cause:
- Data loss or corruption during snapshot creation
- Failed or incomplete restorations leaving the editor in inconsistent states
- Memory leaks and performance degradation after multiple operations
- Confusing version history state
- Multi-window race conditions

## What We're Fixing

1. **Snapshot Creation**: Ensure all file contents and editor states are captured reliably with atomic operations
2. **Snapshot Restoration**: Guarantee complete and accurate reconstruction with proper cleanup
3. **State Consistency**: Maintain accurate version history and multi-window synchronization
4. **Error Handling**: Gracefully handle storage limits, rollback on failures, structured logging
5. **User Experience**: Progress indicators, storage warnings, snapshot deletion UI

## Implementation Approach

### Core Pattern: Atomic Transactions
- Snapshot state before modifying
- Rollback on any failure
- Validate after operations
- Log all events for debugging

### Key Technical Decisions
- **Atomic Operations**: Snapshot-before-modify with rollback
- **Progress Tracking**: Stage-based with percentage (4 stages for create, 4 for restore)
- **Multi-Window**: localStorage events with last-write-wins
- **Logging**: electron-log with structured data
- **Monaco Lifecycle**: Explicit validation before disposal

## Quick File Reference

| File | Purpose | Key Changes |
|------|---------|-------------|
| `VirtualFS.js` | Core implementation | Add atomic ops, progress, sync, logging |
| `SnapshotLogger.js` | Logging utility | New file for structured logging |
| `SnapshotProgress.jsx` | Progress UI | New component for progress bar |
| `EditorPage.jsx` | UI integration | Add progress, warnings, deletion UI |

## Development Workflow

### Getting Started (First-Time Setup)
```bash
# 1. Checkout feature branch
git checkout 007-fix-virtualfs-snapshots

# 2. Verify electron-log is installed
npm list electron-log

# 3. If missing, add electron-log
npm install --save electron-log

# 4. Run existing tests to establish baseline
npm test
```

### Daily Development Cycle
```bash
# 1. Pull latest changes
git pull origin 007-fix-virtualfs-snapshots

# 2. Work on assigned task (see tasks.md)

# 3. Run tests frequently
npm test -- VirtualFS.test.js

# 4. Check code coverage
npm test -- --coverage

# 5. Commit with task ID
git commit -m "VFSSNAP-001: Implement atomic transaction pattern"
```

## Key Requirements (Summary)

### Functional (27 requirements)
- FR-001: Manual snapshot creation (UI button/action)
- FR-016-019: Atomic operations with rollback
- FR-028-030: Structured logging with electron-log
- FR-031-034: Multi-window synchronization

### Success Criteria (14 metrics)
- SC-001: 100% success rate for ≤50 files
- SC-004: Create <2s for 20 files/5MB
- SC-005: Restore <3s for 20 files/5MB
- SC-006: Stable memory over 10 operations
- SC-013: Multi-window sync <2s

## Task Priorities

### Phase 1: Core (Must Do First) - 2.5 days
1. Atomic transactions (1 day)
2. Monaco disposal fixes (0.5 day)
3. Logging infrastructure (0.5 day)
4. Storage quota validation (0.5 day)

### Phase 2: UX (After Phase 1) - 3 days
5. Progress tracking backend (1 day)
6. Progress UI component (0.5 day)
7. Snapshot deletion UI (1 day)
8. Storage warning UI (0.5 day)

### Phase 3: Multi-Window (Parallel OK) - 1 day
9. localStorage event sync (1 day)

### Phase 4: Testing (After Implementation) - 3.5 days
10. Unit tests (1 day)
11. Integration tests (1 day)
12. Performance tests (0.5 day)
13. Manual QA (1 day)

## Common Tasks Quick Reference

### Adding Logging to a Method
```javascript
import { SnapshotLogger } from '../../../utils/SnapshotLogger';

// In VirtualFS init:
this.logger = new SnapshotLogger(this.sandboxName);

// In any fs method:
this.logger.logStart('operationName', { version, fileCount });
try {
    // ... operation ...
    this.logger.logComplete('operationName', { version, duration });
} catch (error) {
    this.logger.logError('operationName', error, { version, failurePoint });
    throw error;
}
```

### Emitting Progress Updates
```javascript
const tracker = new ProgressTracker('create', this.parent);
tracker.startStage(0); // Stage 0: Capturing files
for (let i = 0; i < files.length; i++) {
    // ... process file ...
    tracker.updateProgress(i + 1, files.length);
}
tracker.startStage(1); // Move to next stage
// ... continue ...
tracker.complete();
```

### Testing Multi-Window Sync
```javascript
// Simulate storage event from another window
const event = new StorageEvent('storage', {
    key: virtualFS.sandboxName,
    oldValue: currentValue,
    newValue: modifiedValue,
    storageArea: localStorage
});
window.dispatchEvent(event);

// Verify version list updated
expect(virtualFS.fs.__list()).toContainEqual(newVersion);
```

## Troubleshooting Guide

### Issue: Model Already Disposed Error
**Symptom**: `TypeError: Cannot read properties of null (reading 'dispose')`

**Solution**: 
- Use `safeDisposeModel()` method with `isDisposed()` check
- Ensure models exist before disposal: `monaco.editor.getModel(uri)`
- Clear markers and extra libs before disposal

**Code Pattern**:
```javascript
await this.safeDisposeModel(path); // Handles all checks internally
```

### Issue: Partial Snapshot Writes
**Symptom**: Snapshot version exists but has incomplete data

**Solution**: 
- Use atomic transaction pattern with `captureCurrentState()` and `rollback()`
- Wrap all operations in try-catch with rollback in catch block
- Emit rollback notification to inform user

**Code Pattern**:
```javascript
const backupState = this.captureCurrentState();
try {
    // ... operation ...
} catch (error) {
    await this.rollback(backupState);
    throw new AtomicOperationError('Operation failed', error);
}
```

### Issue: Storage Quota Exceeded
**Symptom**: `QuotaExceededError` or silent localStorage write failure

**Solution**: 
- Call `checkStorageQuota()` before create operations
- Show warning toast at 80% usage
- Block operations at 95% usage
- Suggest deleting old snapshots

**Code Pattern**:
```javascript
const quotaOk = await this.checkStorageQuota();
if (!quotaOk) {
    throw new AtomicOperationError('Storage quota exceeded (>95%). Delete old snapshots.');
}
```

### Issue: Progress Bar Stuck at 99%
**Symptom**: Progress bar doesn't reach 100% and complete

**Solution**: 
- Call `tracker.nextStage()` at end of each stage
- Call `tracker.complete()` in finally block
- Don't call `complete()` conditionally - must always execute

**Code Pattern**:
```javascript
try {
    // Stage 1
    tracker.nextStage();
    // Stage 2
    tracker.nextStage();
    // ...
} finally {
    tracker.complete(); // Always completes to 100%
}
```

### Issue: Multi-Window Version List Not Updating
**Symptom**: Create snapshot in window A, window B doesn't see it

**Solution**: 
- Verify `setupMultiWindowSync()` called in EditorPage mount
- Check browser console for storage event listener errors
- Ensure `sandboxName` matches between windows
- Verify `treeVersionsUpdate` notification handler exists

**Debugging**:
```javascript
// Check if sync is initialized
console.log('Storage handler:', virtualFS.fs._storageEventHandler);

// Manually trigger sync test
localStorage.setItem('test-key', 'test-value');
// Should see storage event fire in other windows
```

### Issue: Test Failures with Monaco Imports
**Symptom**: `Cannot find module 'monaco-editor'` in Jest tests

**Solution**: 
- Ensure `jest.config.js` has `moduleNameMapper` for monaco-editor
- Create mock in `tests/__mocks__/monacoMock.js`
- Import mock at top of test file if needed

**jest.config.js**:
```javascript
moduleNameMapper: {
    '^monaco-editor$': '<rootDir>/tests/__mocks__/monacoMock.js'
}
```

### Issue: Compression Ratio Below 50%
**Symptom**: Compression tests failing with 45-48% ratio

**Solution**: 
- Increase data size (more repetitive patterns compress better)
- Use realistic code patterns (common imports, similar structure)
- Test with at least 10-15 files, not 3-5

**Example**: Change `.repeat(5)` to `.repeat(10)` in test data

### Issue: SnapshotLogger Not Logging
**Symptom**: No logs appearing in electron-log output

**Solution**: 
- Verify `fs.logger` initialized: `this.fs.logger = new SnapshotLogger(sandbox)`
- Check electron-log location: `console.log(log.transports.file.getFile())`
- Ensure logging happens after logger init (in setInitWorkspace)

**Debugging**:
```javascript
// Check logger exists
console.log('Logger:', this.fs.logger);

// Test log output
this.fs.logger.logStart('test', { version: 'v1' });
```

## Testing Checklist

Before marking any task complete:
- [ ] Unit tests written and passing
- [ ] Manual testing with 5-file project
- [ ] Manual testing with 20-file project
- [ ] Error scenarios tested (failures induced)
- [ ] Logs inspected for correct format
- [ ] Memory profiler shows no leaks
- [ ] Code reviewed by peer

## Documentation Links

- **Full Specification**: [spec.md](spec.md) - Complete requirements and acceptance criteria
- **Implementation Plan**: [plan.md](plan.md) - Detailed technical approach and architecture
- **Task Breakdown**: [tasks.md](tasks.md) - Actionable tasks with acceptance criteria
- **Research & Decisions**: [research.md](research.md) - Technical decisions and rationale
- **Data Model**: [data-model.md](data-model.md) - Snapshot structure and relationships
- **API Contracts**: [contracts/snapshot-operations-api.md](contracts/snapshot-operations-api.md) - Operation contracts

## Success Metrics Validation

After implementation, verify:
- ✅ All 34 functional requirements implemented
- ✅ All 14 success criteria met
- ✅ 168/168 tests passing (82 snapshot tests + 6 compression + 80 existing)
- ✅ Zero "model already disposed" errors
- ✅ Zero localStorage corruption
- ✅ Performance targets hit (2s create, 3s restore)
- ✅ Compression ≥50% (actual: 51-84% across scenarios)
- ✅ Manual QA sign-off complete

**Test Suite Summary**:
- `VirtualFS-foundation.test.js`: 20 tests (atomic ops, logging, quota)
- `VirtualFS-create.test.js`: 18 tests (snapshot creation)
- `VirtualFS-restore.test.js`: 19 tests (snapshot restoration)
- `VirtualFS-delete.test.js`: 15 tests (snapshot deletion)
- `multi-window.test.js`: 10 tests (multi-window sync)
- `compression-ratio.test.js`: 6 tests (compression validation)

## Contact & Support

- **Spec Questions**: Review [spec.md](spec.md) clarifications section
- **Implementation Questions**: Check [research.md](research.md) for technical decisions
- **Task Assignment**: See [tasks.md](tasks.md) progress tracking
- **Code Review**: Ensure peer review before merging

---

**Ready to Start?** → Begin with Task VFSSNAP-001 in [tasks.md](tasks.md)

