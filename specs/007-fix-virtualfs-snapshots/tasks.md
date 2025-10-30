# Tasks: VirtualFS Snapshot Fix

**Status**: Ready for Implementation  
**Created**: October 28, 2025  
**Branch**: `007-fix-virtualfs-snapshots`

## Task Overview

**Total Tasks**: 13  
**Estimated Effort**: 5-7 days  
**Priority Breakdown**: P0 (4 tasks), P1 (9 tasks)

---

## Phase 1: Core Reliability Fixes (P0)

### Task 1.1: Implement Atomic Transaction Pattern

**ID**: VFSSNAP-001  
**Priority**: P0 (Critical)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: None

**Description**:
Implement snapshot-before-modify pattern with rollback capability to ensure atomic operations. Prevents partial writes and data corruption.

**Acceptance Criteria**:
- [ ] Create `captureCurrentState()` method to snapshot state before operations
- [ ] Wrap `fs.create()` in try-catch with rollback on failure
- [ ] Wrap `fs.set()` in try-catch with rollback on failure
- [ ] Implement `rollback()` method to restore previous state
- [ ] Create `AtomicOperationError` class for operation failures
- [ ] Validate that partial writes never persist to localStorage
- [ ] Test rollback with induced failures at each operation step (file capture, compression, storage)
- [ ] Verify in-memory state matches localStorage after rollback

**Related Requirements**: FR-016, FR-017, FR-018, FR-019

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`

**Implementation Notes**:
- Backup includes: versions object, version pointers, localStorage snapshot
- Rollback should emit notification to inform user
- Use lodash `cloneDeep` for in-memory state backup

---

### Task 1.2: Fix Monaco Model Disposal

**ID**: VFSSNAP-002  
**Priority**: P0 (Critical)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: None

**Description**:
Fix model disposal errors by adding proper validation and cleanup sequence. Prevents "model already disposed" errors and orphaned markers.

**Acceptance Criteria**:
- [ ] Create `safeDisposeModel(path)` method with validation
- [ ] Check `model.isDisposed()` before all disposal operations
- [ ] Clear TypeScript/JSX markers before model disposal
- [ ] Clear TypeScript extra libs before model disposal
- [ ] Wrap all disposal operations in try-catch with logging
- [ ] Update `fs.set()` to use safe disposal method
- [ ] Verify no "model already disposed" errors in test suite
- [ ] Verify no orphaned markers remain after restoration

**Related Requirements**: FR-004, FR-005, FR-006, FR-007

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js` (fs.set method)

**Implementation Notes**:
- Always clear markers for .ts/.tsx files
- Log disposal failures but don't block restoration
- Clean up `this.parent.files` tracking

---

### Task 1.3: Implement Error Logging Infrastructure

**ID**: VFSSNAP-003  
**Priority**: P0 (Critical)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: Verify electron-log in package.json

**Description**:
Set up structured logging with electron-log for all snapshot operations. Enables debugging of production issues.

**Acceptance Criteria**:
- [ ] Verify electron-log is installed (check package.json)
- [ ] Add electron-log to dependencies if missing
- [ ] Create `src/utils/SnapshotLogger.js` class
- [ ] Implement `logStart()`, `logComplete()`, `logError()`, `logRollback()` methods
- [ ] Include version IDs, timestamps, context in all log entries
- [ ] Configure electron-log file transport to 'info' level
- [ ] Add logger instance to VirtualFS.fs object
- [ ] Integrate logging into create/set/delete operations
- [ ] Verify logs written to expected file location
- [ ] Document log format and example queries

**Related Requirements**: FR-028, FR-029, FR-030, SC-012

**Files Created**:
- `src/utils/SnapshotLogger.js`

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`
- `package.json` (if electron-log missing)

**Implementation Notes**:
- Log format: `[sandboxName] Snapshot.{operation}.{event}`
- Include fileCount, duration, error context
- Use log.transports.file.level configuration

---

### Task 1.4: Add Storage Quota Validation

**ID**: VFSSNAP-004  
**Priority**: P0 (Critical)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-003 (logging)

**Description**:
Implement proactive storage quota checking to prevent silent failures and provide user warnings.

**Acceptance Criteria**:
- [ ] Create `checkStorageQuota()` async method
- [ ] Use navigator.storage.estimate() API
- [ ] Block operations if quota usage >95%
- [ ] Emit 'storageWarning' notification at 80% threshold
- [ ] Emit 'storageWarning' with 'critical' severity at 95%
- [ ] Call quota check before all create() operations
- [ ] Handle QuotaExceededError in persistSnapshot() with rollback
- [ ] Test with simulated quota limits (mock navigator.storage)
- [ ] Verify graceful degradation if storage API unavailable

**Related Requirements**: FR-007, FR-020, FR-023, SC-009

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`

