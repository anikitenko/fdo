# Implementation Tasks: NPM Package Updates and Deprecation Resolution

**Feature**: 005-npm-package-updates  
**Branch**: `005-npm-package-updates`  
**Date**: 2025-10-28  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Overview

This document provides an actionable, dependency-ordered task list for implementing the NPM package updates feature. Tasks are organized by user story (P1, P2, P3) to enable independent implementation, testing, and delivery of value.

---

## Task Summary

| Phase | User Story | Task Count | Can Be Parallelized |
|-------|-----------|------------|---------------------|
| **Phase 1** | Setup | 5 | Yes (T002-T005) |
| **Phase 2** | Foundational | 8 | Partial (T007-T010, T012-T013) |
| **Phase 3** | US1 (P1 - MVP) | 12 | Partial (T016-T017, T020-T023, T025-T026) |
| **Phase 4** | US2 (P2) | 7 | Partial (T029-T030, T032-T034) |
| **Phase 5** | US3 (P3) | 5 | Partial (T037-T038, T040-T041) |
| **Phase 6** | Polish | 4 | Yes (T043-T046) |
| **TOTAL** | | **41 tasks** | **24 parallelizable** |

---

## Implementation Strategy

### MVP Scope (User Story 1 - P1)

Implement **Phase 1, 2, and 3 only** for a functional MVP that:
- ✅ Resolves deprecation warnings
- ✅ Detects and documents deprecated packages without replacements (technical debt)
- ✅ Generates technical debt report
- ✅ Validates through test suite
- ✅ Provides automated rollback on failures

This MVP delivers immediate value and can be deployed independently before implementing US2 and US3.

### Incremental Delivery

1. **Sprint 1**: Phases 1-3 (MVP - US1)
2. **Sprint 2**: Phase 4 (US2 - Full package updates)
3. **Sprint 3**: Phase 5 (US3 - Lock file optimization)
4. **Sprint 4**: Phase 6 (Polish & documentation)

---

## Phase 1: Setup

**Goal**: Initialize project structure and install required dependencies.

**Duration**: ~30 minutes

**Dependencies**: None

### Tasks

