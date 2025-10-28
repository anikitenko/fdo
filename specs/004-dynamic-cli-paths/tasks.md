# Tasks: Dynamic CLI Path Resolution

**Feature**: `004-dynamic-cli-paths`  
**Input**: Design documents from `/specs/004-dynamic-cli-paths/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in specification - manual testing approach per plan.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Project Type**: Single desktop application (Electron-based)
- **Primary file**: `src/utils/installFDOCLI.js` (existing, will be refactored)
- **Supporting files**: Uses existing utilities, may extract helpers

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare logging infrastructure for structured logging per research.md

- [x] T001 Configure electron-log debug mode in src/main.js for CLI installation operations
- [x] T002 [P] Add log prefix constants for CLI operations in src/utils/installFDOCLI.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core helper functions that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 [P] Implement `isDevelopmentEnvironment()` helper in src/utils/installFDOCLI.js per research R7
- [x] T004 [P] Implement `isPathWritable(targetPath)` helper in src/utils/installFDOCLI.js per research R4
- [x] T005 [P] Implement `detectApplicationPath()` helper in src/utils/installFDOCLI.js per contracts and research R1
- [x] T006 Implement `getPlatformPaths(platform)` helper in src/utils/installFDOCLI.js per research R2
- [x] T007 [P] Implement `createWrapperScript(appPath, platform)` helper in src/utils/installFDOCLI.js per contracts and research R8

**Checkpoint**: Foundation ready - helper functions tested and working

---

## Phase 3: User Story 1 - Install CLI from Custom Application Location (Priority: P1) 🎯 MVP

**Goal**: Enable CLI installation regardless of where FDO is installed (custom paths, default paths, development)

**Independent Test**: Install FDO to a custom location (e.g., `D:\CustomApps\FDO` on Windows or `/opt/custom/FDO` on Linux), then trigger CLI installation. The CLI should work correctly without errors.

**Acceptance Criteria**:
1. FDO installed to custom directory → CLI installer detects actual app path and creates working wrapper
2. FDO installed to default system location → CLI installer works (backward compatibility)
3. CLI installation triggered → no hardcoded path assumptions cause failure

### Implementation for User Story 1

- [x] T008 [US1] Refactor `installFDOCLI()` in src/utils/installFDOCLI.js to remove hardcoded paths for macOS
- [x] T009 [US1] Add dynamic path detection to `installFDOCLI()` using `detectApplicationPath()` helper
- [x] T010 [US1] Add idempotent check to `installFDOCLI()` per clarification (skip if file exists)
- [x] T011 [US1] Add info-level logging for installation start and path detection in `installFDOCLI()`
- [x] T012 [US1] Add debug-level logging for detection method and validation in `installFDOCLI()`
- [x] T013 [US1] Update macOS wrapper script generation to use detected path in `installFDOCLI()`
- [x] T014 [US1] Refactor `installFDOCLI()` to remove hardcoded paths for Windows
- [x] T015 [US1] Update Windows wrapper script generation to use detected path in `installFDOCLI()`
- [x] T016 [US1] Refactor `installFDOCLI()` to remove hardcoded paths for Linux
- [x] T017 [US1] Update Linux wrapper script generation to use detected path in `installFDOCLI()`
- [x] T018 [US1] Add development environment detection and warning logging in `installFDOCLI()` per FR-018
- [x] T019 [US1] Add proper error messages with recovery instructions in `installFDOCLI()` per FR-019
- [ ] T020 [US1] Test CLI installation from default location on macOS
- [ ] T021 [US1] Test CLI installation from custom location on macOS
- [ ] T022 [US1] Test CLI installation from default location on Windows
- [ ] T023 [US1] Test CLI installation from custom location on Windows
- [ ] T024 [US1] Test CLI installation from default location on Linux
- [ ] T025 [US1] Test CLI installation from custom location on Linux
- [ ] T026 [US1] Test CLI installation from development environment
- [ ] T027 [US1] Test CLI execution with paths containing spaces and special characters
- [ ] T028 [US1] Test idempotent behavior (re-running installation skips correctly)

**Checkpoint**: At this point, User Story 1 should be fully functional - CLI installs from any app location

---

## Phase 4: User Story 2 - Install CLI with Non-Standard System Paths (Priority: P2)

**Goal**: Enable CLI installation when default system paths are not writable or don't exist

**Independent Test**: Test on a system where `/usr/local/bin` is not writable or doesn't exist. The installer should use an appropriate alternative location (e.g., user's local bin directory).

**Acceptance Criteria**:
1. Default CLI path not writable → installer uses appropriate fallback location
2. System has custom PATH configurations → installer detects and uses PATH-accessible directory
3. User has limited permissions → installer succeeds using user-writable locations

### Implementation for User Story 2

- [x] T029 [US2] Implement `selectInstallPath(platform, paths)` helper in src/utils/installFDOCLI.js per contracts
- [x] T030 [US2] Update `installFDOCLI()` to use `selectInstallPath()` instead of hardcoded primary path
- [x] T031 [US2] Add permission checking logic before attempting installation in `installFDOCLI()`
- [x] T032 [US2] Add fallback path iteration logic in `installFDOCLI()` per research R2
- [x] T033 [US2] Add info-level logging for fallback attempts in `installFDOCLI()`
- [x] T034 [US2] Add debug-level logging for permission checks in `installFDOCLI()`
- [x] T035 [US2] Update error messages to include all attempted paths when all fail
- [x] T036 [US2] Add logic to create parent directory if needed (recursive) in `installFDOCLI()`
- [ ] T037 [US2] Test installation when primary path not writable on macOS
- [ ] T038 [US2] Test installation when primary path doesn't exist on macOS
- [ ] T039 [US2] Test installation when primary path not writable on Linux
- [ ] T040 [US2] Test installation when primary path doesn't exist on Linux
- [ ] T041 [US2] Test installation to ~/.local/bin fallback on Unix systems
- [ ] T042 [US2] Test installation to ~/bin fallback on Unix systems
- [ ] T043 [US2] Test Windows installation to %LOCALAPPDATA% (no fallback needed)
- [ ] T044 [US2] Verify CLI works correctly from fallback locations

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - CLI installs to best available path

---

## Phase 5: User Story 3 - Uninstall CLI from Any Location (Priority: P2)

**Goal**: Enable clean CLI uninstallation regardless of where it was installed

**Independent Test**: Install CLI, then change system configuration or reinstall FDO to a different location. Uninstall should still find and remove the CLI installation.

**Acceptance Criteria**:
1. CLI installed using dynamic paths → uninstaller locates and removes correctly
2. CLI installed with previous version (hardcoded paths) → uninstaller checks multiple locations and removes
3. No CLI currently installed → uninstaller reports clearly that nothing found

### Implementation for User Story 3

- [x] T045 [US3] Refactor `removeFDOCLI()` in src/utils/installFDOCLI.js to check all possible CLI paths
- [x] T046 [US3] Add logic to check legacy hardcoded paths in `removeFDOCLI()` per FR-011
- [x] T047 [US3] Add logic to check all fallback paths in `removeFDOCLI()` per research R2
- [x] T048 [US3] Add idempotent behavior for uninstall (report success if not found) in `removeFDOCLI()`
- [x] T049 [US3] Add info-level logging for uninstall operations in `removeFDOCLI()`
- [x] T050 [US3] Add clear error messages when CLI found but cannot be removed in `removeFDOCLI()`
- [x] T051 [US3] Update Windows uninstall to optionally remove from PATH in `removeFDOCLI()` per research R3
- [ ] T052 [US3] Test uninstall of CLI from /usr/local/bin on macOS
- [ ] T053 [US3] Test uninstall of CLI from ~/.local/bin fallback on macOS
- [ ] T054 [US3] Test uninstall of CLI from ~/bin fallback on macOS
- [ ] T055 [US3] Test uninstall of CLI from /usr/local/bin on Linux
- [ ] T056 [US3] Test uninstall of CLI from user fallback paths on Linux
- [ ] T057 [US3] Test uninstall of CLI from %LOCALAPPDATA% on Windows
- [ ] T058 [US3] Test uninstall behavior when no CLI installed (idempotent)
- [ ] T059 [US3] Test uninstall with sudo permission handling on macOS/Linux
- [ ] T060 [US3] Test Windows PATH cleanup after uninstall

**Checkpoint**: All installation/uninstallation scenarios should work cleanly

---

## Phase 6: User Story 4 - Portable FDO Installation (Priority: P3)

**Goal**: Support CLI installation from portable/movable FDO locations

**Independent Test**: Install FDO to a portable drive, install CLI, then move the drive to a different mount point or machine. Re-running CLI installation should update paths appropriately.

**Acceptance Criteria**:
1. FDO on portable drive at location A → CLI installs and works correctly
2. FDO moved to location B → re-running CLI installation updates wrapper to new location
3. FDO location changes → CLI either works or provides clear guidance to reinstall

### Implementation for User Story 4

- [x] T061 [US4] Ensure `detectApplicationPath()` works correctly when run from portable media
- [x] T062 [US4] Verify idempotent installation updates wrapper when path changes per clarification
- [x] T063 [US4] Add warning logging when portable installation detected in `installFDOCLI()`
- [ ] T064 [US4] Test CLI installation from USB drive on macOS
- [ ] T065 [US4] Test CLI installation from portable drive on Windows
- [ ] T066 [US4] Test CLI re-installation after moving portable drive
- [ ] T067 [US4] Test CLI from network share (edge case)
- [ ] T068 [US4] Verify error messages guide users to reinstall when CLI breaks after move

**Checkpoint**: All user stories should now be independently functional including portable scenarios

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T069 [P] Review and refine all error messages for consistency and actionability
- [x] T070 [P] Review and refine all log messages for consistency across platforms
- [x] T071 Verify all functional requirements (FR-001 through FR-019) are implemented
- [ ] T072 Verify all success criteria (SC-001 through SC-009) are met
- [x] T073 [P] Add JSDoc comments to all helper functions in src/utils/installFDOCLI.js
- [x] T074 Code cleanup and remove any dead code from old hardcoded approach
- [ ] T075 Performance validation (installation < 30s, detection < 5s, idempotent < 1s)
- [ ] T076 [P] Update quickstart.md with any implementation notes if needed
- [ ] T077 Test all edge cases from spec.md (paths with spaces, multiple installations, dev environment, etc.)
- [ ] T078 Cross-platform validation test run (all scenarios on all platforms)
- [x] T079 [P] Update documentation strings in IPC handlers if interface changed
- [ ] T080 Final validation against specification requirements checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 (P1) can start immediately after Foundational
  - US2 (P2) depends on US1 completion (extends installation logic)
  - US3 (P2) can run parallel to US2 (different function - `removeFDOCLI()`)
  - US4 (P3) depends on US1 and US2 completion (validates portable scenarios)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 - extends installation logic with fallback paths
- **User Story 3 (P2)**: Can start after Foundational - independent function (`removeFDOCLI()`)
- **User Story 4 (P3)**: Depends on US1 and US2 - validates existing functionality in portable context

### Within Each User Story

- Setup logging before implementation
- Helper functions before main logic
- Core implementation before platform-specific code
- Implementation before testing
- Manual testing validates each scenario independently
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1 (Setup)**: T001 and T002 can run in parallel
- **Phase 2 (Foundational)**: T003, T004, T005, and T007 can run in parallel (different helpers)
- **Within US1**: Platform-specific refactoring (macOS, Windows, Linux sections) can be parallelized
- **US2 and US3**: Can run in parallel after US1 (US2 extends `installFDOCLI()`, US3 works on `removeFDOCLI()`)
- **Testing**: All test tasks within a story can run in parallel (marked implicitly by different scenarios)
- **Polish Phase**: Documentation, comments, and validation tasks can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# Launch all helper functions in parallel:
Task: "Implement isDevelopmentEnvironment() helper in src/utils/installFDOCLI.js"
Task: "Implement isPathWritable(targetPath) helper in src/utils/installFDOCLI.js"
Task: "Implement detectApplicationPath() helper in src/utils/installFDOCLI.js"
Task: "Implement createWrapperScript(appPath, platform) helper in src/utils/installFDOCLI.js"
```

