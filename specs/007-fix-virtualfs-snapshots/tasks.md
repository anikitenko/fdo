# Tasks: VirtualFS Snapshot Fix

**Feature**: VirtualFS Snapshot Creation and Restoration Fix  
**Branch**: `007-fix-virtualfs-snapshots`  
**Generated**: October 28, 2025

## Overview

This tasks file organizes implementation work by user story to enable independent, incremental delivery. Each user story can be implemented and tested independently, allowing for parallel development and early value delivery.

**Total Tasks**: 28  
**User Stories**: 3 (2 P1, 1 P2)  
**Estimated Effort**: 10-12 days

---

## Task Format

All tasks follow this strict format:
```
- [ ] [TaskID] [Markers] Description with file path
```

**Markers**:
- `[P]` - Parallelizable (can run simultaneously with other [P] tasks in same phase)
- `[US1]`, `[US2]`, `[US3]` - User Story labels (for story-specific tasks)

---

## Phase 1: Setup & Infrastructure (Days 1-2)

**Goal**: Establish foundational infrastructure required by all user stories

**Independent Test Criteria**: 
- ✅ electron-log configured and writing to file
- ✅ SnapshotLogger class can be imported
- ✅ Test infrastructure (Jest) runs successfully

### Setup Tasks

- [x] T001 Verify electron-log dependency in package.json, add if missing (npm install --save electron-log)
- [x] T002 [P] Create SnapshotLogger class in src/utils/SnapshotLogger.js with logStart, logComplete, logError, logRollback methods
- [x] T003 [P] Configure Jest test environment if not present, create tests/ directory structure
- [x] T004 Import SnapshotLogger into src/components/editor/utils/VirtualFS.js and initialize logger in fs object

**Deliverable**: Logging infrastructure ready for use across all user stories

---

## Phase 2: Foundational Reliability (Days 3-4)

**Goal**: Implement atomic transaction pattern and error handling - blocking prerequisites for all user stories

**Independent Test Criteria**:
- ✅ captureCurrentState() and rollback() methods exist
- ✅ All fs operations wrapped in try-catch
- ✅ Rollback test passes (induced failure restores state)

### Foundational Tasks

- [x] T005 Create captureCurrentState() method in VirtualFS.fs to snapshot in-memory state and localStorage
- [x] T006 Create AtomicOperationError class in src/components/editor/utils/VirtualFS.js
- [x] T007 Implement rollback(backupState) method in VirtualFS.fs to restore previous state
- [x] T008 [P] Create checkStorageQuota() async method using navigator.storage.estimate() API
- [x] T009 [P] Implement safeDisposeModel(path) method with isDisposed() validation and marker cleanup
- [x] T010 Update fs.set() to use safeDisposeModel for all model cleanup operations

**Deliverable**: Core reliability infrastructure (atomic operations, safe disposal, quota checking)

---

## Phase 3: User Story 1 - Reliable Snapshot Creation (Days 5-7) [P1]

**User Story**: A developer working on a plugin creates a snapshot to save current work state. System reliably captures all file contents, editor states, and metadata without data loss or corruption.

**Independent Test Criteria**:
- ✅ Create snapshot with 5 files, verify all contents captured
- ✅ Create snapshot with syntax errors, completes successfully
- ✅ Rapid succession snapshots (3 within 1 second) all succeed
- ✅ Storage nearly full: clear error message, no partial data
- ✅ Induced failure: rollback confirmation displayed to user

### US1: Implementation Tasks

- [ ] T011 [US1] Wrap fs.create() in try-catch with rollback on failure in src/components/editor/utils/VirtualFS.js
- [ ] T012 [P] [US1] Create ProgressTracker class with startStage, updateProgress, complete methods
- [ ] T013 [P] [US1] Define SNAPSHOT_STAGES constant with create stages (Capturing 40%, Compressing 20%, Validating 10%, Saving 30%)
- [ ] T014 [US1] Integrate ProgressTracker into fs.create() method with stage-based progress emissions
- [ ] T015 [US1] Add checkStorageQuota() call before fs.create() operations, block if >95%
- [ ] T016 [US1] Implement persistSnapshot() with QuotaExceededError handling and rollback
- [ ] T017 [P] [US1] Add logStart, logComplete, logError calls throughout fs.create() method

