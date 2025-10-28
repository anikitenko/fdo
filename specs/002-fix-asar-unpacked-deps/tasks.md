# Tasks: Fix Unwanted Dependencies in Packaged Application

**Input**: Design documents from `/specs/002-fix-asar-unpacked-deps/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/validation-api.md, quickstart.md

**Tests**: No explicit test tasks required - validation is built into the packaging process via afterPack hook

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. However, note that User Stories 2 and 3 are tightly coupled with User Story 1 in this feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is a build configuration fix for an Electron desktop application:
- Configuration files: `webpack.main.config.js`, `package.json` at repository root
- New validation scripts: `scripts/` directory at repository root
- Build output: `dist/`, `release/` directories (inspected, not modified)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare workspace for configuration changes and validation script development

- [x] T001 Create `scripts/` directory at repository root for validation scripts
- [x] T002 [P] Review research.md to understand root cause and solution approach
- [x] T003 [P] Review data-model.md to understand configuration schema

**Checkpoint**: ✅ Workspace prepared, design documents understood

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backup existing configuration and establish baseline

**⚠️ CRITICAL**: Complete backup before making any configuration changes

- [x] T004 Backup current `webpack.main.config.js` to `webpack.main.config.js.backup`
- [x] T005 Backup current `package.json` build section (document current asarUnpack patterns)
- [x] T006 Document current package size by running `npm run dist:mac` and recording DMG size in specs/002-fix-asar-unpacked-deps/baseline-metrics.md
- [x] T007 [P] Document current packages in unpacked resources by listing contents of `release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules/`

**Checkpoint**: ✅ Baseline established, safe to proceed with configuration changes

---

## Phase 3: User Story 1 - Package Application with Only Required Dependencies (Priority: P1) 🎯 MVP

**Goal**: Fix the root cause by updating webpack and electron-builder configurations to include only the three required packages (esbuild, @esbuild, @anikitenko/fdo-sdk) in unpacked resources

**Independent Test**: After completing this phase, package the application and verify `app.asar.unpacked/node_modules` contains exactly 3 packages

**Acceptance Criteria**:
- Packaged application contains exactly three packages in unpacked resources
- No unwanted packages (@unrs, electron, fsevents) present
- Application launches and all plugin functionality works correctly

### Implementation for User Story 1

- [ ] T008 [P] [US1] Update webpack externals in `webpack.main.config.js` - Add `"@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk"` to externals object (lines 35-37)
- [ ] T009 [US1] Update asarUnpack configuration in `package.json` - Replace wildcard pattern `"dist/main/node_modules/**/*"` with specific patterns (lines 168-170):
  ```json
  "asarUnpack": [
    "dist/main/node_modules/esbuild/**/*",
    "dist/main/node_modules/@esbuild/**/*",
    "dist/main/node_modules/@anikitenko/**/*"
  ]
  ```
- [x] T010 [US1] Clean build artifacts by running `rm -rf dist/ release/` to ensure fresh build
- [x] T011 [US1] Test configuration changes by running `npm run build && npm run dist:mac`
- [x] T012 [US1] Verify package contents by listing `release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules/` - should show only 3 directories
- [ ] T013 [US1] Verify application functionality by launching packaged app and testing plugin build/deploy workflow
- [ ] T014 [US1] Test on additional platforms (if available): Windows (`npm run dist:win`), Linux (`npm run dist:linux`)

**Checkpoint**: User Story 1 complete - packaged application contains only required dependencies and functions correctly

---

## Phase 4: User Story 2 - Verify Package Integrity After Packaging (Priority: P2)

**Goal**: Add automated validation that runs after electron-builder to prevent regression and catch packaging issues immediately

**Independent Test**: Intentionally add an unexpected package to asarUnpack configuration, run build, and verify it fails with clear error message

**Acceptance Criteria**:
- Validation script runs automatically after packaging
- Build fails if unexpected packages detected
- Error messages show actual vs expected packages
- Validation completes in <100ms (negligible build time impact)

### Implementation for User Story 2

- [ ] T015 [P] [US2] Create validation script `scripts/validate-package.js` implementing the contract from `contracts/validation-api.md`:
  - Export afterPack hook function
  - Accept electron-builder context parameter
  - Determine platform-specific unpacked path
  - List packages in node_modules directory
  - Compare actual vs expected (esbuild, @esbuild, @anikitenko)
  - Log validation results to console
  - Throw error if unexpected packages found
  - Throw error if expected packages missing
- [ ] T016 [US2] Implement `getUnpackedPath(appOutDir, platform)` helper function in `scripts/validate-package.js` (see contracts/validation-api.md for signature)
- [ ] T017 [P] [US2] Implement `listPackages(nodeModulesPath)` helper function in `scripts/validate-package.js`
- [ ] T018 [P] [US2] Implement `comparePackages(actual, expected)` helper function in `scripts/validate-package.js`
- [ ] T019 [US2] Add afterPack hook configuration to `package.json` build section: `"afterPack": "./scripts/validate-package.js"` (add after line 170)
- [ ] T020 [US2] Make validation script executable: `chmod +x scripts/validate-package.js` (Unix systems)
- [ ] T021 [US2] Test validation success case by running `npm run dist:mac` and verifying "[Validation] ✅ Package validation passed!" in output
- [ ] T022 [US2] Test validation failure case:
  - Temporarily change asarUnpack back to wildcard `"dist/main/node_modules/**/*"`
  - Run `npm run dist:mac`
  - Verify build FAILS with error listing unexpected packages
  - Revert asarUnpack to specific patterns
- [ ] T023 [US2] Verify validation runs on all target platforms (macOS, Windows, Linux if available)

**Checkpoint**: User Story 2 complete - automated validation prevents regression

---

## Phase 5: User Story 3 - Reduce Application Package Size (Priority: P3)

**Goal**: Measure and document the package size reduction achieved by removing unwanted dependencies

**Independent Test**: Compare packaged application size before and after the fix, verify 50-100MB reduction

**Acceptance Criteria**:
- Package size reduced by at least 50MB
- All features work identically to previous version
- Reduction documented for all platforms

### Implementation for User Story 3

- [ ] T024 [US3] Measure final package size by recording DMG size after fix: `du -sh release/mac/FDO*.dmg`
- [ ] T025 [US3] Calculate size reduction by comparing to baseline metrics from T006
- [ ] T026 [US3] Document size reduction in `specs/002-fix-asar-unpacked-deps/size-reduction-results.md`:
  - Before size (from T006)
  - After size (from T024)
  - Reduction amount and percentage
  - List of packages removed (@unrs, electron, fsevents, others)
- [ ] T027 [P] [US3] Verify functional parity by testing all application features:
  - Application launches
  - Plugin editor opens
  - Can create new plugin
  - Plugin build works (uses esbuild)
  - Plugin deploy works (uses @anikitenko/fdo-sdk)
  - No console errors
- [ ] T028 [US3] Measure package size on other platforms (Windows, Linux) if available and document
- [ ] T029 [US3] Update success criteria checklist in `specs/002-fix-asar-unpacked-deps/quickstart.md` with actual measurements

**Checkpoint**: User Story 3 complete - size reduction verified and documented

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize implementation with documentation, cleanup, and final verification

- [ ] T030 [P] Update `quickstart.md` with final verification instructions based on actual test results
- [ ] T031 [P] Update `.gitignore` to exclude backup files (`*.backup`, `baseline-metrics.md`, `size-reduction-results.md`) if not already excluded
- [ ] T032 Remove backup files created in Phase 2 (T004, T005) after confirming changes work correctly
- [ ] T033 Add comments to `webpack.main.config.js` documenting the externals configuration and why each package is listed
- [ ] T034 Add comments to `package.json` asarUnpack section documenting the three required packages
- [ ] T035 [P] Add comments to `scripts/validate-package.js` explaining the validation logic and how to update EXPECTED_PACKAGES
- [ ] T036 Run full verification workflow from `quickstart.md` (10-15 minute checklist)
- [ ] T037 Update `README.md` (if needed) with notes about package validation in build process
- [ ] T038 [P] Document troubleshooting steps in `specs/002-fix-asar-unpacked-deps/TROUBLESHOOTING.md` based on issues encountered during implementation
- [ ] T039 Commit all changes with descriptive commit message referencing User Stories 1, 2, and 3
- [ ] T040 Create pull request with summary of changes, size reduction achieved, and verification results

**Checkpoint**: All polish tasks complete, ready for code review and merge

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion - BLOCKS User Stories 2 & 3
- **User Story 2 (Phase 4)**: Depends on User Story 1 (Phase 3) completion - validation requires correct configuration
- **User Story 3 (Phase 5)**: Depends on User Story 1 (Phase 3) completion - size reduction is side effect of correct configuration
- **Polish (Phase 6)**: Depends on all user stories (Phases 3, 4, 5) completion

### User Story Dependencies

**Important Note**: Unlike typical features, these user stories are tightly coupled:

- **User Story 1 (P1)**: BLOCKING - Must complete first (core bug fix)
- **User Story 2 (P2)**: Depends on US1 - Validates the fix implemented in US1
- **User Story 3 (P3)**: Depends on US1 - Measures the impact of US1's fix

**Why the tight coupling**:
- US1 is the actual fix (configuration changes)
- US2 automates verification of US1 (validation script)
- US3 measures the outcome of US1 (size reduction)

### Within Each User Story

**User Story 1**:
- T008 (webpack externals) and T009 (asarUnpack) can be done in parallel [P]
- T010 (clean) must come after T008 and T009
- T011 (build) must come after T010
- T012-T014 (verification) must come after T011

**User Story 2**:
- T015-T018 (validation script and helpers) can be partially parallelized [P]
- T016-T018 (helper functions) can be implemented in parallel [P]
- T019-T020 (hook config) must come after T015
- T021-T023 (testing) must come after T019-T020

**User Story 3**:
- T024-T026 (size measurement) are sequential
- T027 (functional testing) can be done in parallel with T024-T026 [P]
- T028-T029 (additional platforms) must come after T024-T027

### Parallel Opportunities

**Setup Phase (Phase 1)**:
- T002 and T003 can be done in parallel [P] (reading different documents)

**Foundational Phase (Phase 2)**:
- T004 and T005 can be done in parallel [P] (backing up different files)
- T006 and T007 can be done in parallel [P] (documenting baseline metrics)

**User Story 1 (Phase 3)**:
- T008 and T009 can be done in parallel [P] (editing different files)

**User Story 2 (Phase 4)**:
- T015, T017, T018 can be started in parallel [P] (implementing different functions in same file - coordinate to avoid conflicts)

**User Story 3 (Phase 5)**:
- T027 can be done in parallel with T024-T026 [P] (testing while measuring)
- T028 can be done in parallel with T029 [P] (different platforms)

**Polish Phase (Phase 6)**:
- T030, T031, T035, T038 can all be done in parallel [P] (different files)

---

## Parallel Example: User Story 1

```bash
# These tasks can be launched together:
Task T008: "Update webpack externals in webpack.main.config.js"
Task T009: "Update asarUnpack configuration in package.json"