## Parallel Example: User Story 2 and 3

```bash
# After US1 completes, these can run in parallel:
Task: "Implement selectInstallPath() and fallback logic in installFDOCLI()" (US2)
Task: "Refactor removeFDOCLI() to check all possible paths" (US3)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (logging infrastructure)
2. Complete Phase 2: Foundational (helper functions) - CRITICAL
3. Complete Phase 3: User Story 1 (dynamic path detection + installation)
4. **STOP and VALIDATE**: Test User Story 1 across all platforms
5. **MVP READY**: CLI works from any app location

**Why this is the MVP**: User Story 1 solves the core problem (hardcoded paths fail for custom installs). Users get immediate value even without fallback logic or advanced features.

### Incremental Delivery

1. **Foundation** (Phase 1 + 2) → Helper functions ready (~5-8 tasks, ~2-4 hours)
2. **MVP** (Phase 3) → Dynamic path detection working (~21 tasks, ~1-2 days)
   - Test independently across macOS, Windows, Linux
   - Deploy/demo if ready
3. **Fallback Support** (Phase 4) → Handles non-standard paths (~16 tasks, ~1 day)
   - Test independently with permission scenarios
   - Deploy/demo
4. **Uninstall** (Phase 5) → Clean removal (~16 tasks, ~1 day)
   - Test independently across platforms
   - Deploy/demo
5. **Portable** (Phase 6) → Advanced scenario support (~8 tasks, ~0.5 days)
   - Test independently with portable installations
   - Deploy/demo
6. **Polish** (Phase 7) → Production-ready (~12 tasks, ~0.5-1 day)
   - Final validation and cleanup

**Total Estimated Effort**: ~5-7 days for complete implementation and testing

### Single Developer Strategy

Work sequentially through phases:
1. Setup → Foundational (get helpers working)
2. US1 → Test thoroughly → Validate MVP
3. US2 → Test fallback scenarios
4. US3 (in parallel with US2 review if desired)
5. US4 → Test portable scenarios
6. Polish → Final validation

### Parallel Team Strategy

With 2-3 developers:

1. **Together**: Complete Setup + Foundational (critical blocking work)
2. **Once Foundational done**:
   - Developer A: User Story 1 (core dynamic detection)
   - Developer B: User Story 3 (uninstall - different function)
3. **After US1 completes**:
   - Developer A: User Story 2 (extends US1 with fallbacks)
   - Developer B: Continues US3
4. **After US2 completes**:
   - Developer A: User Story 4 (portable scenarios)
   - Developer B: Finishes US3, starts Polish
5. **Final**: Both collaborate on Polish phase

---

## Testing Approach

**Manual Testing** (per plan.md - no automated tests requested):

### Test Matrix

| Platform | Default Path | Custom Path | Paths w/ Spaces | Dev Env | No Permissions | Fallback | Portable |
|----------|--------------|-------------|-----------------|---------|----------------|----------|----------|
| macOS    | T020         | T021        | T027            | T026    | T037, T038     | T041, T042 | T064   |
| Windows  | T022         | T023        | T027            | T026    | T043           | T043     | T065     |
| Linux    | T024         | T025        | T027            | T026    | T039, T040     | T041, T042 | -      |

### Edge Cases to Validate (Phase 7, T077)

- Application path contains spaces (e.g., `FDO (FlexDevOPs).app`)
- Multiple FDO installations (idempotent behavior)
- Target directory doesn't exist and can't be created
- Development environment detection
- Existing CLI from different source (idempotent skip)
- Network paths or cloud-synced directories
- Retry after partial failure (idempotent recovery)

### Success Validation (Phase 7, T072)

- SC-001: CLI installation succeeds on all platforms from any location
- SC-002: 100% success rate for non-default directories
- SC-003: 100% correct handling of paths with spaces/special characters
- SC-004: Automatic fallback selection when primary not writable
- SC-005: 100% successful uninstallation including legacy paths
- SC-006: Installation + verification < 30 seconds
- SC-007: Error messages include paths attempted and recovery instructions
- SC-008: No hardcoded path failures
- SC-009: Successful retry after partial failure (idempotent)

---

## Notes

- **No automated tests**: Manual testing approach per plan.md (automated testing would require multi-platform CI)
- **[P] markers**: Tasks that can run in parallel (different files/functions, no dependencies)
- **[Story] labels**: Map tasks to user stories for traceability and independent testing
- **File paths**: All tasks include exact file paths (primarily `src/utils/installFDOCLI.js`)
- **Idempotent**: Core design principle - safe to retry any operation
- **Logging**: Info for major steps, debug for details (electron-log)
- **Error handling**: All errors returned in result objects, never thrown
- **Platform support**: macOS, Windows, Linux with platform-specific paths and wrappers
- **Commit strategy**: Commit after completing each user story phase (natural checkpoints)
- **MVP = User Story 1**: Solves core problem, delivers immediate value

---

## Task Count Summary

- **Phase 1 (Setup)**: 2 tasks
- **Phase 2 (Foundational)**: 5 tasks - BLOCKS all user stories
- **Phase 3 (US1 - P1)**: 21 tasks - MVP
- **Phase 4 (US2 - P2)**: 16 tasks
- **Phase 5 (US3 - P2)**: 16 tasks
- **Phase 6 (US4 - P3)**: 8 tasks
- **Phase 7 (Polish)**: 12 tasks

**Total**: 80 tasks

**Critical Path**: Phase 1 → Phase 2 → Phase 3 (US1) = MVP (~28 tasks)

**Parallel Potential**: 
- Foundational helpers: 4 tasks in parallel
- US2 and US3: ~32 tasks can overlap
- Testing within each story: Multiple test scenarios in parallel
- Polish tasks: ~5 tasks in parallel