### US1: UI Tasks

- [ ] T018 [P] [US1] Create SnapshotProgress.jsx component with Blueprint ProgressBar in src/components/editor/
- [ ] T019 [US1] Subscribe to 'snapshotProgress' notifications in SnapshotProgress component
- [ ] T020 [US1] Import and render SnapshotProgress component in src/components/editor/EditorPage.jsx

### US1: Testing Tasks

- [ ] T021 [P] [US1] Create tests/unit/VirtualFS-create.test.js with tests for 0, 1, 5, 20, 50 file scenarios
- [ ] T022 [P] [US1] Add rollback test with induced create() failure to VirtualFS-create.test.js
- [ ] T023 [P] [US1] Add storage quota simulation tests to VirtualFS-create.test.js
- [ ] T024 [P] [US1] Create tests/performance/snapshot-create-benchmarks.js to validate SC-004 (<2s for 20 files/5MB)

**Deliverable**: Fully functional, tested snapshot creation with progress feedback and error handling

**Acceptance Validation**:
1. Create snapshot with 5 files → All contents captured exactly
2. Create with syntax errors → Completes successfully  
3. Rapid succession (3 snapshots <1s apart) → All succeed
4. Storage 96% full → Clear error, no partial data
5. Simulated failure → Rollback message displayed

---

## Phase 4: User Story 2 - Reliable Snapshot Restoration (Days 8-10) [P1]

**User Story**: A developer restores a previous version to review or continue from an earlier state. System reliably reconstructs exact editor state including files, tabs, positions, and tree structure, without residual data.

**Independent Test Criteria**:
- ✅ Restore snapshot with 3 files, verify exact state match
- ✅ Restore with nested folders, tree rebuilds correctly
- ✅ Rapid version switching (A→B→A in 5 seconds) succeeds
- ✅ Restore 20+ file snapshot shows progress indicators
- ✅ No "model already disposed" errors

### US2: Implementation Tasks

- [ ] T025 [US2] Wrap fs.set() in try-catch with rollback on failure in src/components/editor/utils/VirtualFS.js
- [ ] T026 [P] [US2] Define SNAPSHOT_STAGES.restore constant (Loading 10%, Cleaning 20%, Restoring 50%, Updating 20%)
- [ ] T027 [US2] Integrate ProgressTracker into fs.set() method with restore stage emissions
- [ ] T028 [US2] Update fs.set() to call safeDisposeModel for each file cleanup before restoration
- [ ] T029 [US2] Add validation that all models disposed successfully before creating new ones
- [ ] T030 [P] [US2] Add logStart, logComplete, logError calls throughout fs.set() method
- [ ] T031 [US2] Add 'operationRollback' notification emission in rollback() method with user message

### US2: Testing Tasks

- [ ] T032 [P] [US2] Create tests/unit/VirtualFS-restore.test.js with valid/invalid version ID tests
- [ ] T033 [P] [US2] Add Monaco model disposal sequence test to VirtualFS-restore.test.js
- [ ] T034 [P] [US2] Add rapid switching test (restore A→B→A within 5 seconds) to VirtualFS-restore.test.js
- [ ] T035 [P] [US2] Create tests/performance/snapshot-restore-benchmarks.js to validate SC-005 (<3s for 20 files/5MB)

### US2: Integration Tasks

- [ ] T036 [US2] Create integration test in tests/integration/create-restore-cycle.test.js for full roundtrip verification
- [ ] T037 [US2] Add memory stability test over 10 consecutive operations to validate SC-006

**Deliverable**: Fully functional, tested snapshot restoration with progress feedback

**Acceptance Validation**:
1. Restore snapshot with 3 files → Exact state match
2. Restore nested folder structure → Tree correct
3. Rapid switching A→B→A (5 sec) → No errors
4. Restore 20+ files → Progress bar shows stages
5. Run 10 consecutive restores → No memory growth

---

