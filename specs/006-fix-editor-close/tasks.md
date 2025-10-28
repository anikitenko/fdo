# Tasks: Editor Window Close Reliability Fix

**Input**: Design documents from `/specs/006-fix-editor-close/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/window-lifecycle-api.md

**Tests**: Included per Constitution IX (Test-First Development requirement)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Desktop application (Electron)**: `src/` for main/renderer code, `tests/` for test files
- Paths use absolute references: `/Users/onikiten/dev/fdo/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify project environment and prepare for implementation

- [x] T001 Verify Electron 37.2.6 and React 18.3.1 dependencies in /Users/onikiten/dev/fdo/package.json
- [x] T002 [P] Verify Jest 30.0.5 is configured for testing in /Users/onikiten/dev/fdo/package.json
- [x] T003 [P] Review current IPC channel definitions in /Users/onikiten/dev/fdo/src/ipc/channels.js
- [x] T004 Create test directory structure: /Users/onikiten/dev/fdo/tests/unit/ and /Users/onikiten/dev/fdo/tests/integration/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core window management utilities that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Create window validation helper function in /Users/onikiten/dev/fdo/src/utils/editorWindow.js
- [x] T006 [P] Create cleanup handler function for IPC listeners in /Users/onikiten/dev/fdo/src/utils/editorWindow.js
- [x] T007 [P] Add window validity check types (isDestroyed, null check) in /Users/onikiten/dev/fdo/src/utils/editorWindow.js
- [x] T008 Review IPC security boundaries in /Users/onikiten/dev/fdo/src/preload.js (verify no changes needed)

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Reliable Window Close After Confirmation (Priority: P1) 🎯 MVP

**Goal**: Fix critical bug where editor window fails to close reliably after user confirms the close prompt

**Independent Test**: Open editor window → click close → confirm "Yes" → verify window closes within 500ms. Repeat 10+ times to verify reliability.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US1] Create unit test file /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js with describe block
- [x] T010 [P] [US1] Write test: "should register persistent close approval handler" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T011 [P] [US1] Write test: "should validate window before destroy operation" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T012 [P] [US1] Write test: "should skip destroy if window is null" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T013 [P] [US1] Write test: "should skip destroy if window is destroyed" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T014 [P] [US1] Write test: "should activate timeout after 2.5 seconds if window doesn't close" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T015 [P] [US1] Write test: "should clear timeout on successful window close" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T016 [P] [US1] Write test: "should cleanup IPC handlers on window closed event" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [x] T017 [US1] Run unit tests and verify they FAIL (npm test tests/unit/editorWindow.test.js)

### Implementation for User Story 1

**Main Process Changes** (Window Management & IPC):

- [x] T018 [US1] Replace ipcMain.once() with ipcMain.on() for EDITOR_CLOSE_APPROVED handler in /Users/onikiten/dev/fdo/src/ipc/system.js (line 213)
- [x] T019 [US1] Add window validation check at start of EDITOR_CLOSE_APPROVED handler in /Users/onikiten/dev/fdo/src/ipc/system.js
- [x] T020 [US1] Implement timeout mechanism (2.5s) in EDITOR_CLOSE_APPROVED handler in /Users/onikiten/dev/fdo/src/ipc/system.js
- [x] T021 [US1] Add try-catch around window.destroy() call in /Users/onikiten/dev/fdo/src/ipc/system.js
- [x] T022 [US1] Add 'closed' event listener to editorWindowInstance in /Users/onikiten/dev/fdo/src/ipc/system.js (systemOpenEditorWindow function)
- [x] T023 [US1] Implement cleanup logic in 'closed' event handler (clear timeout, remove IPC handlers, nullWindow) in /Users/onikiten/dev/fdo/src/ipc/system.js
- [x] T024 [US1] Add forceCloseWindow helper function for timeout fallback in /Users/onikiten/dev/fdo/src/ipc/system.js

**Renderer Process Changes** (Request Deduplication):