**Implementation Notes**:
- Return boolean: can proceed with operation
- Don't block on check failure (log warning, allow proceed)
- Include usage/quota in MB in notifications

---

## Phase 2: User Experience Improvements (P1)

### Task 2.1: Implement Progress Tracking

**ID**: VFSSNAP-005  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-001 (atomic operations)

**Description**:
Add stage-based progress tracking with percentage and detail information for create/restore operations.

**Acceptance Criteria**:
- [ ] Define SNAPSHOT_STAGES constant with weights for create/restore
- [ ] Create `ProgressTracker` class
- [ ] Implement `startStage()`, `updateProgress()`, `complete()` methods
- [ ] Emit 'snapshotProgress' notifications with percentage, stage, detail
- [ ] Integrate progress tracking into `fs.create()` method
- [ ] Integrate progress tracking into `fs.set()` method
- [ ] Show file counts in detail (e.g., "15/20 files")
- [ ] Reset progress to 0 at operation start
- [ ] Test progress events emitted in correct sequence
- [ ] Verify progress reaches 100% on completion

**Related Requirements**: FR-009, FR-010, FR-011

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`

**Implementation Notes**:
- Create stages: Capturing(40%), Compressing(20%), Validating(10%), Saving(30%)
- Restore stages: Loading(10%), Cleaning(20%), Restoring(50%), Updating(20%)
- Throttle notifications if needed (max 20/sec)

---

### Task 2.2: Build Progress UI Component

**ID**: VFSSNAP-006  
**Priority**: P1 (High)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-005 (progress tracking)

**Description**:
Create React component to display snapshot operation progress with Blueprint ProgressBar.

**Acceptance Criteria**:
- [ ] Create `src/components/editor/SnapshotProgress.jsx` component
- [ ] Subscribe to 'snapshotProgress' notifications in useEffect
- [ ] Display ProgressBar with percentage value
- [ ] Show stage name above progress bar
- [ ] Show detail text (file counts) below progress bar
- [ ] Use Blueprint Callout with PRIMARY intent
- [ ] Auto-hide 1 second after 100% completion
- [ ] Handle null/undefined progress gracefully
- [ ] Import and render in EditorPage.jsx
- [ ] Style appropriately (non-intrusive, visible)

**Related Requirements**: FR-011, SC-004, SC-005

**Files Created**:
- `src/components/editor/SnapshotProgress.jsx`

**Files Affected**:
- `src/components/editor/EditorPage.jsx`

**Implementation Notes**:
- Use Blueprint ProgressBar, Callout, Intent components
- Position at top of editor or in dedicated panel
- Add CSS for snapshot-progress class

---

### Task 2.3: Implement Snapshot Deletion UI

**ID**: VFSSNAP-007  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-003 (logging)

**Description**:
Add UI for users to manually delete snapshots with confirmation dialog and safety checks.

**Acceptance Criteria**:
- [ ] Add `deleteSnapshot(version)` method to VirtualFS.fs
- [ ] Prevent deletion of currently active snapshot
- [ ] Validate snapshot exists before deletion
- [ ] Update version_latest pointer if deleted
- [ ] Persist deletion to localStorage
- [ ] Emit 'treeVersionsUpdate' notification after deletion
- [ ] Emit 'snapshotDeleted' notification with version
- [ ] Add delete button to each version in version list UI
- [ ] Disable delete button for current version
- [ ] Show Blueprint Alert confirmation dialog
- [ ] Display timestamp and "cannot undo" warning in dialog
- [ ] Handle deletion errors with toast notification
- [ ] Test edge cases: delete last version, delete version in chain

**Related Requirements**: FR-022, FR-024, FR-025, FR-026

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`
- `src/components/editor/EditorPage.jsx` (or version list component)

**Implementation Notes**:
- Use Blueprint Button (icon="trash", minimal, small)
- Use Blueprint Alert for confirmation
- Log deletion operations for audit trail

---

### Task 2.4: Implement Storage Warning UI

**ID**: VFSSNAP-008  
**Priority**: P1 (High)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-004 (quota validation)

**Description**:
Display user-friendly warnings when storage quota is approaching limits.

**Acceptance Criteria**:
- [ ] Subscribe to 'storageWarning' notifications in EditorPage
- [ ] Show non-blocking toast at 80% usage (warning severity)
- [ ] Show blocking dialog at 95% usage (critical severity)
- [ ] Include usage in MB, quota in MB, and percentage in message
- [ ] Provide "Manage Snapshots" button in critical dialog
- [ ] Link to version list panel for snapshot management
- [ ] Toast should auto-dismiss after 5 seconds
- [ ] Dialog should block until user acknowledges
- [ ] Test both warning and critical flows
- [ ] Verify clear, actionable messaging