## Phase 5: User Story 3 - Version Management & Multi-Window (Days 11-13) [P2]

**User Story**: A developer works with version history UI and potentially multiple windows. Version list stays synchronized, showing accurate current version information. Multi-window operations don't corrupt data.

**Independent Test Criteria**:
- ✅ Create 5 snapshots, restore #3, UI shows #3 as current
- ✅ Create snapshot, version list updates immediately
- ✅ Delete snapshot, version list updates, current version protected
- ✅ Storage warning at 80%, critical dialog at 95%
- ✅ Two windows: create in one, other sees new version <2s

### US3: Deletion UI Tasks

- [ ] T038 [P] [US3] Add deleteSnapshot(version) method to VirtualFS.fs with validation in src/components/editor/utils/VirtualFS.js
- [ ] T039 [P] [US3] Implement current version deletion prevention check in deleteSnapshot()
- [ ] T040 [P] [US3] Update version_latest pointer if deleted version was latest
- [ ] T041 [P] [US3] Add logStart, logComplete calls to deleteSnapshot() method
- [ ] T042 [US3] Add delete button to version list items in src/components/editor/EditorPage.jsx
- [ ] T043 [US3] Implement Blueprint Alert confirmation dialog for snapshot deletion
- [ ] T044 [US3] Disable delete button for current version in version list UI

### US3: Storage Warning Tasks

- [ ] T045 [P] [US3] Subscribe to 'storageWarning' notifications in EditorPage component
- [ ] T046 [P] [US3] Implement warning toast display for 80% usage severity
- [ ] T047 [P] [US3] Implement critical blocking dialog for 95% usage severity
- [ ] T048 [US3] Add "Manage Snapshots" action in critical dialog linking to version list

### US3: Multi-Window Tasks

- [ ] T049 [US3] Create setupMultiWindowSync() method in VirtualFS.fs
- [ ] T050 [US3] Register window 'storage' event listener in setupMultiWindowSync()
- [ ] T051 [US3] Implement handleExternalChange(externalData) to update local state
- [ ] T052 [US3] Implement handleCurrentVersionDeleted() to switch to latest or maintain state
- [ ] T053 [US3] Call setupMultiWindowSync() in VirtualFS init or EditorPage mount
- [ ] T054 [P] [US3] Add logStart, logComplete calls to multi-window sync methods

### US3: Testing Tasks

- [ ] T055 [P] [US3] Create tests/unit/VirtualFS-delete.test.js with edge cases (current, non-existent, last)
- [ ] T056 [P] [US3] Create tests/integration/multi-window.test.js with 2-window simulation
- [ ] T057 [P] [US3] Add simultaneous create test from 2 windows to multi-window.test.js
- [ ] T058 [P] [US3] Add delete in window A, verify update in window B test
- [ ] T059 [P] [US3] Add sync latency test to verify <2 second update (SC-013)

**Deliverable**: Complete version management UI with multi-window synchronization

**Acceptance Validation**:
1. Create 5 snapshots, restore #3 → UI shows #3 current
2. Create snapshot → Version list updates immediately
3. Delete old snapshot → List updates, current protected
4. Fill storage to 82% → Warning toast appears
5. Create in window A → Window B sees it <2 seconds

---

## Phase 6: Polish & Cross-Cutting (Days 14-15)

**Goal**: Final integration, performance validation, documentation

**Independent Test Criteria**:
- ✅ All 14 success criteria (SC-001 to SC-014) pass
- ✅ 80%+ code coverage achieved
- ✅ Manual QA sign-off complete

### Polish Tasks

- [ ] T060 [P] Run full test suite (unit + integration + performance) and verify all passing
- [ ] T061 [P] Generate code coverage report and verify ≥80% for VirtualFS.fs methods
- [ ] T062 [P] Run memory profiler on 10 consecutive operations to validate SC-006
- [ ] T063 [P] Measure actual compression ratios and verify ≥50% per SC-007
- [ ] T064 [P] Update research.md with any implementation decisions made during development
- [ ] T065 Manual QA testing with real plugin projects (5, 20, 50 files)
- [ ] T066 Document any discovered issues or edge cases in research.md
- [ ] T067 Update quickstart.md with any learned troubleshooting tips
- [ ] T068 Create PR description summarizing changes, linking to spec.md and tasks.md

