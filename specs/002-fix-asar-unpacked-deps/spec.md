# Feature Specification: Fix Unwanted Dependencies in Packaged Application

**Feature Branch**: `002-fix-asar-unpacked-deps`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "Need to resolve a bug where in packaged application, under Contents/Resources/app.asar.unpacked is a directory called node_modules which contain @esbuild, @unrs, electron and fsevents but according to webpack.main.config.js it must contain only esbuild, @esbuild and @anikitenko/fdo-sdk"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Package Application with Only Required Dependencies (Priority: P1)

As a developer packaging the FDO application for distribution, I need the packaged application to contain only the explicitly required native modules (esbuild, @esbuild, and @anikitenko/fdo-sdk) in the unpacked resources directory, so that the application has a smaller footprint, faster installation, and reduced security surface.

**Why this priority**: This is the core bug fix. The application is currently packaging unnecessary dependencies that increase application size, slow down distribution, and create potential security vulnerabilities. This directly impacts user experience during installation and deployment.

**Independent Test**: Can be fully tested by packaging the application and inspecting the `Contents/Resources/app.asar.unpacked/node_modules` directory to verify it contains only the three expected packages.

**Acceptance Scenarios**:

1. **Given** the application is ready to be packaged, **When** the build process completes, **Then** the packaged application's `app.asar.unpacked/node_modules` directory contains exactly three packages: esbuild, @esbuild, and @anikitenko/fdo-sdk
2. **Given** the packaged application exists, **When** inspecting the unpacked resources directory, **Then** no unwanted packages (@unrs, electron, fsevents, or any others not explicitly specified) are present
3. **Given** the application is packaged, **When** launched, **Then** all functionality that depends on the three required native modules works correctly

---

### User Story 2 - Verify Package Integrity During Build (Priority: P2)

As a developer, I need the build process to verify that only the intended dependencies are included in the unpacked resources, so that I can catch packaging issues immediately rather than discovering them after distribution.

**Why this priority**: This prevents the bug from reoccurring in future builds. While not as critical as fixing the immediate issue, automated verification ensures long-term quality.

**Independent Test**: Can be tested by intentionally adding an extra package to the configuration and verifying that the build process reports the discrepancy.

**Acceptance Scenarios**:

1. **Given** the build process completes, **When** reviewing build output, **Then** a clear list of packages included in unpacked resources is displayed
2. **Given** an unexpected package would be included, **When** the build process runs, **Then** the system provides a warning or error indicating the discrepancy

---

### User Story 3 - Reduce Application Package Size (Priority: P3)

As an end user installing the FDO application, I need the application package to be as small as possible while maintaining full functionality, so that downloads complete faster and disk space usage is minimized.

**Why this priority**: This is a beneficial side effect of fixing the bug. Smaller package size improves user experience, but the functionality itself isn't compromised by the current bug—only efficiency is impacted.

**Independent Test**: Can be tested by comparing the packaged application size before and after the fix and verifying size reduction without functional regression.

**Acceptance Scenarios**:

1. **Given** the application is packaged with only required dependencies, **When** comparing to the previous package, **Then** the package size is measurably smaller
2. **Given** the smaller package is distributed, **When** users download and install it, **Then** all features work identically to the previous version

---

### Edge Cases

- What happens when one of the three required packages (esbuild, @esbuild, @anikitenko/fdo-sdk) has internal dependencies on other packages?
- How does the system handle platform-specific native modules that might be needed for different operating systems (macOS, Windows, Linux)?
- What happens if the build configuration is modified to add or remove required packages in the future?
- How does the system handle transitive dependencies that might be pulled in by the packaging tool?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST include exactly three packages in the unpacked resources directory: esbuild, @esbuild, and @anikitenko/fdo-sdk
- **FR-002**: System MUST exclude all other packages from the unpacked resources directory, specifically including but not limited to @unrs, electron, and fsevents
- **FR-003**: System MUST preserve all runtime functionality that depends on the three required native modules after packaging
- **FR-004**: Build process MUST be repeatable, producing consistent results across multiple builds with the same source code
- **FR-005**: System MUST support all target platforms (macOS x64, macOS arm64, Windows, Linux) with only the required dependencies for each platform

### Key Entities *(include if feature involves data)*

- **Unpacked Resources Directory**: The location within the packaged application (`Contents/Resources/app.asar.unpacked`) where native modules that cannot be packaged into the ASAR archive are stored
- **Required Native Modules**: The three packages (esbuild, @esbuild, @anikitenko/fdo-sdk) that must be present in unpacked form for the application to function correctly
- **Build Configuration**: The webpack and electron-builder settings that control which dependencies are included in the packaged application

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Packaged application contains exactly three packages in the unpacked resources directory, verified by automated directory inspection
- **SC-002**: Package size is reduced by at least the combined size of the excluded packages (@unrs, electron, fsevents), estimated at 50-100MB depending on platform
- **SC-003**: All application features that previously worked continue to function correctly in the fixed package, with 100% functional parity
- **SC-004**: Build time does not increase by more than 10% compared to the current build process
- **SC-005**: The fix prevents regression, with automated checks ensuring no unexpected packages are added in future builds

## Assumptions

- The three specified packages (esbuild, @esbuild, @anikitenko/fdo-sdk) are sufficient for all required native functionality
- The packages currently being included unnecessarily (@unrs, electron, fsevents) are not actually used by the application at runtime
- The webpack configuration accurately reflects the intended packaging behavior
- The build tooling (webpack, electron-builder) supports fine-grained control over which packages are included in unpacked resources
- Platform-specific variations (different native modules for different operating systems) are handled automatically by the build tooling or the three required packages themselves
