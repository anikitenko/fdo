# Implementation Plan: Editor Window Close Reliability Fix

**Branch**: `006-fix-editor-close` | **Date**: October 28, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-fix-editor-close/spec.md`

## Summary

Fix critical bug where editor window fails to close reliably after user confirms the close prompt. The issue stems from using `ipcMain.once()` instead of `ipcMain.on()` for close approval handlers, causing the handler to be removed after first use. The solution implements persistent event handlers, window validity checks, and a timeout-based failsafe mechanism to ensure 100% close reliability.

**Technical Approach**: Replace one-time event listeners with persistent handlers, add window state validation before operations, implement 2-3 second timeout fallback for forced closure, and add request deduplication to prevent race conditions.

## Technical Context

**Language/Version**: Node.js (via Electron 37.2.6), JavaScript ES6+  
**Primary Dependencies**: Electron (BrowserWindow, ipcMain, utilityProcess), React 18.3.1 for renderer  
**Storage**: N/A (stateless window lifecycle management)  
**Testing**: Manual testing workflow (50+ consecutive cycles), automated tests to be added via Jest 30.0.5  
**Target Platform**: Desktop (macOS arm64/x64, Windows x64, Linux x64) via Electron  
**Project Type**: Desktop application (Electron main + renderer processes)  
**Performance Goals**: <500ms normal close, <3s maximum with timeout fallback  
**Constraints**: Must maintain IPC security boundaries, no breaking changes to existing plugin system  
**Scale/Scope**: Single editor window instance at a time, affects critical user workflow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ Plugin-First Architecture (NON-NEGOTIABLE)
- **Status**: NOT APPLICABLE - This is core window management infrastructure
- **Justification**: Window lifecycle management is explicitly core infrastructure responsibility per Constitution Section I. Plugins run within editor windows but don't manage the window lifecycle itself.

### ✅ Cryptographic Trust Model (NON-NEGOTIABLE)
- **Status**: NOT APPLICABLE - No plugin signing/verification changes
- **Assessment**: Fix operates entirely within window management layer, no trust model impact

### ✅ Developer Experience First (NON-NEGOTIABLE)
- **Status**: IMPROVES COMPLIANCE
- **Impact**: Eliminates major friction point (stuck windows) that forces developers to restart application during plugin development workflow
- **Benefit**: Supports Constitution Section III requirement that "plugin development workflow MUST be testable in < 5 minutes"

### ✅ Declarative Metadata & SDK (NON-NEGOTIABLE)
- **Status**: NOT APPLICABLE - No SDK or plugin API changes

### ✅ Desktop-Native Platform (NON-NEGOTIABLE)
- **Status**: REINFORCES COMPLIANCE
- **Impact**: Leverages Electron's native window management capabilities (BrowserWindow lifecycle, OS-level window destruction)
- **Alignment**: Maintains Constitution Section V principles of desktop-first architecture

### ✅ Process Isolation & Safety by Design (NON-NEGOTIABLE)
- **Status**: IMPROVES COMPLIANCE
- **Impact**: Better cleanup of event listeners prevents resource leaks, timeout mechanism prevents indefinite hangs
- **Alignment**: Constitution Section VI requires "Plugin failures MUST NOT compromise the system" - this fix ensures window management failures don't compromise the main process

### ✅ Observability & Transparency (NON-NEGOTIABLE)
- **Status**: MAINTAINS COMPLIANCE
- **Observation Points**: Window close attempts, timeout activations, invalid window references should be logged
- **Alignment**: Constitution Section VII requires "Every significant action MUST be observable"

### ✅ Test-First Development (NON-NEGOTIABLE)
- **Status**: REQUIRES ATTENTION
- **Action Required**: Create automated tests for window close reliability before merging
- **Test Coverage**: 50+ consecutive close-reopen cycles, rapid click handling, timeout activation, invalid window references

### Constitution Compliance Summary

**No violations identified.** This fix:
1. Operates within designated core infrastructure boundaries
2. Improves developer experience (Constitution III)
3. Enhances safety and reliability (Constitution VI)
4. Requires test coverage per Constitution IX

**Gate Status**: ✅ PASSED - Proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/006-fix-editor-close/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 output - Root cause analysis
├── data-model.md        # Phase 1 output - Window state model
├── quickstart.md        # Phase 1 output - Developer guide
├── contracts/           # Phase 1 output - IPC contract changes
│   └── window-lifecycle-api.md
├── checklists/
│   └── requirements.md  # Spec quality validation
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created yet)
```

### Source Code (repository root)

```text
src/
├── ipc/
│   └── system.js                          # [MODIFIED] Fix ipcMain.once → ipcMain.on
├── utils/
│   └── editorWindow.js                    # [MODIFIED] Add window validity checks, timeout mechanism
├── components/
│   └── editor/
│       └── EditorPage.jsx                 # [MODIFIED] Add request deduplication for close events
└── preload.js                             # [REVIEWED] Verify IPC channel security

tests/
├── unit/
│   └── editorWindow.test.js               # [NEW] Window lifecycle unit tests
└── integration/
    └── editor-close-flow.test.js          # [NEW] End-to-end close reliability tests
```

**Structure Decision**: This is a desktop application (Electron) following the single-project structure. Core modifications target the main process window management (`src/ipc/system.js`, `src/utils/editorWindow.js`) and renderer process UI (`src/components/editor/EditorPage.jsx`). The existing structure is well-suited for this fix with clear separation between main and renderer processes.

## Complexity Tracking

> **No violations to justify - Constitution Check passed without exceptions**

This fix operates entirely within existing architectural boundaries and improves compliance with constitution principles.