- [x] T025 [US1] Add closeInProgress state variable (useState) in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [x] T026 [US1] Add closeInProgress check at start of handleElectronClose in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [x] T027 [US1] Set closeInProgress = true before showing confirmation in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [x] T028 [US1] Reset closeInProgress = false on user cancel in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx

**Verification**:

- [ ] T029 [US1] Run unit tests and verify they PASS (npm test tests/unit/editorWindow.test.js)
- [ ] T030 [US1] Create integration test file /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T031 [US1] Write integration test: "full close flow with confirmation" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T032 [US1] Write integration test: "50 consecutive close-reopen cycles" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T033 [US1] Write integration test: "rapid close button clicks (deduplication)" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T034 [US1] Write integration test: "cancel and retry close flow" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T035 [US1] Run integration tests and verify they PASS (npm test tests/integration/editor-close-flow.test.js)

**Checkpoint**: At this point, User Story 1 should be fully functional - window close works reliably 100% of the time

---

## Phase 4: User Story 2 - Graceful Reload Confirmation (Priority: P2)

**Goal**: Apply the same reliability fixes to window reload flow (shares same root cause as close)

**Independent Test**: Open editor window → press Ctrl+R/Cmd+R → confirm reload → verify window reloads. Repeat 10+ times to verify reliability.

### Tests for User Story 2

- [ ] T036 [P] [US2] Write test: "should register persistent reload approval handler" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [ ] T037 [P] [US2] Write test: "should validate window before reload operation" in /Users/onikiten/dev/fdo/tests/unit/editorWindow.test.js
- [ ] T038 [US2] Run unit tests and verify reload tests FAIL (npm test tests/unit/editorWindow.test.js)

### Implementation for User Story 2

**Main Process Changes** (Reload Handler):

- [ ] T039 [US2] Verify EDITOR_RELOAD_APPROVED handler uses ipcMain.on() (already correct per research.md) in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T040 [US2] Add window validation check at start of EDITOR_RELOAD_APPROVED handler in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T041 [US2] Add try-catch around window.reload() call in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T042 [US2] Add EDITOR_RELOAD_APPROVED handler to cleanup list in 'closed' event in /Users/onikiten/dev/fdo/src/ipc/system.js

**Renderer Process Changes** (Request Deduplication):

- [ ] T043 [US2] Add reloadInProgress state variable (useState) in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [ ] T044 [US2] Add reloadInProgress check at start of handleElectronReload in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [ ] T045 [US2] Set reloadInProgress = true before showing confirmation in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [ ] T046 [US2] Reset reloadInProgress = false on user cancel in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx

**Verification**:

- [ ] T047 [US2] Run unit tests and verify reload tests PASS (npm test tests/unit/editorWindow.test.js)
- [ ] T048 [US2] Write integration test: "full reload flow with confirmation" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T049 [US2] Write integration test: "multiple consecutive reloads" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T050 [US2] Run integration tests and verify they PASS (npm test tests/integration/editor-close-flow.test.js)

**Checkpoint**: All user stories should now be independently functional - both close and reload work reliably

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and enhance overall quality

**Observability & Logging**:

- [ ] T051 [P] Add console.info log for close approved event in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T052 [P] Add console.warn log for window validation failures in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T053 [P] Add console.warn log for timeout activation in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T054 [P] Add console.info log for successful close completion in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T055 [P] Add console.debug log for cleanup operations in /Users/onikiten/dev/fdo/src/ipc/system.js

**Documentation**:

- [ ] T056 [P] Add code comments explaining timeout mechanism in /Users/onikiten/dev/fdo/src/ipc/system.js
- [ ] T057 [P] Add code comments explaining closeInProgress flag in /Users/onikiten/dev/fdo/src/components/editor/EditorPage.jsx
- [ ] T058 [P] Update /Users/onikiten/dev/fdo/specs/006-fix-editor-close/IMPLEMENTATION_SUMMARY.md with implementation details
- [ ] T059 Verify all changes documented in /Users/onikiten/dev/fdo/specs/006-fix-editor-close/quickstart.md are accurate

