# Tasks: Fix Missing Asset Node Modules in Packaged Application

**Feature**: 003-fix-asar-node-modules  
**Branch**: `003-fix-asar-node-modules`  
**Input**: Design documents from `/specs/003-fix-asar-node-modules/`

**Prerequisites**: 
- ✅ plan.md (technical approach and structure)
- ✅ spec.md (user stories with priorities)
- ✅ research.md (technical decisions)
- ✅ data-model.md (configuration structures)
- ✅ contracts/validation-api.md (validation script interface)
- ✅ quickstart.md (testing and verification guide)

**Tests**: Tests are not explicitly requested in the specification. Validation is achieved through the automated validation script and manual verification steps.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is an Electron desktop application:
- Root: `/Users/onikiten/dev/fdo/`
- Configuration: `package.json`, `webpack.renderer.config.js`
- Scripts: `scripts/`
- Build output: `dist/`, `release/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and prepare environment for implementation

- [x] T001 Install `@electron/asar` package as dev dependency via npm
- [x] T002 Create `scripts/` directory if it doesn't exist
- [x] T003 [P] Verify webpack build creates `dist/renderer/assets/node_modules/` with all three packages

**Checkpoint**: Dependencies installed, webpack output verified

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Verify current state and baseline configuration

**⚠️ CRITICAL**: Complete this phase to understand the current packaging issue before implementing fixes

- [x] T004 Document current electron-builder configuration from `package.json` (files patterns)
- [x] T005 [P] Build current package and verify ASAR location for target platform
- [x] T006 [P] Extract current app.asar and document what's missing from `renderer/assets/node_modules/`
- [x] T007 Identify conflicting `files` patterns in `package.json` that exclude assets

**Checkpoint**: Current state documented, issue confirmed, ready to implement fixes

---

## Phase 3: User Story 1 - Package Application with Required Asset Dependencies (Priority: P1) 🎯 MVP

**Goal**: Ensure webpack-copied asset dependencies (@anikitenko/fdo-sdk, @babel/standalone, goober) are included in the packaged ASAR archive

**Independent Test**: Package application, extract app.asar, verify `renderer/assets/node_modules/` contains all three packages with files

**Acceptance Criteria** (from spec.md):
1. Packaged application's app.asar contains `renderer/assets/node_modules/` with three packages
2. Plugin can access FDO SDK types from assets directory at runtime
3. Babel transpiles dynamic code using @babel/standalone from assets
4. Goober styles apply correctly from assets

### Implementation for User Story 1

- [ ] T008 [US1] Update electron-builder configuration in `package.json` - add `"dist/renderer/assets/node_modules/**/*"` to files array
- [ ] T009 [US1] Ensure `"dist/renderer/assets/node_modules/**/*"` pattern comes AFTER `"!**/node_modules/**"` exclusion in files array
- [ ] T010 [US1] Verify no other `asarUnpack` or `extraResources` patterns conflict with assets inclusion
- [ ] T011 [US1] Run platform-specific build: `npm run dist:mac` (or target platform)
- [ ] T012 [US1] Verify app.asar size increased by ~5-15MB as expected (per SC-005)
- [ ] T013 [US1] Extract app.asar and confirm `renderer/assets/node_modules/@anikitenko/fdo-sdk/` exists with .d.ts files
- [ ] T014 [US1] Extract app.asar and confirm `renderer/assets/node_modules/@babel/standalone/` exists with babel.js
- [ ] T015 [US1] Extract app.asar and confirm `renderer/assets/node_modules/goober/` exists with index.js
- [ ] T016 [US1] Test packaged application with existing plugin that uses SDK types
- [ ] T017 [US1] Verify no runtime errors when plugins access assets at runtime

**Checkpoint**: Assets successfully included in ASAR archive, plugins can access them at runtime (MVP complete!)

---

## Phase 4: User Story 2 - Verify Asset Dependencies After Packaging (Priority: P2)

**Goal**: Create automated validation that ensures all webpack-copied assets are present in the final packaged ASAR archive

**Independent Test**: Intentionally remove an asset from webpack config, run build, verify validation fails with clear error

**Acceptance Criteria** (from spec.md):
1. Validation confirms all webpack-copied assets are present in ASAR archive
2. Build fails with clear error if assets missing
3. Error message shows expected paths (from webpack) and actual state (in ASAR)
4. Adding new webpack patterns auto-updates validation expectations

### Implementation for User Story 2

- [ ] T018 [P] [US2] Create `scripts/validate-asar-assets.js` with basic CLI argument parsing (--platform, --verbose, --asar-path, --json)
- [ ] T019 [P] [US2] Implement platform-specific ASAR path detection in `scripts/validate-asar-assets.js`
- [ ] T020 [US2] Implement webpack config parsing in `scripts/validate-asar-assets.js` - dynamically require and extract CopyWebpackPlugin patterns
- [ ] T021 [US2] Handle webpack config as function or object in `scripts/validate-asar-assets.js`
- [ ] T022 [US2] Transform webpack patterns to expected ASAR paths (from: node_modules/X, to: assets/... → renderer/assets/...)
- [ ] T023 [US2] Implement ASAR file list reading using `@electron/asar.listPackage()` in `scripts/validate-asar-assets.js`
- [ ] T024 [US2] Implement comparison logic - check each expected path exists in ASAR file list
- [ ] T025 [US2] Implement structured console output per contracts/validation-api.md (success message with ✓ indicators)
- [ ] T026 [US2] Implement structured console output for failures (missing assets list, expected vs actual comparison, troubleshooting steps)
- [ ] T027 [US2] Implement JSON output mode (--json flag) per contracts/validation-api.md
- [ ] T028 [US2] Implement exit codes: 0 (pass), 1 (validation failed), 2 (configuration error)
- [ ] T029 [US2] Add error handling for missing ASAR file with helpful message
- [ ] T030 [US2] Add error handling for invalid webpack config with helpful message
- [ ] T031 [US2] Add `validate:asar` script to `package.json`: `"validate:asar": "node scripts/validate-asar-assets.js"`
- [ ] T032 [US2] Update `dist:mac` script in `package.json` to append `&& npm run validate:asar -- --platform=mac`
- [ ] T033 [US2] Update `dist:linux` script in `package.json` to append `&& npm run validate:asar -- --platform=linux`
- [ ] T034 [US2] Update `dist:win` script in `package.json` to append `&& npm run validate:asar -- --platform=win`
- [ ] T035 [US2] Test validation script with valid ASAR - verify exit code 0 and success message
- [ ] T036 [US2] Test validation script with missing asset - verify exit code 1 and clear error showing missing paths
- [ ] T037 [US2] Test validation script with invalid platform - verify exit code 2 and error message
- [ ] T038 [US2] Test validation script with ASAR not found - verify exit code 2 and helpful error
- [ ] T039 [US2] Verify validation adds < 5 seconds to build time (per SC-004 performance goal)

**Checkpoint**: Validation script complete, integrated into builds, catches missing assets with clear errors

---

## Phase 5: User Story 3 - Prevent Plugin Runtime Failures (Priority: P3)

**Goal**: Verify end-to-end that plugins function correctly with assets available at runtime

**Independent Test**: Create test plugin using SDK types, Babel, and goober, verify it works in packaged application

**Acceptance Criteria** (from spec.md):
1. Plugin imports SDK types from assets without errors
2. Dynamic code transformation via Babel works from assets
3. Goober styles apply correctly from assets

### Verification for User Story 3

- [ ] T040 [P] [US3] Create test plugin that imports `@anikitenko/fdo-sdk` types from assets directory
- [ ] T041 [P] [US3] Add Babel transpilation test to test plugin using `@babel/standalone` from assets
- [ ] T042 [P] [US3] Add goober styling test to test plugin using goober from assets
- [ ] T043 [US3] Build and package application: `npm run dist:mac` (validation should pass)
- [ ] T044 [US3] Install test plugin in packaged application
- [ ] T045 [US3] Activate test plugin and verify SDK types import successfully
- [ ] T046 [US3] Verify Babel transpilation executes without errors
- [ ] T047 [US3] Verify goober styles apply to plugin UI
- [ ] T048 [US3] Check browser DevTools console for any missing module errors
- [ ] T049 [US3] Verify 100% functionality parity with development environment (per SC-002)

**Checkpoint**: All user stories complete, plugins work correctly in packaged application with assets

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements and verification across all user stories

- [ ] T050 [P] Test automatic synchronization: Add new webpack CopyWebpackPlugin pattern, verify validation checks for it automatically (per SC-006)
- [ ] T051 [P] Test automatic synchronization: Remove webpack pattern, verify validation no longer checks for it
- [ ] T052 [P] Build for all platforms if possible (macOS x64/arm64, Linux, Windows) and verify assets present in each (per SC-004)
- [ ] T053 [P] Document validation script usage in README.md or team documentation
- [ ] T054 [P] Add chalk dependency (optional) for colored console output in validation script
- [ ] T055 Code review validation script for clarity and maintainability
- [ ] T056 Verify all acceptance scenarios from spec.md are satisfied
- [ ] T057 Run complete quickstart.md verification checklist
- [ ] T058 Compare package size before/after to confirm ~5-15MB increase (per SC-005)
- [ ] T059 Document troubleshooting steps for common validation failures
- [ ] T060 Clean up any temporary test files or scripts created during development

**Checkpoint**: Feature complete, all success criteria verified, ready for production

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories  
- **User Story 1 (Phase 3)**: Depends on Foundational completion - Core packaging fix (MUST complete first)
- **User Story 2 (Phase 4)**: Depends on User Story 1 completion - Validation needs working package to test against
- **User Story 3 (Phase 5)**: Depends on User Story 1 completion - Can run in parallel with US2 if staffed
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - **BLOCKS** US2 and US3
- **User Story 2 (P2)**: Can start after US1 complete - Validation needs fixed packaging to test
- **User Story 3 (P3)**: Can start after US1 complete - Independent testing can run parallel to US2

### Within Each User Story

**User Story 1** (Packaging Fix):
1. Update configuration (T008-T010)
2. Build and verify (T011-T012)
3. Extract and confirm assets (T013-T015)
4. Runtime testing (T016-T017)

**User Story 2** (Validation):
1. Create validation script structure (T018-T019)
2. Implement parsing and comparison (T020-T024)
3. Implement output formatting (T025-T028)
4. Add error handling (T029-T030)
5. Integrate into build scripts (T031-T034)
6. Test validation scenarios (T035-T039)

**User Story 3** (Verification):
1. Create test plugin (T040-T042) - all parallelizable
2. Build and test (T043-T049)

### Parallel Opportunities

**Phase 1 - Setup**:
- T001 and T002 can run sequentially (quick tasks)
- T003 verification runs after T001-T002

**Phase 2 - Foundational**:
- T005 and T006 can run in parallel (different activities)

**Phase 3 - User Story 1**:
- T013, T014, T015 (ASAR extraction verification) can inspect in parallel if desired

**Phase 4 - User Story 2**:
- T018 and T019 can be developed in parallel (CLI parsing vs path detection)
- T032, T033, T034 (build script updates) can be done in parallel

**Phase 5 - User Story 3**:
- T040, T041, T042 (test plugin components) can be developed in parallel

**Phase 6 - Polish**:
- T050, T051, T052, T053, T054 can all run in parallel (independent improvements)

---

## Parallel Example: User Story 2 (Validation Script)

**Parallel Development Opportunities**:

```bash
# Core validation logic (can be developed by different developers simultaneously):
Developer A: T018 - CLI argument parsing
Developer B: T019 - Platform-specific path detection  
Developer C: T020-T021 - Webpack config parsing