- [x] T001 Create reports directory at `specs/005-npm-package-updates/reports/`
- [x] T002 [P] Install npm-check-updates package as devDependency in `package.json`
- [x] T003 [P] Install semver package for version comparison in `package.json`
- [x] T004 [P] Install simple-git package for Git operations in `package.json`
- [x] T005 [P] Create placeholder files for main modules: `src/utils/packageUpdater.js`, `src/utils/packageUpdater/batchProcessor.js`, `src/utils/packageUpdater/reportGenerator.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Implement core utilities, error types, and validation logic that all user stories depend on.

**Duration**: ~4 hours

**Dependencies**: Phase 1 complete

### Tasks

- [x] T006 Implement custom error types in `src/utils/packageUpdater/errors.js`: GitNotAvailableError, TestFailureError, AuditFailureError, RollbackFailureError with messages and recovery guidance
- [x] T007 [P] Implement validation functions in `src/utils/packageUpdater/validators.js`: validatePackageDependency, validateUpdateBatch, validateBreakingChange, validateTechnicalDebt, validateRollbackCheckpoint, validateTestResults, validateAuditResults
- [x] T008 [P] Implement Git checkpoint utilities in `src/utils/packageUpdater/git.js`: createRollbackCheckpoint(message), rollbackToCheckpoint(checkpoint), getCommitHash(), hashFile(path)
- [x] T009 [P] Implement npm command wrappers in `src/utils/packageUpdater/npm.js`: runInstall(), runAudit(), getOutdated(), getPackageInfo(name), runCi()
- [x] T010 [P] Implement Jest test runner integration in `src/utils/packageUpdater/testRunner.js`: runTests(options), parseTestResults(jestOutput)
- [x] T011 Create UpdateBatch state machine in `src/utils/packageUpdater/stateMachine.js`: transition(batch, event), validateTransition(from, event), with all 7 states and 8 transitions from data-model.md
- [x] T012 [P] Implement package analysis utilities in `src/utils/packageUpdater/analyzer.js`: parsePackageJson(), getInstalledVersion(name), isDirect Dependency(name), getVersionConstraint(name)
- [x] T013 [P] Implement semver comparison helpers in `src/utils/packageUpdater/semver.js`: hasMajorUpdate(current, latest), isCompatibleUpdate(current, latest, target), preserveConstraint(original, newVersion)

---

## Phase 3: User Story 1 (P1 - MVP) 🎯

**User Story**: As a developer, when I run `npm install`, I want to see zero deprecation warnings so that I can be confident the project uses current, supported packages.

**Goal**: Detect deprecated packages, distinguish between packages with/without replacements, generate technical debt report.

**Independent Test Criteria**:
1. Run `npm install` before implementation → Record deprecation warnings
2. Run package detection → Verify deprecated packages identified
3. Generate technical debt report → Verify packages without replacements are documented
4. Run `npm install` after updates → Verify warnings minimized (only documented technical debt remains)

**Duration**: ~8 hours

**Dependencies**: Phase 2 complete

### Tasks

#### Detection & Analysis

- [ ] T015 [US1] Implement detectDeprecations() in `src/utils/packageUpdater/index.js`: Parse npm install stderr, extract deprecation warnings, return DeprecationInfo[] with packageName, currentVersion, deprecationReason, hasReplacement, replacementPackage
- [ ] T016 [P] [US1] Implement parseDeprecationWarning(stderr) helper in `src/utils/packageUpdater/parser.js`: Extract package name and message from npm WARN deprecated format
- [ ] T017 [P] [US1] Implement findReplacement(packageName) in `src/utils/packageUpdater/analyzer.js`: Check npm registry for suggested replacement, search common migration patterns, return replacement package name or null

#### Report Generation

- [ ] T018 [US1] Implement generateTechnicalDebtReport(debt) in `src/utils/packageUpdater/reportGenerator.js`: Create Markdown table with package, version, reason, monitoring plan, save to `specs/005-npm-package-updates/reports/technical-debt-report.md`
- [ ] T019 [US1] Create monitoring plan template in reportGenerator.js: Default strategy for packages without replacement (monthly security checks, migration timeline)

#### Integration & Orchestration

- [ ] T020 [P] [US1] Implement updateDeprecatedPackages() in `src/utils/packageUpdater/index.js`: Detect deprecations, filter packages with replacements, update package.json, create checkpoint, run npm install
- [ ] T021 [US1] Integrate deprecation detection with rollback in batchProcessor.js: If npm install fails after deprecation updates, rollback to checkpoint
- [ ] T022 [P] [US1] Add deprecation tracking to UpdateBatch entity in `src/utils/packageUpdater/models.js`: Store deprecated packages list, track replacement status
- [ ] T023 [P] [US1] Implement logDeprecationSummary() in `src/utils/packageUpdater/logger.js`: Console output showing packages with/without replacements, technical debt count

#### Validation & Testing

- [ ] T024 [US1] Add validation for technical debt records in validators.js: Ensure deprecationReason and monitoringPlan are non-empty
- [ ] T025 [P] [US1] Create integration test for deprecation detection in `tests/integration/deprecation.test.js`: Mock deprecated packages, verify detection, test report generation
- [ ] T026 [P] [US1] Create unit tests for deprecation parser in `tests/unit/parser.test.js`: Test various npm warning formats, verify correct extraction

---

## Phase 4: User Story 2 (P2)

**User Story**: As a developer, I want all npm packages updated to their latest compatible versions so that the project benefits from bug fixes, performance improvements, and security patches.

**Goal**: Update all packages to latest minor/patch versions, skip breaking changes, run tests and security audit, generate breaking changes report.

**Independent Test Criteria**:
1. Run `npm outdated` before updates → Record outdated packages
2. Execute update process → Verify packages updated to latest compatible versions
3. Run `npm outdated` after updates → Verify zero packages with major updates available
4. Run test suite → Verify 100% pass rate
5. Run `npm audit` → Verify zero high/critical vulnerabilities
6. Review breaking changes report → Verify skipped packages documented with changelogs

**Duration**: ~12 hours

**Dependencies**: Phase 3 complete (can reuse checkpoint, test runner, report generator)

### Tasks

#### Breaking Changes Detection

- [ ] T028 [US2] Implement detectBreakingChanges() in `src/utils/packageUpdater/index.js`: Use npm outdated, compare versions with semver.major(), filter packages with major version bumps, fetch changelog URLs from npm registry
- [ ] T029 [P] [US2] Implement getChangelogUrl(packageName) in `src/utils/packageUpdater/registry.js`: Query npm registry for repository.url, construct GitHub/GitLab releases URL
- [ ] T030 [P] [US2] Implement generateBreakingChangesReport(changes) in reportGenerator.js: Create Markdown table with package, current version, latest version, changelog link, save to `specs/005-npm-package-updates/reports/breaking-changes-report.md`

#### Batch Processing

- [ ] T031 [US2] Implement processBatch(batch, options) in `src/utils/packageUpdater/batchProcessor.js`: Execute state machine transitions (PENDING → UPDATING → TESTING → AUDITING → SUCCESS), handle failures → ROLLING_BACK, return BatchResult
- [ ] T032 [P] [US2] Implement batch creation logic in `src/utils/packageUpdater/index.js`: Group packages by type (devDependencies, dependencies), create UpdateBatch entities with IDs, timestamps, rollback checkpoints
- [ ] T033 [P] [US2] Implement runSecurityAudit() in `src/utils/packageUpdater/index.js`: Execute npm audit --json, parse vulnerabilities by severity, return AuditResults with success boolean (zero high/critical)
- [ ] T034 [P] [US2] Integrate test runner with batch processor in batchProcessor.js: Run Jest after npm install, parse results, trigger rollback if tests fail

#### Main Update Workflow

- [ ] T035 [US2] Implement updatePackages(options) main entry point in `src/utils/packageUpdater/index.js`: Create checkpoints, process devDependencies batch first, then dependencies batch, generate reports, return UpdateResult with success status, batch results, summary
- [ ] T036 [US2] Add batch sequencing logic in updatePackages(): Wait for devDependencies batch SUCCESS before starting dependencies batch, rollback both batches if either fails
- [ ] T037 [P] [US2] Implement generateSummaryReport(summary) in reportGenerator.js: Create summary with updated count, skipped count, test results, audit results, save to `specs/005-npm-package-updates/reports/update-summary.md`

---

## Phase 5: User Story 3 (P3)

**User Story**: As a developer, I want a clean package-lock.json file with resolved dependencies so that installations are fast, reproducible, and conflict-free.

**Goal**: Regenerate package-lock.json, resolve peer dependency conflicts, optimize dependency tree.

**Independent Test Criteria**:
1. Delete node_modules and package-lock.json
2. Run `npm install` → Measure installation time
3. Verify no peer dependency warnings
4. Check package-lock.json size < 5MB
5. Multiple developers install → Verify identical dependency trees

**Duration**: ~6 hours

**Dependencies**: Phase 4 complete

### Tasks

#### Lock File Optimization

- [ ] T039 [US3] Implement optimizeLockFile() in `src/utils/packageUpdater/index.js`: Delete package-lock.json, run npm install, verify no conflicts, validate lock file integrity
- [ ] T040 [P] [US3] Implement resolvePeerDependencies() in `src/utils/packageUpdater/npm.js`: Detect peer dependency warnings from npm output, attempt resolution strategies (--legacy-peer-deps, manual version selection), log resolution decisions
- [ ] T041 [P] [US3] Implement validateLockFile() in validators.js: Check file size, verify all dependencies have integrity hashes, ensure resolved URLs are valid

#### Performance Measurement

- [ ] T042 [US3] Add installation timing to batch processor in batchProcessor.js: Measure npm install duration, compare against 2-minute target, log warnings if slow
- [ ] T043 [P] [US3] Implement generatePerformanceReport() in reportGenerator.js: Include installation times, lock file size, dependency count in summary report

---

## Phase 6: Polish & Cross-Cutting Concerns

**Goal**: CLI script, documentation, error handling improvements, final testing.

**Duration**: ~6 hours

**Dependencies**: Phases 3, 4, 5 complete

### Tasks

#### CLI Script

- [ ] T044 [P] Create CLI script in `scripts/updatePackages.js`: Parse command-line arguments (--dry-run, --skip-tests, --skip-audit, --target, --batch, --include, --exclude, --no-rollback, --no-reports, --help), call updatePackages() with parsed options, handle exit codes (0=success, 1=failure, 2=partial)
- [ ] T045 [P] Add help text to CLI script: Document all options with examples, show usage patterns for common scenarios (dry-run, devDependencies only, specific packages)
- [ ] T046 [P] Add npm script to `package.json`: Create `npm run update-packages` shortcut, document in README

#### Documentation & Refinement

- [ ] T047 Update project README with package update instructions: Link to quickstart.md, explain when/how to run updates, document rollback procedure

---

## Task Dependencies & Execution Order

### Critical Path (Sequential)

```
T001 (Setup) 
  ↓
