# Implementation Plan: Fix Unwanted Dependencies in Packaged Application

**Branch**: `002-fix-asar-unpacked-deps` | **Date**: October 28, 2025 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/002-fix-asar-unpacked-deps/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Fix packaging bug where electron-builder includes unnecessary dependencies (@unrs, electron, fsevents) in the `app.asar.unpacked/node_modules` directory. The packaged application should contain only three required native modules (esbuild, @esbuild, @anikitenko/fdo-sdk) with automated post-packaging validation to prevent regression.

## Technical Context

**Language/Version**: JavaScript (Node.js 18+), TypeScript  
**Primary Dependencies**: webpack 5.101.0, electron-builder 25.1.8, esbuild 0.25.8, @vercel/webpack-asset-relocator-loader 1.7.4  
**Storage**: electron-builder configuration in package.json, webpack configuration files  
**Testing**: Manual inspection of packaged application, automated post-packaging validation script  
**Target Platform**: Electron 37.2.6 on macOS (x64, arm64), Windows (x64), Linux (x64)  
**Project Type**: Desktop application (Electron) - single build process with multiple output platforms  
**Performance Goals**: Build time increase < 10%, package size reduction 50-100MB  
**Constraints**: Must not break existing functionality, validation must run after electron-builder completes  
**Scale/Scope**: Affects all platform builds (macOS DMG/ZIP, Windows NSIS/Portable, Linux DEB/RPM/AppImage)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Gates from Constitution

✅ **Desktop-Native Platform (Principle V)**: This fix enhances the desktop packaging process and reduces package size, improving desktop user experience. No violations.

✅ **Test-First Development (Principle IX)**: Automated validation will be implemented to verify package contents. Testing approach aligns with constitution requirements.

✅ **Developer Experience First (Principle III)**: Validation errors will provide clear, actionable feedback showing actual vs expected packages, maintaining positive developer experience.

✅ **Process Isolation & Safety (Principle VI)**: This is a build-time fix that doesn't affect plugin isolation or runtime safety. No violations.

✅ **Observability & Transparency (Principle VII)**: Validation will log package contents and fail build with clear error messages. Aligns with observability requirements.

### Evaluation

**Status**: ✅ PASS - No constitution violations detected

This is a build system optimization that:
- Improves desktop application packaging (Principle V)
- Adds automated testing/validation (Principle IX)
- Maintains developer experience with clear feedback (Principle III)
- Enhances observability of build process (Principle VII)

No architectural principles are compromised. This is a build configuration fix with validation tooling.

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-asar-unpacked-deps/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - electron-builder and webpack investigation
├── data-model.md        # Phase 1 output - build configuration data model
├── quickstart.md        # Phase 1 output - how to verify and test the fix
├── contracts/           # Phase 1 output - validation script interface
│   └── validation-api.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Existing files to be modified:
webpack.main.config.js           # Update CopyWebpackPlugin patterns and externals config
package.json                     # Update electron-builder asarUnpack configuration
scripts/                         # Create new directory for build scripts
├── validate-package.js          # New: Post-packaging validation script
└── package-utils.js             # New: Shared utilities for package inspection

# Build output (inspected but not modified):
dist/main/                       # Webpack build output
└── node_modules/                # Should contain only allowed packages
release/                         # electron-builder output
└── mac/FDO (FlexDevOPs).app/   # Packaged app to validate
    └── Contents/
        └── Resources/
            └── app.asar.unpacked/
                └── node_modules/    # Validation target directory
```

**Structure Decision**: Single project structure is appropriate for this fix. Changes are limited to build configuration files (webpack.main.config.js, package.json) and addition of validation scripts in a new `/scripts` directory. No changes to source code structure required since this is purely a build-time fix.

## Complexity Tracking

No constitution violations - this section is not required.

## Phase 0: Outline & Research

### Research Questions

1. **Why are @unrs, electron, and fsevents being included?**
   - Need to investigate @vercel/webpack-asset-relocator-loader behavior
   - Check if these are transitive dependencies pulled in automatically
   - Understand electron-builder's asarUnpack patterns

2. **How does electron-builder determine what goes in app.asar.unpacked?**
   - Research asarUnpack configuration patterns
   - Understand the relationship between webpack externals and asarUnpack
   - Investigate if electron-builder has allowlist vs denylist approaches

3. **What's the correct way to exclude unwanted packages?**
   - Best practices for webpack externals configuration
   - Proper use of CopyWebpackPlugin with precise patterns
   - electron-builder files/extraFiles/extraResources configuration

4. **How to implement post-packaging validation?**
   - Hook into electron-builder's afterPack lifecycle
   - Node.js filesystem APIs for directory inspection
   - Exit code handling to fail the build

5. **How to ensure platform-specific packages don't add dependencies?**
   - Investigate @esbuild platform-specific binaries structure
   - Verify esbuild dependency tree
   - Check @anikitenko/fdo-sdk for any platform-specific deps

### See research.md for detailed findings

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) for detailed configuration schema.

**Key entities**:
- Build Configuration (webpack.main.config.js, package.json)
- Package Validation Rules (expected packages list)
- Validation Results (actual packages, expected packages, discrepancies)

### API Contracts

See [contracts/validation-api.md](./contracts/validation-api.md) for validation script interface.

**Key operations**:
- `validatePackage(appPath, expectedPackages)` - Main validation function
- `listPackages(nodeModulesPath)` - List packages in directory
- `comparePackages(actual, expected)` - Compare and identify discrepancies

### Quickstart

See [quickstart.md](./quickstart.md) for testing and verification instructions.

## Phase 2: Implementation Tasks

**Note**: Detailed task breakdown will be generated by `/speckit.tasks` command after this plan is reviewed.

### High-Level Implementation Steps

1. **Research Phase** (Phase 0)
   - Investigate current webpack and electron-builder configuration
   - Understand why unwanted packages are being included
   - Identify correct configuration approach

2. **Configuration Updates** (Phase 1)
   - Update webpack.main.config.js externals and CopyWebpackPlugin
   - Update package.json electron-builder configuration
   - Test configuration changes locally

3. **Validation Script** (Phase 1)
   - Create validation script in scripts/ directory
   - Implement package listing and comparison logic
   - Add clear error messaging with actual vs expected

4. **Integration** (Phase 1)
   - Hook validation into electron-builder afterPack
   - Test validation with intentionally incorrect configuration
   - Verify validation fails build appropriately

5. **Testing & Verification** (Phase 1)
   - Package application for all platforms
   - Manually verify package contents
   - Confirm validation script catches violations
   - Verify all functionality still works

6. **Documentation** (Phase 1)
   - Update quickstart.md with verification steps
   - Document validation script usage
   - Add troubleshooting guide

## Next Steps

1. Execute Phase 0 research to understand root cause
2. Generate detailed data model and contracts
3. Create quickstart guide for testing
4. Run `/speckit.tasks` to generate implementation task breakdown

---

**Phase 0 Status**: Ready to begin research  
**Gate Status**: ✅ Constitution check passed  
**Blockers**: None
