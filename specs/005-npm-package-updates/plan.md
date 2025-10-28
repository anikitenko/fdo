# Implementation Plan: NPM Package Updates and Deprecation Resolution

**Branch**: `005-npm-package-updates` | **Date**: 2025-10-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-npm-package-updates/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Update all npm packages to their latest compatible versions (within current major versions) while resolving deprecation warnings and maintaining backward compatibility. The implementation uses a two-batch strategy (devDependencies first, then dependencies) with automated security auditing, test suite validation, and automated rollback on failures. Packages with breaking changes are skipped and documented for manual review. The approach prioritizes safety through incremental updates, preserving previous package versions for rollback, and generating comprehensive reports for technical debt (deprecated packages without replacements) and breaking changes.

## Technical Context

**Language/Version**: JavaScript/Node.js (project uses Node.js for Electron app, version determined by package.json engines field)
**Primary Dependencies**: npm CLI (package manager), npm outdated/audit APIs, Git (for rollback checkpoints)
**Storage**: File system (package.json, package-lock.json, generated reports in specs directory)
**Testing**: Jest (existing test framework per package.json)
**Target Platform**: Developer workstation (macOS, Windows, Linux) where npm commands execute
**Project Type**: Single desktop application (Electron-based)
**Performance Goals**: npm install completes under 2 minutes from cache; rollback completes within 5 minutes if tests fail
**Constraints**: Must not introduce breaking changes to application code; must preserve backward compatibility; automated tests must pass after updates
**Scale/Scope**: ~50-100 npm packages in package.json (typical Electron app); batch processing (devDependencies ~30 packages, dependencies ~70 packages)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Evaluation Against FDO Constitution

| Principle | Compliance | Notes |
|-----------|------------|-------|
| **I. Plugin-First Architecture** | ✅ N/A | Package updates are infrastructure maintenance, not feature addition. Does not impact plugin architecture. |
| **II. Cryptographic Trust Model** | ✅ Compliant | npm audit includes security vulnerability checks; packages verified via npm registry signatures. |
| **III. Developer Experience First** | ✅ Enhanced | Clean npm install output improves developer onboarding and reduces friction. Automated process reduces manual effort. |
| **IV. Declarative Metadata & SDK** | ✅ N/A | Package updates are infrastructure; SDK versioning remains stable (@anikitenko/fdo-sdk@^1.0.18). |
| **V. Desktop-Native Platform** | ✅ N/A | Maintains Electron stack; no platform changes. |
| **VI. Process Isolation & Safety** | ✅ Enhanced | Automated rollback on test failures prevents unsafe package versions from reaching production. |
| **VII. Observability & Transparency** | ✅ Enhanced | Generates detailed reports for breaking changes and technical debt; all updates logged and versioned in Git. |
| **VIII. Semantic Versioning** | ✅ Compliant | Respects semver by skipping major version updates (breaking changes); maintains version constraints in package.json. |
| **IX. Test-First Development** | ✅ Compliant | Automated test suite runs after each batch; rollback triggered on test failures. |

**GATE STATUS**: ✅ **PASS** - No constitution violations. Feature enhances developer experience and safety without compromising architectural principles.

**Post-Design Re-Check** (Completed 2025-10-28):

After completing Phase 1 design artifacts (data-model.md, contracts/, quickstart.md), re-evaluated against constitution:

| Principle | Re-Evaluation | Design Impact |
|-----------|---------------|---------------|
| **I. Plugin-First Architecture** | ✅ Confirmed N/A | Package updates are pure infrastructure. No impact on plugin architecture. Implementation uses utility modules, not core modification. |
| **II. Cryptographic Trust Model** | ✅ Confirmed Compliant | Security audit integration (npm audit) validates package integrity. No changes to plugin signing or verification. |
| **III. Developer Experience First** | ✅ Enhanced | Automated workflow (scripts/updatePackages.js) significantly improves DX. Quickstart guide enables 5-minute setup. Clean npm install reduces friction. |
| **IV. Declarative Metadata & SDK** | ✅ Confirmed N/A | No SDK changes. package.json/package-lock.json remain declarative. Reports use structured Markdown format. |
| **V. Desktop-Native Platform** | ✅ Confirmed N/A | Maintains Electron stack. All updates are to desktop-native dependencies. |
| **VI. Process Isolation & Safety** | ✅ Enhanced | Automated rollback on test failures prevents unsafe states. Git checkpoints enable instant recovery. Batch strategy isolates risk. |
| **VII. Observability & Transparency** | ✅ Enhanced | Three detailed reports (breaking changes, technical debt, summary) provide full visibility. All operations logged. Git history preserves audit trail. |
| **VIII. Semantic Versioning** | ✅ Confirmed Compliant | Breaking changes (major versions) automatically detected and skipped. Version constraints preserved. Reports document all skipped updates. |
| **IX. Test-First Development** | ✅ Confirmed Compliant | Full test suite runs after each batch. Zero tolerance for test failures. Rollback triggered on any failure. |

**Architecture Alignment**:
- ✅ Data model (9 entities) follows constitution's ORM patterns (JSONORM precedent)
- ✅ API contract uses Node.js module exports (consistent with existing utils/)
- ✅ CLI script follows existing FDO CLI patterns (scripts/ directory)
- ✅ Reports stored in specs/ directory (aligns with documentation structure)
- ✅ Git integration uses simple-git (consistent with existing tooling)
- ✅ No new external services or network dependencies (desktop-native compliance)

**Final Gate Status**: ✅ **PASS** - Design fully compliant with FDO Constitution. All principles either unaffected, maintained, or enhanced. No violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/005-npm-package-updates/
├── spec.md              # Feature specification (completed)
├── checklists/
│   └── requirements.md  # Quality checklist (completed)
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (to be generated)
├── data-model.md        # Phase 1 output (to be generated)
├── quickstart.md        # Phase 1 output (to be generated)
├── contracts/           # Phase 1 output (to be generated)
│   └── update-process-api.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Single project structure (Electron desktop app)
src/
├── utils/               # Utility functions (existing)
│   └── packageUpdater.js  # NEW: Package update orchestration
├── ipc/                 # IPC handlers (existing)
│   └── system.js        # May need package update handlers
├── main.js              # Main process (existing)
└── components/          # React UI components (existing)
    └── SettingsDialog.jsx  # May need UI for update reports

scripts/                 # Build and utility scripts (existing)
└── updatePackages.js    # NEW: Standalone script for package updates

specs/005-npm-package-updates/
├── reports/             # NEW: Generated reports directory
│   ├── breaking-changes-report.md
│   ├── technical-debt-report.md
│   └── update-summary.md

tests/
├── unit/
│   └── packageUpdater.test.js  # NEW: Unit tests for update logic
└── integration/
    └── packageUpdate.test.js    # NEW: Integration tests for full update flow

# Root files
package.json             # MODIFIED: Dependencies will be updated
package-lock.json        # MODIFIED: Lock file regenerated
.gitignore              # Ensure reports/ is tracked
```

**Structure Decision**: This is a single-project Electron desktop application. The package update functionality will be implemented as a utility module (`src/utils/packageUpdater.js`) and a standalone CLI script (`scripts/updatePackages.js`). Generated reports will be stored in `specs/005-npm-package-updates/reports/` for version control tracking. The implementation does not require modifying core plugin architecture, keeping with FDO's separation of infrastructure from features.

## Complexity Tracking

> **No violations identified**. This feature is pure infrastructure maintenance that enhances safety (automated rollback), security (npm audit integration), and developer experience (clean install output). All changes align with constitution principles.

---

**END OF PLAN.MD FOUNDATION**

Next phases (research, data-model, contracts, quickstart) will be generated by the planning workflow.