**Related Requirements**: FR-023, FR-025, SC-009

**Files Affected**:
- `src/components/editor/EditorPage.jsx`

**Implementation Notes**:
- Use Blueprint Toast for warnings
- Use Blueprint Dialog/Alert for critical
- Format: "Storage at 85% (42MB / 50MB)"

---

## Phase 3: Multi-Window Synchronization (P1)

### Task 3.1: Implement localStorage Event Listener

**ID**: VFSSNAP-009  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-001 (atomic operations), VFSSNAP-003 (logging)

**Description**:
Enable multi-window synchronization using localStorage 'storage' events with last-write-wins conflict resolution.

**Acceptance Criteria**:
- [ ] Create `setupMultiWindowSync()` method
- [ ] Register window 'storage' event listener
- [ ] Filter events to match sandboxName key only
- [ ] Ignore events from current window (oldValue === null)
- [ ] Parse and decompress external localStorage changes
- [ ] Implement `handleExternalChange(externalData)` method
- [ ] Update local versions object with external data (last-write-wins)
- [ ] Update version_latest and version_current pointers
- [ ] Emit 'treeVersionsUpdate' notification on external changes
- [ ] Implement `handleCurrentVersionDeleted()` method
- [ ] Switch to latest version if current deleted externally
- [ ] Emit 'snapshotExternalChange' notification with warning
- [ ] Test with 2 windows: create, delete, restore operations
- [ ] Verify <2 second sync latency (SC-013)
- [ ] Verify no data corruption on simultaneous operations (SC-014)

**Related Requirements**: FR-031, FR-032, FR-033, FR-034, SC-013, SC-014

**Files Affected**:
- `src/components/editor/utils/VirtualFS.js`

**Implementation Notes**:
- Call setupMultiWindowSync() in VirtualFS init or EditorPage mount
- Log all external change events for debugging
- Handle JSON parse errors gracefully

---

## Phase 4: Testing & Validation (P1)

### Task 4.1: Unit Tests for Core Operations

**ID**: VFSSNAP-010  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-001, VFSSNAP-002, VFSSNAP-003, VFSSNAP-004

**Description**:
Create comprehensive unit test suite for all VirtualFS snapshot operations.

**Acceptance Criteria**:
- [ ] Set up Jest test environment (if not exists)
- [ ] Create test file: `tests/unit/VirtualFS.test.js`
- [ ] Mock localStorage, Monaco editor, notifications
- [ ] Test `fs.create()` with 0, 1, 5, 20, 50 file scenarios
- [ ] Test `fs.set()` with valid and invalid version IDs
- [ ] Test `fs.deleteSnapshot()` edge cases (current, non-existent, last)
- [ ] Test rollback on create() failure
- [ ] Test rollback on set() failure
- [ ] Test Monaco model disposal sequence
- [ ] Test compression/decompression roundtrip
- [ ] Test storage quota checking logic
- [ ] Achieve ≥80% code coverage on VirtualFS.fs methods
- [ ] All tests passing in CI

**Related Requirements**: All FR-* requirements

**Files Created**:
- `tests/unit/VirtualFS.test.js`

**Implementation Notes**:
- Use jest.mock() for external dependencies
- Test both success and failure paths
- Verify notification emissions
- Check localStorage state after operations

---

### Task 4.2: Integration Tests for Multi-Window

**ID**: VFSSNAP-011  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: TBD  
**Dependencies**: VFSSNAP-009 (multi-window sync)

**Description**:
Create integration tests simulating multi-window scenarios and verifying synchronization.

**Acceptance Criteria**:
- [ ] Create test file: `tests/integration/multi-window.test.js`
- [ ] Simulate 2 browser contexts/windows
- [ ] Test simultaneous create() from both windows
- [ ] Verify both snapshots created without corruption
- [ ] Test delete in window A, verify version list update in window B
- [ ] Test restore in window A, verify current pointer in window B
- [ ] Test rapid operations (<1 sec apart) from both windows
- [ ] Verify last-write-wins behavior on conflicts
- [ ] Measure sync latency, verify <2 seconds (SC-013)
- [ ] Verify data integrity after all multi-window tests (SC-014)
- [ ] All tests passing consistently (no flaky tests)

**Related Requirements**: FR-031, FR-032, FR-033, FR-034, SC-013, SC-014

**Files Created**:
- `tests/integration/multi-window.test.js`

**Implementation Notes**:
- May need Playwright or Puppeteer for multi-window simulation
- Simulate localStorage 'storage' events programmatically
- Add timing assertions for sync latency

---

### Task 4.3: Performance Testing

**ID**: VFSSNAP-012  
**Priority**: P1 (High)  
**Estimated Effort**: 0.5 days  
**Assignee**: TBD  
**Dependencies**: All implementation tasks complete