**Deliverable**: Production-ready, fully tested implementation

---

## Dependencies & Execution Order

### Story Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational) ← MUST complete before any user story
    ↓
    ├─→ Phase 3 (US1: Creation) [P1] ← Can start after Phase 2
    │
    ├─→ Phase 4 (US2: Restoration) [P1] ← Can start after Phase 2 (independent of US1)
    │
    └─→ Phase 5 (US3: Version UI) [P2] ← Can start after Phase 2 (independent of US1, US2)
         
Phase 6 (Polish) ← Requires all user stories complete
```

### Parallel Execution Opportunities

**Phase 1 (Setup)**: 2 parallel streams
- Stream A: T001 → T004
- Stream B: T002 (can run with Stream A)
- Stream C: T003 (can run with Stream A & B)

**Phase 2 (Foundational)**: 2 parallel streams after T007
- Stream A: T005 → T006 → T007
- Stream B (after T007): T008, T009 → T010

**Phase 3 (US1)**: 3 parallel streams
- Stream A: T011 → T014 → T015 → T016
- Stream B: T012 → T013 (can run with Stream A)
- Stream C: T017, T018 → T019 → T020 (can run with Stream A/B)
- Stream D: T021, T022, T023, T024 (all tests can run in parallel after T017)

**Phase 4 (US2)**: 3 parallel streams
- Stream A: T025 → T027 → T028 → T029 → T031
- Stream B: T026, T030 (can run with Stream A)
- Stream C: T032, T033, T034, T035, T036, T037 (all tests can run in parallel after T031)

**Phase 5 (US3)**: 3 parallel streams
- Stream A: T038 → T039 → T040 → T041 → T042 → T043 → T044
- Stream B: T045 → T046 → T047 → T048 (can run with Stream A)
- Stream C: T049 → T050 → T051 → T052 → T053 → T054 (can run with Stream A/B)
- Stream D: T055, T056, T057, T058, T059 (all tests can run in parallel after T054)

**Phase 6 (Polish)**: All tasks except T065 can run in parallel

---

## Independent Test Criteria by Story

### User Story 1: Snapshot Creation

**Manual Test Scenario**:
1. Open editor with 5-file plugin project
2. Make changes in multiple files (add/edit code)
3. Click "Create Snapshot" button
4. Verify progress bar shows 4 stages
5. Verify snapshot appears in version list
6. Close and reopen editor
7. Verify files still show changes (not yet restored)

**Automated Tests**:
- `VirtualFS-create.test.js`: Unit tests for create logic
- `snapshot-create-benchmarks.js`: Performance validation

**Success Criteria Validated**:
- SC-001: 100% success for ≤50 files
- SC-004: Create <2s for 20 files/5MB
- SC-009: Graceful quota errors

---

### User Story 2: Snapshot Restoration

**Manual Test Scenario**:
1. Create snapshot A with 3 files (current state)
2. Make changes, add new file (4 files now)
3. Select snapshot A from version list
4. Click "Restore"
5. Verify progress bar shows 4 stages
6. Verify editor shows exactly 3 files from snapshot A
7. Verify file contents match snapshot A exactly
8. Verify tabs match snapshot A

**Automated Tests**:
- `VirtualFS-restore.test.js`: Unit tests for restore logic
- `create-restore-cycle.test.js`: Integration test
- `snapshot-restore-benchmarks.js`: Performance validation

**Success Criteria Validated**:
- SC-002: 100% restoration fidelity
- SC-003: 20+ consecutive operations
- SC-005: Restore <3s for 20 files/5MB
- SC-006: Stable memory
- SC-011: Zero unusable states

---

### User Story 3: Version Management & Multi-Window

**Manual Test Scenario**:
1. Create 5 snapshots over time
2. Verify version list shows all 5 with timestamps
3. Restore snapshot #3, verify "current" indicator moves
4. Try to delete current snapshot, verify prevented
5. Delete old snapshot, verify list updates
6. Fill storage to 82%, verify warning toast
7. Open same project in 2 windows
8. Create snapshot in window A
9. Verify window B shows new snapshot <2 seconds
10. Delete snapshot in window B
11. Verify window A list updates

**Automated Tests**:
- `VirtualFS-delete.test.js`: Unit tests for deletion
- `multi-window.test.js`: Integration tests

**Success Criteria Validated**:
- SC-008: 100% accurate version list
- SC-009: Graceful storage errors
- SC-013: Multi-window sync <2s
- SC-014: No corruption on simultaneous ops

---

## MVP Scope Recommendation

**Minimum Viable Product** (Phase 3 only):
- User Story 1: Reliable Snapshot Creation
- Includes: Atomic operations, progress feedback, storage warnings
- Excludes: Restoration improvements, version UI, multi-window

**Rationale**: Snapshot creation is the most critical path. Users can tolerate manual page refresh for restoration, but cannot work if snapshots don't save reliably. This provides immediate value while allowing incremental delivery.

**Incremental Delivery Path**:
1. **Week 1**: Phase 1-3 (MVP: Reliable Creation)
2. **Week 2**: Phase 4 (Add: Reliable Restoration)
3. **Week 3**: Phase 5-6 (Add: Version UI + Multi-Window + Polish)

---

## Implementation Strategy

### Day-by-Day Breakdown

| Day | Phase | Focus | Deliverable |
|-----|-------|-------|-------------|
| 1 | Phase 1 | Setup infrastructure | Logging ready |
| 2 | Phase 2 | Atomic operations | Rollback pattern works |
| 3-5 | Phase 3 | US1 Implementation | Create snapshots reliably |
| 6-7 | Phase 3 | US1 Testing | US1 fully validated |
| 8-9 | Phase 4 | US2 Implementation | Restore snapshots reliably |
| 10 | Phase 4 | US2 Testing | US2 fully validated |
| 11-12 | Phase 5 | US3 Implementation | Version UI + multi-window |
| 13 | Phase 5 | US3 Testing | US3 fully validated |
| 14-15 | Phase 6 | Polish & QA | Production ready |

### Team Allocation (if 2+ developers)

**Developer A**: Focus on US1 and US2 (core snapshot logic)
**Developer B**: Focus on US3 (UI and multi-window)
**Both**: Collaborate on Phase 1 & 2 (foundational)

### Quality Gates

- [ ] After Phase 2: All rollback tests passing
- [ ] After Phase 3: US1 acceptance criteria met
- [ ] After Phase 4: US2 acceptance criteria met  
- [ ] After Phase 5: US3 acceptance criteria met
- [ ] After Phase 6: All 14 success criteria (SC-001 to SC-014) validated

---

## Task Progress Tracking

| Phase | Total Tasks | Completed | Status |
|-------|-------------|-----------|--------|
| Phase 1: Setup | 4 | 0 | Not Started |
| Phase 2: Foundational | 6 | 0 | Not Started |
| Phase 3: US1 | 14 | 0 | Not Started |
| Phase 4: US2 | 13 | 0 | Not Started |
| Phase 5: US3 | 22 | 0 | Not Started |
| Phase 6: Polish | 9 | 0 | Not Started |
| **Total** | **68** | **0** | **0%** |

---

## Quick Reference

**Start Here**: T001 (Verify electron-log)
**Critical Path**: T001→T005→T011→T025→T049
**Parallel Opportunities**: 45% of tasks can run in parallel
**MVP Completion**: After T024 (Phase 3 complete)
**Full Completion**: After T068 (All phases)

**Files Modified**:
- `src/components/editor/utils/VirtualFS.js` (major refactor)
- `src/components/editor/EditorPage.jsx` (UI integration)
- `src/utils/SnapshotLogger.js` (new file)
- `src/components/editor/SnapshotProgress.jsx` (new file)
- `tests/*` (new test files)

**Key Documentation**:
- Full details: [plan.md](plan.md)
- Research & decisions: [research.md](research.md)
- Quick start: [quickstart.md](quickstart.md)
- Requirements: [spec.md](spec.md)