T006 (Error types) 
  ↓
T011 (State machine) 
  ↓
T015 (Deprecation detection) → T018 (Technical debt report)
  ↓
T028 (Breaking changes detection) → T030 (Breaking changes report)
  ↓
T031 (Batch processor) 
  ↓
T035 (Main update workflow)
  ↓
T044 (CLI script)
```

### Parallel Execution Opportunities

#### Phase 1 Setup (All parallel after T001)
```
T001 (Create directories)
  ├─ T002 [P] (Install npm-check-updates)
  ├─ T003 [P] (Install semver)
  ├─ T004 [P] (Install simple-git)
  └─ T005 [P] (Create placeholder files)
```

#### Phase 2 Foundational (After T006)
```
T006 (Error types)
  ├─ T007 [P] (Validators)
  ├─ T008 [P] (Git utilities)
  ├─ T009 [P] (npm wrappers)
  ├─ T010 [P] (Test runner)
  ├─ T012 [P] (Analyzer)
  └─ T013 [P] (Semver helpers)
  
T011 (State machine - sequential after T006)
```

#### Phase 3 User Story 1 (After T011)
```
T015 (Deprecation detection)
  ├─ T016 [P] (Parser)
  ├─ T017 [P] (Find replacement)
  ├─ T020 [P] (Update deprecated)
  ├─ T022 [P] (Batch tracking)
  ├─ T023 [P] (Logging)
  ├─ T025 [P] (Integration tests)
  └─ T026 [P] (Unit tests)

