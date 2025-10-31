# Implementation Plan: VirtualFS Snapshot Fix

**Status**: Ready for Implementation  
**Created**: October 28, 2025  
**Branch**: `007-fix-virtualfs-snapshots`

## Executive Summary

This plan addresses critical reliability issues in the VirtualFS snapshot system (create/restore operations). The implementation focuses on atomic operations, proper error handling, multi-window synchronization, and enhanced user feedback.

**Scope**: Bug fix with UX improvements (no new features)  
**Estimated Effort**: 5-7 days  
**Risk Level**: Medium (touching critical data persistence layer)

## Technical Context

### Current State

**File**: `src/components/editor/utils/VirtualFS.js` (860 lines)

**Problem Areas Identified**:
1. No atomic transaction guarantee - partial writes possible
2. Monaco model disposal errors not handled
3. Missing rollback capability on failures
4. No progress tracking despite loading indicators
5. Multi-window race conditions possible
6. No storage quota monitoring
7. Inadequate error logging for debugging

### Technology Stack

| Component | Technology | Status | Notes |
|-----------|------------|--------|-------|
| **Storage** | localStorage | ✅ Existing | Browser storage with quota limits |
| **Compression** | lz-string | ✅ Existing | Already integrated |
| **Editor** | Monaco Editor | ✅ Existing | Model lifecycle management critical |
| **Logging** | electron-log | ⚠️ To verify | Check package.json, add if needed |
| **UI Framework** | Blueprint | ✅ Existing | For dialogs/progress bars |
| **State Mgmt** | VirtualFS object | ✅ Existing | Refactor methods, preserve API |

### Architecture Decisions

**See**: [`research.md`](./research.md) for detailed rationale

1. **Atomic Operations**: Snapshot-before-modify with rollback
2. **Progress Tracking**: Stage-based with percentage calculation
3. **Multi-Window Sync**: localStorage events with last-write-wins
4. **Error Handling**: electron-log with structured logging
5. **Monaco Lifecycle**: Explicit validation before disposal

## Constitution Check

### Design Principles Alignment

✅ **Simplicity**: Last-write-wins is simpler than CRDT  
✅ **Reliability**: Atomic operations prevent corruption  
✅ **User Value**: Progress bars and error messages improve UX  
✅ **Maintainability**: Structured logging aids debugging  
✅ **Performance**: Web Workers for compression on large files  

### Quality Gates

| Gate | Requirement | Status | Notes |
|------|-------------|--------|-------|
| **Test Coverage** | Unit + integration tests | 📋 Planned | See Testing Strategy below |
| **Performance** | Create <2s, Restore <3s | 🎯 Target | Per SC-004, SC-005 |
| **Reliability** | 100% success rate | 🎯 Target | Per SC-001, SC-002 |
| **Memory** | Stable over 10 ops | 🎯 Target | Per SC-006 |
| **Documentation** | API contracts + logs | ✅ Complete | contracts/ directory |

## Implementation Phases

### Phase 1: Core Reliability Fixes (P0 - Critical)

**Goal**: Fix data corruption and ensure atomic operations

#### Task 1.1: Implement Atomic Transaction Pattern

**Priority**: P0  
**Estimated Effort**: 1 day  
**Dependencies**: None

**Acceptance Criteria**:
- [ ] Create `captureCurrentState()` method to snapshot state before operations
- [ ] Wrap `fs.create()` and `fs.set()` in try-catch with rollback
- [ ] Implement `rollback()` method to restore previous state on failure
- [ ] Validate that partial writes never persist to localStorage
- [ ] Test with induced failures at each operation step

