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
**Solution**: Ensure using `safeDisposeModel()` method with `isDisposed()` check (Task VFSSNAP-002)

### Issue: Partial Snapshot Writes
**Solution**: Implement atomic transaction pattern with rollback (Task VFSSNAP-001)

### Issue: Storage Quota Exceeded
**Solution**: Add quota checking before operations (Task VFSSNAP-004)

### Issue: Progress Bar Not Showing
**Solution**: Verify SnapshotProgress component rendered in EditorPage (Task VFSSNAP-006)

### Issue: Multi-Window Out of Sync
**Solution**: Check localStorage event listener registered (Task VFSSNAP-009)

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
- ✅ 80%+ code coverage
- ✅ Zero "model already disposed" errors
- ✅ Zero localStorage corruption
- ✅ Performance targets hit (2s create, 3s restore)
- ✅ Manual QA sign-off complete

## Contact & Support

- **Spec Questions**: Review [spec.md](spec.md) clarifications section
- **Implementation Questions**: Check [research.md](research.md) for technical decisions
- **Task Assignment**: See [tasks.md](tasks.md) progress tracking
- **Code Review**: Ensure peer review before merging

---

**Ready to Start?** → Begin with Task VFSSNAP-001 in [tasks.md](tasks.md)