**Comprehensive Testing**:

- [ ] T060 [P] Add edge case test: "programmatic close during confirmation" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T061 [P] Add edge case test: "IPC interruption (timeout activation)" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T062 [P] Add performance test: "close completes within 500ms" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js
- [ ] T063 [P] Add performance test: "timeout activates at 2.5s (mocked)" in /Users/onikiten/dev/fdo/tests/integration/editor-close-flow.test.js

**Manual Validation**:

- [ ] T064 Run manual test checklist from /Users/onikiten/dev/fdo/specs/006-fix-editor-close/quickstart.md
- [ ] T065 Perform 50+ consecutive close-reopen cycles manually (Success Criteria SC-003)
- [ ] T066 Test rapid close button clicks (10x in succession) to verify deduplication
- [ ] T067 Test cancel and retry flow (close → cancel → close again → confirm)
- [ ] T068 Verify no memory leaks after 20+ open-close cycles (check handler count)

**Code Quality**:

- [ ] T069 Run ESLint on modified files and fix any issues
- [ ] T070 Run full test suite (npm test) and verify all tests pass
- [ ] T071 Review code changes against /Users/onikiten/dev/fdo/specs/006-fix-editor-close/contracts/window-lifecycle-api.md
- [ ] T072 Verify no breaking changes to IPC contracts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion - This is the MVP
- **User Story 2 (Phase 4)**: Depends on Foundational phase completion - Can run in parallel with US1 if desired
- **Polish (Phase 5)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories ✅ **MVP READY**
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Shares same pattern as US1 but independently testable

**Note**: US1 and US2 can be worked on in parallel by different developers since they modify different handler functions (CLOSE vs RELOAD).

### Within Each User Story

1. **Tests MUST be written FIRST** (T009-T017 for US1, T036-T038 for US2)
2. **Verify tests FAIL** before implementation (T017, T038)
3. **Implement main process changes** (IPC handlers, validation, timeout)
4. **Implement renderer changes** (deduplication flags)
5. **Verify tests PASS** after implementation (T029, T047)
6. **Run integration tests** to validate end-to-end flow
7. **Story complete** - ready for independent deployment

### Parallel Opportunities

**Within Setup (Phase 1)**:
- T002 and T003 can run in parallel (different files)

**Within Foundational (Phase 2)**:
- T005, T006, T007, T008 can ALL run in parallel (different concerns)

**Within User Story 1 Tests (Phase 3)**:
- T010, T011, T012, T013, T014, T015, T016 can ALL run in parallel (different test cases)

**Within User Story 2 Tests (Phase 4)**:
- T036, T037 can run in parallel (different test cases)

**User Story Parallel Execution**:
- Once Foundational (Phase 2) completes, US1 (Phase 3) and US2 (Phase 4) can proceed in parallel
- Different developers can work on close vs reload handlers simultaneously

**Within Polish (Phase 5)**:
- All logging tasks (T051-T055) can run in parallel
- All documentation tasks (T056-T059) can run in parallel
- All test tasks (T060-T063) can run in parallel

---

## Parallel Example: User Story 1

```bash
# After Foundational phase completes, launch all US1 tests together:
Task: "Write test: should register persistent close approval handler"
Task: "Write test: should validate window before destroy operation"
Task: "Write test: should skip destroy if window is null"
Task: "Write test: should skip destroy if window is destroyed"
Task: "Write test: should activate timeout after 2.5 seconds"
Task: "Write test: should clear timeout on successful window close"
Task: "Write test: should cleanup IPC handlers on window closed event"

# Then verify tests fail together:
npm test tests/unit/editorWindow.test.js

# Implement in sequence (dependencies on validation helpers from Foundational):
Task: "Replace ipcMain.once() with ipcMain.on()" → "Add validation" → "Add timeout" → etc.

# Then verify tests pass:
npm test tests/unit/editorWindow.test.js
```

---

## Parallel Example: Cross-Story Execution