T018 (Technical debt report - depends on T015)
T019 (Monitoring plan - depends on T018)
T021 (Rollback integration - depends on T015, T018)
T024 (Validation - depends on T015)
```

#### Phase 4 User Story 2 (After Phase 3)
```
T028 (Breaking changes detection)
  ├─ T029 [P] (Changelog URLs)
  ├─ T030 [P] (Breaking changes report)
  ├─ T032 [P] (Batch creation)
  ├─ T033 [P] (Security audit)
  ├─ T034 [P] (Test integration)
  └─ T037 [P] (Summary report)

T031 (Batch processor - depends on T028)
T035 (Update workflow - depends on T031)
T036 (Batch sequencing - depends on T035)
```

#### Phase 5 User Story 3 (After Phase 4)
```
T039 (Lock file optimization)
  ├─ T040 [P] (Peer dependencies)
  ├─ T041 [P] (Validation)
  └─ T043 [P] (Performance report)

T042 (Installation timing - depends on T039)
```

#### Phase 6 Polish (All parallel)
```
T044 [P] (CLI script)
T045 [P] (Help text)
T046 [P] (npm scripts)
T047 (README update - sequential after T044-T046)
```

---

## Testing Strategy

### Unit Tests (Per User Story)

**User Story 1**:
- `tests/unit/parser.test.js`: Deprecation warning parsing
- `tests/unit/validators.test.js`: Technical debt validation
- `tests/unit/semver.test.js`: Version comparison logic

**User Story 2**:
- `tests/unit/batchProcessor.test.js`: State machine transitions
- `tests/unit/registry.test.js`: Changelog URL fetching
- `tests/unit/npm.test.js`: npm command wrappers

**User Story 3**:
- `tests/unit/lockFile.test.js`: Lock file validation
- `tests/unit/performance.test.js`: Timing measurements

### Integration Tests (Per User Story)

**User Story 1**:
- `tests/integration/deprecation.test.js`: End-to-end deprecation detection and reporting

**User Story 2**:
- `tests/integration/fullUpdate.test.js`: Complete update workflow (both batches)
- `tests/integration/rollback.test.js`: Rollback on test/audit failure
- `tests/integration/dryRun.test.js`: Dry-run mode validation

**User Story 3**:
- `tests/integration/lockFileOptimization.test.js`: Lock file regeneration and validation

### Manual Testing Checklist

**After US1 (MVP)**:
- [ ] Run `npm install` → Verify deprecation warnings reduced
- [ ] Check `specs/005-npm-package-updates/reports/technical-debt-report.md` → Verify packages documented
- [ ] Attempt rollback manually → Verify restoration works

**After US2**:
- [ ] Run `npm outdated` → Verify no major version updates
- [ ] Run full test suite → Verify 100% pass rate
- [ ] Run `npm audit` → Verify zero high/critical vulnerabilities
- [ ] Review breaking changes report → Verify completeness

**After US3**:
- [ ] Delete node_modules and package-lock.json
- [ ] Run `npm install` → Time it (should be < 2 minutes with cache)
- [ ] Multiple developers run install → Compare dependency trees (should be identical)

---

## MVP Validation

**Definition of Done for MVP (User Story 1)**:

1. ✅ `npm install` produces zero deprecation warnings for packages with replacements
2. ✅ Technical debt report generated with deprecation reasons and monitoring plans
3. ✅ Test suite passes after deprecation fixes
4. ✅ Rollback mechanism works (tested manually)
5. ✅ All Phase 1, 2, and 3 tasks completed

**Validation Steps**:
```bash
# 1. Run before MVP
npm install 2>&1 | grep "WARN deprecated" | wc -l  # Record count

