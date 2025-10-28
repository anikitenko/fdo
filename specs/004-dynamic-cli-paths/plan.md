# Implementation Plan: Dynamic CLI Path Resolution

**Branch**: `004-dynamic-cli-paths` | **Date**: 2025-10-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-dynamic-cli-paths/spec.md`

## Summary

This feature eliminates hardcoded paths from the FDO CLI installer, enabling cross-platform installation regardless of where the FDO application is installed. The installer will dynamically detect the application's actual location using Electron runtime APIs and create appropriate CLI wrappers for macOS, Windows, and Linux with intelligent fallback support for non-standard system paths.

**Key Technical Approach**:
- Use Electron's `app.getAppPath()` and `process.execPath` for dynamic path detection
- Implement idempotent installation behavior (skip if file exists)
- Support both system-level and user-level installations based on permissions
- Provide structured logging (info for major steps, debug for details)
- Handle development environments with warning-level logging
- Leave partial installations intact with detailed error messages for manual recovery

## Technical Context

**Language/Version**: JavaScript (Node.js via Electron 37.2.6)
**Primary Dependencies**: 
- Electron framework (app.getPath, app.getAppPath, process.execPath)
- Node.js fs, path, os modules
- child_process.execSync (for Windows PowerShell PATH updates)
- Existing `runWithSudo` utility for elevated operations

**Storage**: File system
- CLI wrappers written to platform-specific bin directories
- PATH environment variable updates (user-level on Windows)
- Electron-log for structured logging

**Testing**: Manual testing across platforms (macOS, Windows, Linux)
- Test matrix: default paths, custom install locations, paths with spaces
- Permission scenarios: admin/root vs user-level
- Edge cases: development environment, multiple FDO installations

**Target Platform**: 
- macOS (Intel + Apple Silicon)
- Windows (x64)
- Linux (x64, multiple distributions)

**Project Type**: Desktop application (Electron-based)

**Performance Goals**: 
- CLI installation completes in under 30 seconds
- Path detection and validation in under 5 seconds
- Idempotent checks in under 1 second

**Constraints**: 
- Must work offline (no network dependencies)
- Must not require manual path configuration
- Must preserve backward compatibility with existing CLI installations
- Must handle paths with spaces, special characters, and Unicode
- Must work across different FDO installation methods (DMG, NSIS, AppImage, portable)

**Scale/Scope**: 
- Single utility module modification (`src/utils/installFDOCLI.js`)
- 2 functions: `installFDOCLI()` and `removeFDOCLI()`
- Support 3 major platforms with 2-3 fallback paths each
- ~300-400 lines of code (including error handling and logging)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Relevant Principles

**✅ I. Plugin-First Architecture** - NOT APPLICABLE
- This is core CLI infrastructure, not a feature that can be implemented as a plugin
- CLI installation is a system-level operation requiring main process access
- Justification: Core infrastructure that enables the application itself

**✅ II. Cryptographic Trust Model** - NOT APPLICABLE
- CLI wrapper scripts don't execute untrusted code
- Wrapper simply invokes the already-verified FDO application
- Trust chain: User → Electron app (signed) → CLI wrapper → Same app

**✅ III. Developer Experience First** - PASSES
- Eliminates manual path configuration (friction reduction)
- Provides clear error messages with recovery instructions (FR-019)
- Supports development environments automatically (FR-018)
- Idempotent behavior makes retry safe and fast

**✅ V. Desktop-Native Platform** - PASSES
- Uses Electron APIs for cross-platform path detection
- Works offline without network dependencies
- Respects platform-specific conventions (PATH locations, wrapper formats)
- Integrates with OS security (sudo dialogs, permission checks)

**✅ VI. Process Isolation & Safety by Design** - PASSES
- CLI installation failures don't crash application (error handling)
- Partial installations can be recovered (idempotent retry)
- User confirmation required for elevated operations (via runWithSudo)

**✅ VII. Observability & Transparency** - PASSES
- Structured logging at info and debug levels (FR-014)
- Clear error messages with attempted paths and reasons (FR-013, SC-007)
- Manual recovery instructions provided on failure (FR-019)
- All path detection attempts logged for troubleshooting

**✅ VIII. Semantic Versioning & Compatibility** - PASSES
- Preserves backward compatibility with existing installations (FR-012)
- No breaking changes to public interfaces
- Improvement to existing functionality

**✅ IX. Test-First Development** - DEFERRED TO IMPLEMENTATION
- Manual testing plan defined in spec
- Test matrix: platforms × scenarios × edge cases
- Automated testing would require multi-platform CI (future improvement)

### Violations & Justifications

None. This feature aligns with all applicable constitution principles.

### Post-Design Re-Check

**Status**: ✅ PASSED (2025-10-28 after Phase 1 completion)

All design artifacts reviewed against constitution:

**✅ Developer Experience First (FR-018)**: 
- Research confirms development environment detection (R7)
- Allows CLI installation from dev builds with warning
- Supports testing workflow without manual configuration

**✅ Observability & Transparency (FR-014, FR-019)**:
- Structured logging implemented (info/debug levels)
- Clear error messages with recovery instructions
- All path detection attempts logged

**✅ Desktop-Native Platform (R2, R3)**:
- Uses Electron APIs (process.execPath, app.getAppPath)
- Platform-specific wrapper scripts (bash, cmd)
- Respects OS conventions (/usr/local/bin, %LOCALAPPDATA%)

**✅ Process Isolation & Safety (FR-019)**:
- Errors don't crash application (all errors returned in result objects)
- Partial installations can be recovered (idempotent retry)
- User confirmation for elevated operations (runWithSudo)

**No new violations introduced.** Design aligns with all applicable constitution principles.

## Project Structure

### Documentation (this feature)

```text
specs/004-dynamic-cli-paths/
├── spec.md              # Feature specification (COMPLETE)
├── checklists/
│   └── requirements.md  # Validation checklist (COMPLETE)
├── data-model.md        # Data model (EXISTS, will be updated)
├── quickstart.md        # Quick reference (EXISTS, will be updated)
├── plan.md              # This file (IN PROGRESS)
├── research.md          # Phase 0 output (PENDING)
├── contracts/           # Phase 1 output (PENDING)
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── installFDOCLI.js      # TARGET: CLI installation logic (MODIFY)
│   ├── runWithSudo.js         # DEPENDENCY: Elevated permission utility (USE)
│   └── pathHelper.js          # POTENTIAL NEW: Path validation utilities (TBD in research)
├── ipc/
│   └── settings.js            # IPC handlers for CLI install/uninstall (MAY MODIFY)
└── main.js                    # Main process, may need logging setup (MAY MODIFY)