# Once core is done:
Developer A: T025 - Success output formatting
Developer B: T026 - Failure output formatting
Developer C: T027 - JSON output mode

# Build integration:
Developer A: T032 - Mac build integration
Developer B: T033 - Linux build integration
Developer C: T034 - Windows build integration
```

---

## Implementation Strategy

### MVP First (User Story 1 Only) - Recommended Start

**Goal**: Get assets included in packaged application

1. ✅ Complete Phase 1: Setup (~10 minutes)
2. ✅ Complete Phase 2: Foundational (~20 minutes - verify current state)
3. ✅ Complete Phase 3: User Story 1 (~30 minutes - fix packaging)
4. **STOP and VALIDATE**: Test with real plugin, confirm assets accessible
5. **Deploy/Demo**: MVP working! Assets in package, plugins functional

**Why Stop Here?**: This is the minimum fix that solves the critical bug. Validation (US2) is important but not blocking plugin functionality.

### Incremental Delivery

**Iteration 1 - MVP** (Phase 1-3):
- Assets included in package → Plugins work in production ✅
- **Value**: Critical bug fixed, plugins functional
- **Time**: ~1 hour

**Iteration 2 - Add Validation** (Phase 4):
- Automated validation prevents regression → Build fails if assets missing ✅
- **Value**: Quality assurance, prevents future breakage
- **Time**: ~2 hours

**Iteration 3 - Complete** (Phase 5-6):
- Comprehensive testing and polish → Production-ready ✅
- **Value**: High confidence, cross-platform verified
- **Time**: ~1 hour

**Total Implementation Time**: ~4 hours end-to-end

### Parallel Team Strategy

With 2 developers:

1. **Together**: Complete Setup + Foundational (30 minutes)
2. **Together**: Complete User Story 1 - critical fix (30 minutes)
3. **Split**:
   - Developer A: User Story 2 (validation script) - 2 hours
   - Developer B: User Story 3 (testing/verification) - 1 hour
4. **Together**: Polish and cross-platform testing (1 hour)

**Total Team Time**: ~3 hours with 2 developers

With 1 developer:

Follow **Incremental Delivery** strategy above, stop at any checkpoint to validate and potentially deploy.

---

## Task Execution Checklist

**Before Starting**:
- [ ] All design documents reviewed (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)
- [ ] Current issue understood (assets exist after webpack but not in ASAR)
- [ ] Target platform identified (macOS, Linux, or Windows)

**During Implementation**:
- [ ] Follow task order within each phase
- [ ] Mark tasks complete as you go: `- [x]`
- [ ] Commit after each logical group or checkpoint
- [ ] Test at each checkpoint before proceeding
- [ ] If validation fails, stop and troubleshoot before continuing

**After Each Phase**:
- [ ] Verify checkpoint criteria met
- [ ] Test independently if possible
- [ ] Document any deviations or issues
- [ ] Consider deploying/demoing at MVP checkpoint

**Final Verification** (Phase 6 Complete):
- [ ] All acceptance scenarios from spec.md verified ✅
- [ ] All success criteria (SC-001 through SC-006) verified ✅
- [ ] Quickstart.md verification checklist passed ✅
- [ ] Cross-platform builds tested (if applicable) ✅
- [ ] Documentation updated ✅

---

## Task Summary

| Phase | Task Count | Parallelizable | Estimated Time |
|-------|------------|----------------|----------------|
| Phase 1: Setup | 3 | 1 | 10 minutes |
| Phase 2: Foundational | 4 | 2 | 20 minutes |
| Phase 3: User Story 1 (MVP) | 10 | 0 | 30 minutes |
| Phase 4: User Story 2 | 22 | 4 | 2 hours |
| Phase 5: User Story 3 | 10 | 3 | 1 hour |
| Phase 6: Polish | 11 | 5 | 1 hour |
| **Total** | **60** | **15** | **~4-5 hours** |

### By User Story

- **US1** (Package Assets): 10 tasks - Critical MVP
- **US2** (Validation): 22 tasks - Quality assurance
- **US3** (Verification): 10 tasks - Comprehensive testing

### Parallel Execution Potential

- **15 tasks** (25%) can run in parallel with proper coordination
- **User Stories 2 and 3** can partially overlap after US1 completes
- **Polish tasks** are highly parallelizable (5 out of 11)

---

## Notes

- **[P] tasks**: Different files or independent activities, can run in parallel
- **[Story] labels**: Map tasks to specific user stories for traceability and independent testing
- **MVP Strategy**: Phase 3 (US1) is minimum viable fix - stops critical bug
- **Validation adds value**: Phase 4 (US2) prevents regression but isn't blocking for basic functionality
- **File paths are exact**: Use absolute paths as provided, adjust for your environment
- **Checkpoints are critical**: Stop and validate at each checkpoint before proceeding
- **Independent testing**: Each user story should work standalone (US1 = assets in package, US2 = validation catches issues, US3 = plugins work)
- **Estimated times**: Based on research decisions already made, actual implementation should be straightforward
- **Success criteria mapping**: Tasks directly implement requirements from spec.md functional requirements (FR-001 through FR-009)

---

## Quick Reference: Critical Files

| File | Purpose | Modified By |
|------|---------|-------------|
| `package.json` | Electron-builder config, build scripts | US1 (T008-T009), US2 (T031-T034) |
| `webpack.renderer.config.js` | Source of truth for expected assets | Referenced by validation (not modified) |
| `scripts/validate-asar-assets.js` | Post-packaging validation | US2 (T018-T030) |
| `dist/renderer/assets/node_modules/` | Webpack build output (already working) | Verified by US1 (T003) |
| `release/.../app.asar` | Final packaged application | Validated by US1 (T013-T015), US2 (entire phase) |

---

## Success Verification

**You've successfully completed the feature when**:

✅ All 60 tasks are marked complete  
✅ All checkpoints passed  
✅ Validation reports "Assets Found: 3/3"  
✅ Manual ASAR extraction shows all three packages  
✅ Test plugin works in packaged app  
✅ Adding webpack patterns auto-updates validation  
✅ All success criteria (SC-001 through SC-006) verified  
✅ Quickstart.md checklist passed

**Ready to ship!** 🚀