```bash
# Once Foundational (Phase 2) completes, two developers can work in parallel:

Developer A (User Story 1 - Close Reliability):
├─ Writes close tests
├─ Implements EDITOR_CLOSE_APPROVED handler changes
├─ Adds closeInProgress flag in EditorPage.jsx
├─ Runs US1 tests
└─ Story 1 complete ✅

Developer B (User Story 2 - Reload Reliability):
├─ Writes reload tests
├─ Implements EDITOR_RELOAD_APPROVED handler changes
├─ Adds reloadInProgress flag in EditorPage.jsx
├─ Runs US2 tests
└─ Story 2 complete ✅

Both stories are independent and testable without blocking each other.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only) ⭐ RECOMMENDED

1. **Complete Phase 1: Setup** (4 tasks, ~15 minutes)
2. **Complete Phase 2: Foundational** (4 tasks, CRITICAL - blocks all stories, ~30 minutes)
3. **Complete Phase 3: User Story 1** (28 tasks, ~4 hours including tests)
4. **STOP and VALIDATE**: Run all US1 tests, perform manual validation
5. **Deploy/Demo if ready** - Window close now works reliably ✅

**Why this is MVP**:
- Fixes the critical bug (stuck windows)
- Unblocks developer workflow
- Meets Success Criteria SC-001 through SC-006
- Can be deployed independently

### Incremental Delivery

1. **Foundation**: Setup + Foundational → Infrastructure ready (~45 minutes)
2. **MVP**: Add User Story 1 → Test independently → Deploy ✅ (~4 hours)
3. **Enhancement**: Add User Story 2 → Test independently → Deploy (~2 hours)
4. **Polish**: Add logging, documentation, edge cases → Final release (~2 hours)

**Total Effort**: ~9 hours for complete implementation with comprehensive tests

### Parallel Team Strategy

With 2 developers:

1. **Together**: Complete Setup + Foundational (45 minutes)
2. **Split**:
   - Developer A: User Story 1 (Close) - 4 hours
   - Developer B: User Story 2 (Reload) - 2 hours
3. **Together**: Polish phase (2 hours)

**Total Elapsed Time**: ~5 hours (vs. 9 hours sequential)

---

## Task Counts & Metrics

**Total Tasks**: 72

**Breakdown by Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 4 tasks
- Phase 3 (User Story 1): 28 tasks (17 tests + 11 implementation)
- Phase 4 (User Story 2): 15 tasks (3 tests + 12 implementation)
- Phase 5 (Polish): 21 tasks

**Breakdown by Type**:
- Test tasks: 28 (39%)
- Implementation tasks: 31 (43%)
- Documentation tasks: 4 (6%)
- Validation tasks: 9 (12%)

**Parallel Opportunities**:
- 31 tasks marked [P] can run in parallel
- 2 user stories can run in parallel after Foundational phase
- Estimated 40% time savings with parallel execution

**Independent Test Criteria**:
- **US1**: Open → close → confirm → verify window closes within 500ms (repeat 10x)
- **US2**: Open → reload → confirm → verify window reloads (repeat 10x)

**Suggested MVP Scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1 only) = 36 tasks = **4.75 hours**

---

## Constitution Alignment

This task list satisfies **Constitution IX: Test-First Development**:

✅ Tests exist before implementation (T009-T017 before T018-T028)  
✅ Tests MUST fail before implementation (T017, T038)  
✅ Tests verify implementation (T029, T035, T047, T050, T070)  
✅ Coverage for critical workflows (50+ close cycles, timeout, validation, deduplication)

---

## Notes

- **[P] tasks** = different files/concerns, can run in parallel
- **[Story] labels** map task to specific user story for traceability
- Each user story is independently completable and testable
- **Tests written FIRST** per Constitution IX
- Verify tests fail before implementing (T017, T038)
- Commit after each logical group of tasks
- Stop at any checkpoint to validate story independently
- **File paths are absolute** for clarity
- Avoid same-file conflicts when parallelizing
- Constitution compliance validated in plan.md