**Implementation Details**:
```javascript
class AtomicOperationError extends Error {
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'AtomicOperationError';
    }
}

captureCurrentState() {
    return {
        versions: _.cloneDeep(this.versions),
        version_latest: this.version_latest,
        version_current: this.version_current,
        localStorage: localStorage.getItem(this.parent.sandboxName)
    };
}

async rollback(backupState) {
    this.versions = backupState.versions;
    this.version_latest = backupState.version_latest;
    this.version_current = backupState.version_current;
    
    if (backupState.localStorage) {
        localStorage.setItem(this.parent.sandboxName, backupState.localStorage);
    }
    
    this.parent.notifications.addToQueue('operationRollback', {
        message: 'Operation failed and was rolled back to previous state'
    });
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Add methods to `fs` object

**Related Requirements**: FR-016, FR-017, FR-018, FR-019

---

#### Task 1.2: Fix Monaco Model Disposal

**Priority**: P0  
**Estimated Effort**: 0.5 days  
**Dependencies**: None

**Acceptance Criteria**:
- [ ] Check `model.isDisposed()` before all disposal operations
- [ ] Clear TypeScript markers before model disposal
- [ ] Clear extra libs before model disposal
- [ ] Wrap disposal in try-catch with logging
- [ ] Verify no "model already disposed" errors in tests

**Implementation Details**:
```javascript
async safeDisposeModel(path) {
    try {
        const uri = monaco.Uri.file(path);
        const model = monaco.editor.getModel(uri);
        
        if (model && !model.isDisposed()) {
            // Clear markers for TypeScript files
            if (path.endsWith('.ts') || path.endsWith('.tsx')) {
                monaco.editor.setModelMarkers(model, 'typescript', []);
            }
            
            // Clear extra libs
            monaco.languages.typescript.typescriptDefaults.addExtraLib('', path);
            
            // Dispose the model
            model.dispose();
            
            this.logger.logModelDisposal(path);
        }
        
        // Clean up internal tracking
        if (this.parent.files[path]) {
            delete this.parent.files[path];
            this.parent.notifications.addToQueue('fileRemoved', path);
        }
        
    } catch (error) {
        this.logger.logError('modelDisposal', error, { path });
        // Don't throw - log and continue with restoration
    }
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Update `fs.set()` method

**Related Requirements**: FR-004, FR-005, FR-006, FR-007

---

#### Task 1.3: Implement Error Logging Infrastructure

**Priority**: P0  
**Estimated Effort**: 0.5 days  
**Dependencies**: Verify electron-log in package.json

**Acceptance Criteria**:
- [ ] Confirm electron-log is installed (or add it)
- [ ] Create `SnapshotLogger` class with structured logging methods
- [ ] Log all operation lifecycle events (start, complete, error, rollback)
- [ ] Include version IDs, timestamps, and context in all log entries
- [ ] Verify logs are written to file in expected format

**Implementation Details**:
```javascript
// src/utils/SnapshotLogger.js (new file)
import log from 'electron-log';

export class SnapshotLogger {
    constructor(sandboxName) {
        this.sandboxName = sandboxName;
        log.transports.file.level = 'info';
    }
    
    logStart(operation, context) {
        log.info(`[${this.sandboxName}] Snapshot.${operation}.start`, {
            version: context.version || 'new',
            fileCount: context.fileCount || 0,
            timestamp: new Date().toISOString()
        });
    }
    
    logComplete(operation, context) {
        log.info(`[${this.sandboxName}] Snapshot.${operation}.complete`, {
            version: context.version,
            duration: context.duration,
            fileCount: context.fileCount || 0,
            timestamp: new Date().toISOString()
        });
    }
    
    logError(operation, error, context = {}) {
        log.error(`[${this.sandboxName}] Snapshot.${operation}.error`, {
            version: context.version || 'unknown',
            error: error.message,
            stack: error.stack,
            failurePoint: context.failurePoint || 'unknown',
            fileCount: context.fileCount || 0,
            timestamp: new Date().toISOString()
        });
    }
    
    logRollback(operation, context) {
        log.warn(`[${this.sandboxName}] Snapshot.${operation}.rollback`, {
            version: context.version || 'unknown',
            reason: context.reason,
            timestamp: new Date().toISOString()
        });
    }
    
    logModelDisposal(path) {
        log.debug(`[${this.sandboxName}] Model.dispose`, { path });
    }
}
```

**Files Created**:
- `src/utils/SnapshotLogger.js` (new)

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Import and use logger
- `package.json` - Add electron-log if missing

**Related Requirements**: FR-028, FR-029, FR-030, SC-012

---

#### Task 1.4: Add Storage Quota Validation

**Priority**: P0  
**Estimated Effort**: 0.5 days  
**Dependencies**: Task 1.3 (logging)

**Acceptance Criteria**:
- [ ] Check storage quota before create operations
- [ ] Block operation if quota usage >95%
- [ ] Warn user at 80% usage threshold
- [ ] Handle QuotaExceededError gracefully with rollback
- [ ] Test with simulated quota limits

**Implementation Details**:
```javascript
async checkStorageQuota() {
    try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const {usage, quota} = await navigator.storage.estimate();
            const usagePercent = (usage / quota) * 100;
            
            this.logger.logStart('quotaCheck', {
                usage: Math.round(usage / 1024 / 1024),
                quota: Math.round(quota / 1024 / 1024),
                percent: usagePercent
            });
            
            if (usagePercent >= 80) {
                this.parent.notifications.addToQueue('storageWarning', {
                    usage: Math.round(usage / 1024 / 1024),
                    quota: Math.round(quota / 1024 / 1024),
                    percent: Math.round(usagePercent),
                    severity: usagePercent >= 95 ? 'critical' : 'warning'
                });
            }
            
            return usagePercent < 95;
        }
        return true; // Assume OK if API unavailable
    } catch (error) {
        this.logger.logError('quotaCheck', error);
        return true; // Don't block on check failure
    }
}

async persistSnapshot(snapshot) {
    const canProceed = await this.checkStorageQuota();
    if (!canProceed) {
        throw new Error('Storage quota exceeded - please delete old snapshots');
    }
    
    try {
        const compressed = LZString.compress(JSON.stringify(snapshot));
        localStorage.setItem(this.parent.sandboxName, compressed);
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            this.logger.logError('persistSnapshot', error, {
                failurePoint: 'localStorage.setItem',
                version: snapshot.version
            });
            throw new Error('Storage quota exceeded during save');
        }
        throw error;
    }
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Add methods, update create()

**Related Requirements**: FR-007, FR-020, FR-023, SC-009

---

### Phase 2: User Experience Improvements (P1 - High)

**Goal**: Provide visibility and control over snapshot operations

#### Task 2.1: Implement Progress Tracking

**Priority**: P1  
**Estimated Effort**: 1 day  
**Dependencies**: Task 1.1 (atomic operations)

**Acceptance Criteria**:
- [ ] Define operation stages with weights
- [ ] Emit progress events during create/restore
- [ ] Show percentage and stage name
- [ ] Show item counts (e.g., "15/20 files")
- [ ] Progress resets to 0 at operation start

**Implementation Details**:
```javascript
const SNAPSHOT_STAGES = {
    create: [
        { name: 'Capturing files', weight: 40 },
        { name: 'Compressing data', weight: 20 },
        { name: 'Validating snapshot', weight: 10 },
        { name: 'Saving to storage', weight: 30 }
    ],
    restore: [
        { name: 'Loading snapshot', weight: 10 },
        { name: 'Cleaning up models', weight: 20 },
        { name: 'Restoring files', weight: 50 },
        { name: 'Updating UI', weight: 20 }
    ]
};

class ProgressTracker {
    constructor(operation, parent) {
        this.operation = operation;
        this.parent = parent;
        this.stages = SNAPSHOT_STAGES[operation];
        this.currentStage = 0;
        this.previousWeight = 0;
    }
    
    startStage(stageIndex) {
        this.currentStage = stageIndex;
        this.previousWeight = this.stages
            .slice(0, stageIndex)
            .reduce((sum, s) => sum + s.weight, 0);
        this.updateProgress(0, 1);
    }
    
    updateProgress(itemsDone, itemsTotal) {
        const stage = this.stages[this.currentStage];
        const stageProgress = (itemsDone / itemsTotal) * stage.weight;
        const totalProgress = this.previousWeight + stageProgress;
        
        this.parent.notifications.addToQueue('snapshotProgress', {
            operation: this.operation,
            stage: stage.name,
            percentage: Math.round(totalProgress),
            detail: itemsTotal > 1 ? `${itemsDone}/${itemsTotal}` : null
        });
    }
    
    complete() {
        this.parent.notifications.addToQueue('snapshotProgress', {
            operation: this.operation,
            stage: 'Complete',
            percentage: 100,
            detail: null
        });
    }
}

// Usage in fs.create():
async create(prevVersion = "", tabs = []) {
    const tracker = new ProgressTracker('create', this.parent);
    const startTime = Date.now();
    
    try {
        // Stage 1: Capturing files
        tracker.startStage(0);
        const models = this.parent.listModels();
        const content = [];
        let processed = 0;
        for (const model of models) {
            // ... capture logic ...
            processed++;
            tracker.updateProgress(processed, models.length);
        }
        
        // Stage 2: Compressing data
        tracker.startStage(1);
        const compressed = await this.compressData(content);
        tracker.updateProgress(1, 1);
        
        // ... etc ...
        
        tracker.complete();
    } catch (error) {
        // Error handling
    }
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Add ProgressTracker class and integrate

**Related Requirements**: FR-009, FR-010, FR-011

---

#### Task 2.2: Build Progress UI Component

**Priority**: P1  
**Estimated Effort**: 0.5 days  
**Dependencies**: Task 2.1 (progress tracking)

**Acceptance Criteria**:
- [ ] Create ProgressBar component with Blueprint
- [ ] Subscribe to 'snapshotProgress' notifications
- [ ] Display percentage, stage name, and detail
- [ ] Show at top of editor or in dedicated panel
- [ ] Hide when operation completes or fails

**Implementation Details**:
```jsx
// src/components/editor/SnapshotProgress.jsx (new file)
import React, { useState, useEffect } from 'react';
import { ProgressBar, Callout, Intent } from '@blueprintjs/core';
import virtualFS from '../utils/VirtualFS';

export function SnapshotProgress() {
    const [progress, setProgress] = useState(null);
    
    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe('snapshotProgress', (data) => {
            if (data.percentage === 100) {
                // Hide after 1 second
                setTimeout(() => setProgress(null), 1000);
            } else {
                setProgress(data);
            }
        });
        
        return unsubscribe;
    }, []);
    
    if (!progress) return null;
    
    return (
        <Callout intent={Intent.PRIMARY} className="snapshot-progress">
            <div>{progress.stage}</div>
            <ProgressBar 
                value={progress.percentage / 100} 
                stripes={progress.percentage < 100}
            />
            {progress.detail && <small>{progress.detail}</small>}
        </Callout>
    );
}
```

**Files Created**:
- `src/components/editor/SnapshotProgress.jsx` (new)

**Files Modified**:
- `src/components/editor/EditorPage.jsx` - Import and render SnapshotProgress

**Related Requirements**: FR-011, SC-004, SC-005

---

#### Task 2.3: Implement Snapshot Deletion UI

**Priority**: P1  
**Estimated Effort**: 1 day  
**Dependencies**: Task 1.3 (logging)

**Acceptance Criteria**:
- [ ] Add delete button to each version in version list
- [ ] Disable delete button for current version
- [ ] Show confirmation dialog before deletion
- [ ] Display storage savings in confirmation
- [ ] Update version list after successful deletion
- [ ] Show error if deletion fails

**Implementation Details**:
```javascript
// In VirtualFS.js - Add delete method
fs: {
    // ... existing methods ...
    
    async deleteSnapshot(version) {
        const startTime = Date.now();
        
        try {
            // Prevent deleting current version
            if (version === this.version_current) {
                throw new Error('Cannot delete currently active snapshot');
            }
            
            this.logger.logStart('deleteSnapshot', { version });
            
            // Remove from in-memory versions
            if (!this.versions[version]) {
                throw new Error(`Snapshot ${version} not found`);
            }
            
            delete this.versions[version];
            
            // Update latest pointer if needed
            if (this.version_latest === version) {
                const remaining = Object.keys(this.versions);
                this.version_latest = remaining.length > 0 
                    ? remaining[remaining.length - 1] 
                    : 0;
            }
            
            // Persist to localStorage
            const sandboxFs = localStorage.getItem(this.parent.sandboxName);
            if (sandboxFs) {
                const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                delete unpacked.versions[version];
                unpacked.version_latest = this.version_latest;
                localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
            }
            
            // Notify UI
            this.parent.notifications.addToQueue('treeVersionsUpdate', this.__list());
            this.parent.notifications.addToQueue('snapshotDeleted', { version });
            
            this.logger.logComplete('deleteSnapshot', {
                version,
                duration: Date.now() - startTime
            });
            
        } catch (error) {
            this.logger.logError('deleteSnapshot', error, { version });
            throw error;
        }
    }
}

// In EditorPage.jsx or version list component:
function VersionListItem({ version, isCurrent, onDelete }) {
    const [showConfirm, setShowConfirm] = useState(false);
    
    const handleDelete = () => {
        setShowConfirm(true);
    };
    
    const confirmDelete = async () => {
        try {
            await virtualFS.fs.deleteSnapshot(version.version);
            setShowConfirm(false);
        } catch (error) {
            // Show error toast
            showToast('error', error.message);
        }
    };
    
    return (
        <>
            <div className="version-item">
                <span className="version-date">
                    {new Date(version.date).toLocaleString()}
                </span>
                {isCurrent && <Tag intent="success">Current</Tag>}
                <Button
                    icon="trash"
                    minimal
                    small
                    disabled={isCurrent}
                    onClick={handleDelete}
                    title={isCurrent ? "Cannot delete current version" : "Delete snapshot"}
                />
            </div>
            
            <Alert
                isOpen={showConfirm}
                cancelButtonText="Cancel"
                confirmButtonText="Delete"
                intent="danger"
                onCancel={() => setShowConfirm(false)}
                onConfirm={confirmDelete}
            >
                <p>Delete snapshot from {new Date(version.date).toLocaleString()}?</p>
                <p>This action cannot be undone.</p>
            </Alert>
        </>
    );
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Add deleteSnapshot method
- `src/components/editor/EditorPage.jsx` - Update version list UI

**Related Requirements**: FR-022, FR-024, FR-025, FR-026

---

#### Task 2.4: Implement Storage Warning UI

**Priority**: P1  
**Estimated Effort**: 0.5 days  
**Dependencies**: Task 1.4 (quota validation)

**Acceptance Criteria**:
- [ ] Listen for 'storageWarning' notifications
- [ ] Show non-blocking toast at 80% usage
- [ ] Show blocking dialog at 95% usage
- [ ] Provide direct link to version list/delete UI
- [ ] Display usage in MB and percentage

**Implementation Details**:
```jsx
// In EditorPage or main app component:
useEffect(() => {
    const unsubscribe = virtualFS.notifications.subscribe('storageWarning', (data) => {
        if (data.severity === 'critical') {
            // Blocking dialog
            showDialog({
                title: 'Storage Almost Full',
                message: `Browser storage is at ${data.percent}% (${data.usage}MB / ${data.quota}MB)`,
                detail: 'Delete old snapshots to free up space before creating new ones.',
                intent: 'danger',
                buttons: ['Manage Snapshots', 'Cancel'],
                callback: (response) => {
                    if (response === 0) {
                        // Navigate to version list
                        setShowVersionPanel(true);
                    }
                }
            });
        } else {
            // Warning toast
            showToast('warning', 
                `Storage at ${data.percent}% - Consider deleting old snapshots`,
                { duration: 5000 }
            );
        }
    });
    
    return unsubscribe;
}, []);
```

**Files Modified**:
- `src/components/editor/EditorPage.jsx` - Add storage warning listener

**Related Requirements**: FR-023, FR-025, SC-009

---

### Phase 3: Multi-Window Synchronization (P1 - High)

**Goal**: Enable consistent behavior across multiple editor windows

#### Task 3.1: Implement localStorage Event Listener

**Priority**: P1  
**Estimated Effort**: 1 day  
**Dependencies**: Task 1.1 (atomic operations)

**Acceptance Criteria**:
- [ ] Register storage event listener on VirtualFS init
- [ ] Detect changes to sandboxName key
- [ ] Parse and validate external changes
- [ ] Update version list UI when external changes detected
- [ ] Handle current version deletion by another window
- [ ] Test with 2 windows performing operations

**Implementation Details**:
```javascript
// In VirtualFS.js init or EditorPage mount:
setupMultiWindowSync() {
    window.addEventListener('storage', (e) => {
        // Only handle changes to our sandbox
        if (e.key !== this.sandboxName) return;
        
        // Ignore changes we made ourselves (oldValue === null on our writes)
        if (e.newValue === null) return;
        
        try {
            const externalData = JSON.parse(LZString.decompress(e.newValue));
            this.handleExternalChange(externalData);
        } catch (error) {
            this.logger.logError('multiWindowSync', error, {
                failurePoint: 'parseExternalChange'
            });
        }
    });
}

handleExternalChange(externalData) {
    this.logger.logStart('handleExternalChange', {
        externalLatest: externalData.version_latest,
        externalCurrent: externalData.version_current,
        localLatest: this.version_latest,
        localCurrent: this.version_current
    });
    
    // Update our in-memory state (last-write-wins)
    this.versions = externalData.versions;
    this.version_latest = externalData.version_latest;
    
    // Check if our current version was deleted
    if (!this.versions[this.version_current]) {
        this.handleCurrentVersionDeleted();
    } else if (this.version_current !== externalData.version_current) {
        // Current pointer changed externally, update UI indicator
        this.version_current = externalData.version_current;
    }
    
    // Refresh version list UI
    this.parent.notifications.addToQueue('treeVersionsUpdate', this.__list());
    
    this.logger.logComplete('handleExternalChange', {
        newCurrent: this.version_current
    });
}

handleCurrentVersionDeleted() {
    this.logger.logStart('handleCurrentVersionDeleted', {
        deletedVersion: this.version_current
    });
    
    // Option 1: Switch to latest version (if exists)
    if (Object.keys(this.versions).length > 0) {
        this.version_current = this.version_latest;
        this.parent.notifications.addToQueue('snapshotExternalChange', {
            message: 'Current snapshot was deleted in another window. Switched to latest version.',
            severity: 'warning'
        });
    } else {
        // Option 2: No versions left, maintain current editor state
        this.version_current = 0;
        this.parent.notifications.addToQueue('snapshotExternalChange', {
            message: 'All snapshots were deleted in another window. Current editor state preserved.',
            severity: 'warning'
        });
    }
}
```

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` - Add sync methods, call in init

**Related Requirements**: FR-031, FR-032, FR-033, FR-034, SC-013, SC-014

---

### Phase 4: Testing & Validation (P1 - High)

**Goal**: Ensure reliability and performance meet success criteria

#### Task 4.1: Unit Tests for Core Operations

**Priority**: P1  
**Estimated Effort**: 1 day  
**Dependencies**: All previous tasks

**Acceptance Criteria**:
- [ ] Test create() with 0, 1, 5, 20, 50 files
- [ ] Test set() with valid/invalid version IDs
- [ ] Test deleteSnapshot() edge cases
- [ ] Test rollback on failures
- [ ] Test Monaco model lifecycle
- [ ] Test compression/decompression roundtrip
- [ ] 80%+ code coverage on VirtualFS.js

**Test Framework**: Jest (likely already in project)

**Files Created**:
- `tests/unit/VirtualFS.test.js` (new)

**Related Requirements**: All FR-* requirements

---

#### Task 4.2: Integration Tests for Multi-Window

**Priority**: P1  
**Estimated Effort**: 1 day  
**Dependencies**: Task 3.1 (multi-window sync)

**Acceptance Criteria**:
- [ ] Test simultaneous create from 2 windows
- [ ] Test delete in one window, verify update in another
- [ ] Test restore in one window, verify current pointer in another
- [ ] Verify last-write-wins behavior
- [ ] Verify <2 second sync latency (SC-013)

**Files Created**:
- `tests/integration/multi-window.test.js` (new)

**Related Requirements**: FR-031, FR-032, FR-033, FR-034, SC-013, SC-014

---

#### Task 4.3: Performance Testing

**Priority**: P1  
**Estimated Effort**: 0.5 days  
**Dependencies**: All implementation tasks

**Acceptance Criteria**:
- [ ] Verify create <2s for 20 files/5MB (SC-004)
- [ ] Verify restore <3s for 20 files/5MB (SC-005)
- [ ] Verify memory stability over 10 ops (SC-006)
- [ ] Verify compression ratio ≥50% (SC-007)
- [ ] Document performance results

**Files Created**:
- `tests/performance/snapshot-benchmarks.js` (new)

**Related Requirements**: SC-004, SC-005, SC-006, SC-007

---

## Risk Mitigation Strategies

### High Risk: Data Corruption

**Risk**: Bugs in atomic operations could corrupt all snapshots

**Mitigation**:
1. Extensive unit tests before integration testing
2. Manual backup of localStorage before testing
3. Phased rollout (test environment → staging → production)
4. Keep old code path as fallback (feature flag)

**Detection**: Automated tests + manual QA with real projects

### Medium Risk: Performance Regression

**Risk**: Additional validation/logging slows operations beyond targets

**Mitigation**:
1. Performance benchmarks run on every test
2. Web Worker compression for large files
3. Throttled progress updates (max 20/sec)

**Detection**: Automated performance tests fail if targets missed

### Medium Risk: Multi-Window Race Conditions

**Risk**: Edge cases in last-write-wins cause unexpected behavior

**Mitigation**:
1. Comprehensive integration tests for all scenarios
2. User documentation about multi-window limitations
3. Logging to diagnose issues in production

**Detection**: Multi-window integration test suite

## Rollout Plan

### Stage 1: Development & Unit Testing (Days 1-4)
- Implement all Phase 1 & 2 tasks
- Unit test coverage ≥80%
- Code review by team

### Stage 2: Integration Testing (Day 5)
- Multi-window testing
- Performance validation
- Memory leak testing
- Bug fixes

### Stage 3: Internal QA (Day 6)
- Manual testing with real plugin projects
- Edge case exploration
- User acceptance testing

### Stage 4: Production Deployment (Day 7)
- Merge to main branch
- Deploy to users
- Monitor logs for issues
- Hotfix process ready

## Success Criteria Validation

| Criterion | Target | Validation Method |
|-----------|--------|-------------------|
| SC-001 | 100% success for ≤50 files | Unit tests + manual QA |
| SC-002 | 100% restoration fidelity | Automated diff comparison |
| SC-003 | 20+ consecutive operations | Automated stress test |
| SC-004 | Create <2s (20 files/5MB) | Performance benchmarks |
| SC-005 | Restore <3s (20 files/5MB) | Performance benchmarks |
| SC-006 | Stable memory over 10 ops | Memory profiler |
| SC-007 | ≥50% compression ratio | Compression tests |
| SC-008 | 100% accurate version list | UI integration tests |
| SC-009 | 100% graceful quota errors | Error simulation tests |
| SC-010 | Rapid switching no errors | Automated rapid-fire test |
| SC-011 | Zero unusable states | Full test suite + QA |
| SC-012 | Diagnostic logs complete | Log output inspection |
| SC-013 | Multi-window sync <2s | Multi-window tests |
| SC-014 | No corruption on simultaneous ops | Race condition tests |

## Dependencies & Blockers

### External Dependencies

| Dependency | Status | Action Required |
|------------|--------|-----------------|
| electron-log | ⚠️ **Verify** | Check package.json, add if missing |
| Blueprint components | ✅ Confirmed | None |
| Jest test framework | ⚠️ **Verify** | Check if tests exist, add if needed |

### Team Dependencies

- **Code Review**: Need 1-2 reviewers familiar with VirtualFS
- **QA Resources**: Need manual testing on Day 6
- **Documentation**: Update user docs after deployment

### Potential Blockers

1. ⚠️ **electron-log missing**: 2-hour delay to add and configure
2. ⚠️ **No test infrastructure**: 1-day delay to set up Jest
3. ⚠️ **Monaco API changes**: Requires research if version mismatch

## Monitoring & Observability

### Key Metrics to Track

1. **Snapshot operation success rate**: Should be 100%
2. **Average operation duration**: Should meet SC-004/SC-005 targets
3. **Storage quota warnings**: Track frequency
4. **Rollback occurrences**: Should be rare, investigate each
5. **Multi-window sync events**: Track frequency and latency

### Log Analysis Queries

```javascript
// Find all snapshot failures
grep "Snapshot.*.error" app.log

// Find operations exceeding time targets
grep "duration.*[3-9][0-9][0-9][0-9]" app.log // >3000ms

// Find rollback occurrences
grep "rollback" app.log

// Find storage quota warnings
grep "storageWarning" app.log
```

### Alerts to Configure

1. **Critical**: Snapshot success rate <99% in 24 hours
2. **Warning**: Average duration >2.5s for create, >3.5s for restore
3. **Info**: Storage warnings triggered >10 times/day

## Documentation Requirements

### Code Documentation

- [ ] JSDoc comments for all new methods
- [ ] Architecture decision records in research.md
- [ ] Inline comments for complex logic (rollback, multi-window)

### User Documentation

- [ ] How to create/restore snapshots (likely already exists)
- [ ] How to manage storage and delete old snapshots
- [ ] Multi-window behavior and limitations
- [ ] Troubleshooting guide for common errors

### Developer Documentation

- [ ] Update contracts/snapshot-operations-api.md with implementation notes
- [ ] Add testing guide to tests/README.md
- [ ] Document logging format and queries

## Appendix: Task Dependencies Graph

```
Phase 1 (Core):
  1.1 (Atomic) ──┬──> 2.1 (Progress)
                 └──> 3.1 (Multi-Window)
  
  1.2 (Monaco) ───────> 4.1 (Unit Tests)
  
  1.3 (Logging) ──┬──> 1.4 (Quota)
                  ├──> 2.3 (Deletion)
                  └──> 3.1 (Multi-Window)
  
  1.4 (Quota) ────────> 2.4 (Storage Warnings)

Phase 2 (UX):
  2.1 (Progress) ─────> 2.2 (Progress UI)
  
  2.3 (Deletion) ─────> 4.1 (Unit Tests)
  
  2.4 (Warnings) ─────> 4.1 (Unit Tests)

Phase 3 (Multi-Window):
  3.1 (Sync) ─────────> 4.2 (Integration Tests)

Phase 4 (Testing):
  All Previous ───────> 4.3 (Performance Tests)
```

## Conclusion

This plan provides a comprehensive roadmap to fix all identified VirtualFS snapshot issues while maintaining backward compatibility and improving user experience. The phased approach allows for incremental progress with early validation of core reliability before adding UX enhancements.

**Estimated Total Effort**: 5-7 developer days  
**Risk Level**: Medium (mitigated by extensive testing)  
**Success Probability**: High (well-understood problem domain, clear requirements)

**Next Step**: Begin implementation with Task 1.1 (Atomic Transaction Pattern)