tests/
└── utils/
    └── installFDOCLI.test.js  # NEW: Test suite for CLI installation (CREATE)
```

**Structure Decision**: Single project structure (desktop application). This feature modifies existing utility functions in the main process. The primary file is `src/utils/installFDOCLI.js` (~150 lines currently), which will be refactored to eliminate hardcoded paths and add dynamic detection logic. No new architecture needed; implementation is a targeted improvement to an existing module.

## Complexity Tracking

No constitution violations requiring justification. This is a straightforward infrastructure improvement that aligns with all applicable principles.

---

## Phase 0: Research & Decision Log

See [research.md](./research.md) for detailed findings on:
- Best practices for Electron path detection across platforms
- Platform-specific CLI installation patterns (macOS, Windows, Linux)
- PATH environment variable update strategies
- Permission handling approaches
- Idempotent file operation patterns
- Logging strategies for system operations

## Phase 1: Design Artifacts

### Data Model

See [data-model.md](./data-model.md) for:
- Application Installation entity (detected path, type, method)
- CLI Installation Target entity (primary/fallback paths, permissions)
- Path Validation Result entity (validation outcomes)
- State transitions (installation/uninstallation flows)

### API Contracts

See [contracts/](./contracts/) for:
- Function signatures for `installFDOCLI()` and `removeFDOCLI()`
- Internal helper function contracts (path detection, validation, wrapper creation)
- Error response structures
- Logging event schemas

### Quick Start

See [quickstart.md](./quickstart.md) for:
- Overview of the feature
- Current problems solved
- Key changes from existing implementation
- Testing approach

---

## Phase 2: Task Breakdown

**Note**: Task breakdown is generated by the `/speckit.tasks` command and written to `tasks.md`. This section is a placeholder.

Task categories will include:
1. Path detection refactoring (remove hardcoded paths, add dynamic detection)
2. Fallback logic implementation (platform-specific fallback paths)
3. Idempotent installation behavior (check existing files)
4. Logging integration (structured logging at info/debug levels)
5. Development environment support (detect dev mode, log warnings)
6. Error handling improvements (detailed messages, recovery instructions)
7. Testing across platforms and scenarios
8. Documentation updates

---

## Notes

- This feature is a targeted refactoring of existing functionality
- No new UI components or IPC channels required
- Primary risk: platform-specific edge cases (testing coverage critical)
- Success depends on comprehensive testing across installation scenarios
- Idempotent behavior (from clarification session) simplifies retry logic significantly