# 2. Execute MVP implementation
node scripts/updatePackages.js --batch devDependencies

# 3. Verify results
npm install 2>&1 | grep "WARN deprecated"  # Should be minimal
cat specs/005-npm-package-updates/reports/technical-debt-report.md  # Verify documentation
npm test  # Should pass 100%

# 4. Verify rollback
git log --oneline | head -5  # Check checkpoints exist
```

---

## Risk Mitigation

| Risk | Task(s) Affected | Mitigation |
|------|------------------|------------|
| Test suite fails after updates | T021, T034, T036 | Automated rollback implemented; manual rollback documented |
| Breaking changes not detected | T028 | Comprehensive semver comparison; changelog validation |
| Security vulnerabilities introduced | T033 | npm audit integration blocks high/critical; manual review for moderate |
| Peer dependency conflicts | T040 | Resolution strategies implemented; fallback to --legacy-peer-deps |
| Git operations fail | T008, T011 | Error handling with GitNotAvailableError; recovery guidance provided |

---

## Progress Tracking

**Completed**: `[ ] 0 / 47 tasks (0%)`

**Phase Progress**:
- [ ] Phase 1: Setup (0/5)
- [ ] Phase 2: Foundational (0/8)
- [ ] Phase 3: US1 - MVP (0/12)
- [ ] Phase 4: US2 (0/7)
- [ ] Phase 5: US3 (0/5)
- [ ] Phase 6: Polish (0/4)

**Story Progress**:
- [ ] US1 (P1 - MVP): 0% (0/12 tasks)
- [ ] US2 (P2): 0% (0/7 tasks)
- [ ] US3 (P3): 0% (0/5 tasks)

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| Phase 1: Setup | 30 minutes | 0.5 hours |
| Phase 2: Foundational | 4 hours | 4.5 hours |
| Phase 3: US1 (MVP) | 8 hours | 12.5 hours |
| Phase 4: US2 | 12 hours | 24.5 hours |
| Phase 5: US3 | 6 hours | 30.5 hours |
| Phase 6: Polish | 6 hours | 36.5 hours |
| **TOTAL** | **~37 hours** | **5-6 days** |

**MVP Timeline**: Phases 1-3 = ~12.5 hours (~2 days)

---

## Notes

- **[P] marker**: Indicates task can be executed in parallel with others (different files, no sequential dependencies)
- **[US#] marker**: Associates task with specific user story for independent tracking
- **Critical path**: T001 → T006 → T011 → T015 → T018 → T028 → T031 → T035 → T044
- **Most parallelizable phase**: Phase 1 (100% parallel after T001)
- **Least parallelizable phase**: Phase 3 (many dependencies on T015, T018)

---

**Tasks Generated**: 2025-10-28  
**Ready for Implementation**: ✅ Yes  
**MVP Scope Defined**: ✅ Yes (Phases 1-3)  
**Independent Testing**: ✅ Yes (per user story)