**Description**:
Validate that snapshot operations meet performance success criteria.

**Acceptance Criteria**:
- [ ] Create test file: `tests/performance/snapshot-benchmarks.js`
- [ ] Generate test projects: 5, 10, 20, 50 files with varied content sizes
- [ ] Measure create() duration for each project size
- [ ] Verify create <2 seconds for 20 files/5MB (SC-004)
- [ ] Measure restore() duration for each project size
- [ ] Verify restore <3 seconds for 20 files/5MB (SC-005)
- [ ] Measure memory usage before/after 10 consecutive operations
- [ ] Verify no continuous memory growth (SC-006)
- [ ] Calculate actual compression ratios achieved
- [ ] Verify ≥50% compression ratio (SC-007)
- [ ] Document all performance results
- [ ] Flag any regressions or areas needing optimization

**Related Requirements**: SC-004, SC-005, SC-006, SC-007

**Files Created**:
- `tests/performance/snapshot-benchmarks.js`
- `specs/007-fix-virtualfs-snapshots/performance-results.md`

**Implementation Notes**:
- Use performance.now() for precise timing
- Use performance.memory (Chrome) for memory tracking
- Run benchmarks multiple times, report average
- Consider using benchmark.js library

---

### Task 4.4: Manual QA Testing

**ID**: VFSSNAP-013  
**Priority**: P1 (High)  
**Estimated Effort**: 1 day  
**Assignee**: QA Team  
**Dependencies**: All implementation and automated tests complete

**Description**:
Perform manual exploratory testing with real plugin projects to validate end-to-end user experience.

**Acceptance Criteria**:
- [ ] Test with small project (5 files, <1MB)
- [ ] Test with medium project (20 files, ~5MB)
- [ ] Test with large project (50 files, ~10MB)
- [ ] Create multiple snapshots in each project
- [ ] Restore various snapshots, verify exact state reconstruction
- [ ] Test snapshot deletion workflow
- [ ] Trigger storage warnings by filling quota
- [ ] Test multi-window scenarios manually
- [ ] Test error scenarios (simulate failures)
- [ ] Verify progress bars display correctly
- [ ] Verify all error messages are clear and helpful
- [ ] Document any bugs or UX issues found
- [ ] All critical bugs fixed before sign-off

**Related Requirements**: All user scenarios from spec.md

**Files Created**:
- `specs/007-fix-virtualfs-snapshots/qa-test-report.md`

**Implementation Notes**:
- Use real plugin projects from team members
- Test on different OS (macOS, Windows, Linux)
- Test in different Electron versions if applicable
- Document steps to reproduce any issues

---

## Task Summary by Phase

### Phase 1: Core Reliability (4 tasks, ~2.5 days)
1. VFSSNAP-001: Atomic transactions
2. VFSSNAP-002: Monaco disposal fixes
3. VFSSNAP-003: Logging infrastructure
4. VFSSNAP-004: Storage quota validation

### Phase 2: UX Improvements (4 tasks, ~3 days)
5. VFSSNAP-005: Progress tracking
6. VFSSNAP-006: Progress UI component
7. VFSSNAP-007: Snapshot deletion UI
8. VFSSNAP-008: Storage warning UI

### Phase 3: Multi-Window (1 task, ~1 day)
9. VFSSNAP-009: localStorage sync

### Phase 4: Testing (4 tasks, ~3.5 days)
10. VFSSNAP-010: Unit tests
11. VFSSNAP-011: Integration tests
12. VFSSNAP-012: Performance tests
13. VFSSNAP-013: Manual QA

---

## Progress Tracking

| Phase | Tasks Complete | Total Tasks | Status |
|-------|----------------|-------------|--------|
| Phase 1 | 0 | 4 | Not Started |
| Phase 2 | 0 | 4 | Not Started |
| Phase 3 | 0 | 1 | Not Started |
| Phase 4 | 0 | 4 | Not Started |
| **Total** | **0** | **13** | **0%** |

---

## Quick Start Guide

**To begin implementation**:

1. Start with Task VFSSNAP-001 (Atomic Transactions) - foundation for all other work
2. Complete all Phase 1 tasks before moving to Phase 2 (ensures reliability first)
3. Phase 2 and 3 can run in parallel if multiple developers available
4. Phase 4 runs after implementation complete

**Daily standup questions**:
- Which task(s) are you working on today?
- Any blockers or dependencies waiting?
- Which task(s) will you complete today?

**Definition of Done** (for each task):
- [ ] Code implemented and self-reviewed
- [ ] Unit tests written and passing
- [ ] Code reviewed by peer
- [ ] Acceptance criteria verified
- [ ] Documentation updated
- [ ] Task marked complete in tracking system