# Then sequentially:
Task T010: "Clean build artifacts"
Task T011: "Test configuration changes by building"
Task T012: "Verify package contents"
Task T013: "Verify application functionality"
Task T014: "Test on additional platforms"
```

## Parallel Example: User Story 2

```bash
# Implementation tasks that can be parallelized (with coordination):
Task T016: "Implement getUnpackedPath() in scripts/validate-package.js"
Task T017: "Implement listPackages() in scripts/validate-package.js"
Task T018: "Implement comparePackages() in scripts/validate-package.js"

# Note: All three are in the same file, so developers must coordinate
# or one developer completes all three sequentially
```

---

## Implementation Strategy

### MVP First (User Story 1 Only) - RECOMMENDED

1. Complete Phase 1: Setup (Tasks T001-T003)
2. Complete Phase 2: Foundational (Tasks T004-T007)
3. Complete Phase 3: User Story 1 (Tasks T008-T014)
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Package contains exactly 3 packages
   - Application works correctly
   - Plugin build/deploy functions
5. **Optional**: Can deploy/release at this point with manual verification

**Rationale**: User Story 1 alone fixes the bug. US2 and US3 add automation and metrics but aren't required for the fix to work.

### Incremental Delivery (All Stories) - COMPLETE FIX

1. Complete Setup + Foundational → Workspace ready
2. Complete User Story 1 → **Validate independently** → Core fix working ✅
3. Complete User Story 2 → **Validate independently** → Automated validation working ✅
4. Complete User Story 3 → **Validate independently** → Size reduction verified ✅
5. Complete Polish → Final cleanup and documentation

**Rationale**: Each story adds value incrementally:
- US1: Fix works
- US2: Fix stays fixed (regression prevention)
- US3: Fix impact measured and documented

### Sequential Strategy (Single Developer)

Recommended order for a single developer:

1. Setup (1-2 hours)
   - Read design documents
   - Create scripts directory
   - Take baseline measurements

2. Configuration Fix (2-3 hours)
   - Update webpack.main.config.js
   - Update package.json
   - Test and verify

3. Validation Script (2-3 hours)
   - Implement validate-package.js
   - Add afterPack hook
   - Test success and failure cases

4. Measurement & Verification (1 hour)
   - Measure size reduction
   - Document results
   - Final functional testing

5. Polish (1-2 hours)
   - Documentation updates
   - Code cleanup
   - Final verification

**Total Estimated Time**: 8-11 hours for complete implementation

### Parallel Team Strategy (If Multiple Developers)

**NOT RECOMMENDED**: This feature is too small and tightly coupled for parallel work. Configuration changes and validation script are closely related. Single developer implementation is more efficient.

If parallel work is necessary:
1. Developer A: Complete Setup + Foundational together
2. Developer A: Complete User Story 1 (configuration fix)
3. Developer B: Complete User Story 2 (validation script) - starts after US1 configuration is committed
4. Developer A or B: Complete User Story 3 (measurement) - starts after US1 is working
5. Both: Review and polish together

---

## Success Criteria Validation

After completing all tasks, verify against success criteria from spec.md:

### SC-001: Exactly Three Packages
**Validated by**: T012, T021
- [ ] Packaged application contains exactly 3 packages
- [ ] Packages are: esbuild, @esbuild, @anikitenko
- [ ] No other packages present

### SC-002: Package Size Reduction
**Validated by**: T024, T025, T026
- [ ] Package size reduced by ≥50MB
- [ ] Reduction documented in size-reduction-results.md
- [ ] Reduction percentage calculated

### SC-003: 100% Functional Parity
**Validated by**: T013, T027
- [ ] Application launches successfully
- [ ] All plugin workflows functional
- [ ] No new console errors
- [ ] All tests pass (if any exist)

### SC-004: Build Time Impact <10%
**Validated by**: T011, T021
- [ ] Build time measured before and after
- [ ] Validation adds <100ms overhead
- [ ] Total impact <10% of baseline

### SC-005: Automated Regression Prevention
**Validated by**: T021, T022, T023
- [ ] Validation runs automatically
- [ ] Build fails on unexpected packages
- [ ] Error messages are clear and actionable

---

## Notes

- **[P] tasks**: Different files or parallelizable functions - no direct dependencies
- **[Story] label**: Maps task to specific user story (US1, US2, US3) for traceability
- **File paths**: All paths are relative to repository root
- **Backups**: Keep T004 and T005 backup files until final verification (T036) passes
- **Platform testing**: If only macOS available, skip Windows/Linux verification tasks
- **Commit frequency**: Commit after each phase for easy rollback
- **Validation first**: Always run validation (T021) before considering implementation complete

### Common Pitfalls to Avoid

1. **Not cleaning build artifacts** (T010): Old packages in dist/ will contaminate the build
2. **Forgetting to make script executable** (T020): Validation won't run on Unix systems
3. **Not testing validation failure** (T022): Critical to ensure validation actually works
4. **Skipping functional testing** (T013, T027): Configuration changes can break runtime
5. **Not documenting baseline** (T006, T007): Can't prove size reduction without baseline

### Quick Reference Commands

```bash
# Clean build
rm -rf dist/ release/

# Build and package (macOS)
npm run build && npm run dist:mac

# Verify package contents (macOS)
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/

# Check package size (macOS)
du -sh release/mac/FDO*.dmg

# Test validation script directly
node scripts/validate-package.js

# Make script executable
chmod +x scripts/validate-package.js
```

---

**Total Tasks**: 40  
**Estimated Duration**: 8-11 hours (single developer)  
**Parallel Opportunities**: 12 tasks marked [P]  
**Critical Path**: Setup → Foundational → US1 → US2 → US3 → Polish  
**MVP Scope**: Phases 1-3 (Tasks T001-T014) - Core bug fix only

