# Feature Specification: Fix Missing Asset Node Modules in Packaged Application

**Feature Branch**: `003-fix-asar-node-modules`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "need to fix a bug where dist/renderer/assets/node_modules does not exist in release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar but it must exist because there is a configuration in webpack.renderer.config.js"

## Clarifications

### Session 2025-10-28

- Q: When the build validation detects missing assets in the packaged ASAR archive, what should happen to prevent shipping broken packages? → A: Immediately fail the build with clear error details, preventing packaged artifacts from being published
- Q: Should the asset validation run on all target platforms (macOS, Windows, Linux) during the build, or only on the platform where the build is executed? → A: Validate only the platform being built on the current machine, requiring separate builds on each platform to validate their respective packages
- Q: At what point in the build pipeline should the asset validation occur to catch issues as early as possible while ensuring accuracy? → A: After electron-builder completes packaging, validating the final ASAR archive before publishing/distributing
- Q: When developers need to update or add new asset packages to the webpack CopyWebpackPlugin configuration, what process should ensure the packaged application stays in sync? → A: Validation automatically detects discrepancies between webpack configuration and packaged assets, requiring no manual updates to validation logic

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Package Application with Required Asset Dependencies (Priority: P1)

As a developer packaging the FDO application for distribution, I need the packaged application to include the asset dependencies (@anikitenko/fdo-sdk, @babel/standalone, goober) that are copied by webpack to `dist/renderer/assets/node_modules`, so that plugin functionality and dynamic code execution work correctly in the production application.

**Why this priority**: This is a critical bug that breaks core functionality. Without these assets in the packaged application, plugins cannot access required SDK types, Babel cannot transpile code dynamically, and styling libraries are unavailable, causing runtime failures.

**Independent Test**: Can be fully tested by packaging the application, extracting the app.asar file, and verifying that the `renderer/assets/node_modules` directory exists with the three expected packages (@anikitenko/fdo-sdk, @babel/standalone, goober).

**Acceptance Scenarios**:

1. **Given** the application is ready to be packaged, **When** the build process completes, **Then** the packaged application's `app.asar` contains the directory `renderer/assets/node_modules` with the three required packages
2. **Given** the packaged application is running, **When** a plugin requests access to the FDO SDK types, **Then** the types are successfully loaded from the assets directory
3. **Given** the application is running, **When** Babel needs to transpile dynamic code, **Then** the @babel/standalone module is available and functions correctly
4. **Given** the application is running, **When** plugin UI components use goober for styling, **Then** the styles are applied correctly

---

### User Story 2 - Verify Asset Dependencies After Packaging (Priority: P2)

As a developer, I need the packaging process to verify that all webpack-copied asset dependencies are included in the final packaged application, so that I can detect missing assets before distribution rather than after users report runtime failures.

**Why this priority**: This prevents the bug from reoccurring in future builds and provides early detection of packaging configuration issues. While critical for quality assurance, the immediate fix is more urgent.

**Independent Test**: Can be tested by intentionally removing an asset dependency from the webpack configuration and verifying that the packaging validation automatically detects the missing asset without manual validation updates.

**Acceptance Scenarios**:

1. **Given** electron-builder completes packaging, **When** the validation step runs, **Then** it automatically confirms that all webpack-copied assets are present in the final ASAR archive by comparing webpack configuration to packaged contents
2. **Given** an asset dependency configured in webpack is missing from the packaged ASAR archive, **When** the validation runs after electron-builder, **Then** the build fails with a clear error message listing the missing assets
3. **Given** the validation detects a packaging issue, **When** the error is displayed, **Then** the message includes both the expected asset paths (from webpack configuration) and the actual state in the ASAR archive
4. **Given** a developer adds a new CopyWebpackPlugin pattern, **When** the build runs, **Then** the validation automatically includes the new expected asset in its checks without requiring validation code updates

---

### User Story 3 - Prevent Plugin Runtime Failures (Priority: P3)

As an end user running plugins in the FDO application, I need all required asset dependencies to be available at runtime, so that plugins function correctly without encountering missing module errors.

**Why this priority**: This is the user-facing benefit of fixing the bug. While critical for user experience, it's a consequence of fixing the packaging issue rather than a separate implementation concern.

**Independent Test**: Can be tested by creating a test plugin that imports from @anikitenko/fdo-sdk, uses Babel for code transformation, and applies goober styles, then verifying it works in the packaged application.

**Acceptance Scenarios**:

1. **Given** a plugin is installed in the packaged application, **When** the plugin imports SDK types from the asset directory, **Then** the import succeeds without errors
2. **Given** the application executes dynamic code transformation, **When** Babel is invoked from the assets, **Then** the transformation completes successfully
3. **Given** a plugin applies styles using goober, **When** the plugin renders, **Then** styles are correctly applied from the goober module in assets

---

### Edge Cases

- **Webpack configuration changes**: When a developer adds or removes CopyWebpackPlugin patterns, the post-packaging validation automatically detects and reports any discrepancies between the webpack configuration and the final ASAR archive without requiring manual updates to validation logic
- **Partial directory structure**: If only some of the required asset packages are present (e.g., @babel/standalone but not goober), the validation should identify all missing packages, not just the first one encountered
- **Platform differences**: All platforms (macOS, Windows, Linux) must include the same asset dependencies in their respective packaged formats (app.asar, ASAR archive in .exe, etc.); validation occurs independently during each platform's build process
- **ASAR extraction tools**: The assets must be accessible through Electron's ASAR protocol at runtime, not requiring extraction to the filesystem
- **Symbolic links**: If any of the copied node_modules contain symbolic links, they must be resolved and included as actual files in the ASAR archive

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST include the directory `renderer/assets/node_modules` in the packaged application's ASAR archive
- **FR-002**: The assets directory MUST contain three packages as configured in webpack: @anikitenko/fdo-sdk (specifically the dist/@types subdirectory), @babel/standalone (complete package), and goober (complete package excluding test files)
- **FR-003**: All files copied by webpack's CopyWebpackPlugin to `dist/renderer/assets/node_modules` during build MUST be preserved in the final packaged ASAR archive at the same relative path
- **FR-004**: System MUST make the asset dependencies accessible to the renderer process at runtime through the standard ASAR protocol
- **FR-005**: Packaging configuration MUST be updated to ensure electron-builder includes the assets directory in the ASAR archive rather than excluding it
- **FR-006**: Build process MUST verify that all webpack-copied assets exist in the final packaged ASAR archive after electron-builder completes packaging by automatically detecting discrepancies between webpack configuration and packaged assets, and immediately fail the build if any are missing, preventing packaged artifacts from being published or distributed
- **FR-007**: Validation logic MUST automatically stay synchronized with webpack CopyWebpackPlugin configuration changes, requiring no manual updates to validation rules when asset packages are added, removed, or modified
- **FR-008**: Validation error messages MUST clearly identify: (a) which asset paths are missing from the ASAR archive, (b) which webpack CopyWebpackPlugin patterns generated these expected paths, and (c) troubleshooting steps for resolving the packaging issue
- **FR-009**: The fix MUST work consistently across all supported platforms (macOS x64, macOS arm64, Windows, Linux) with the same assets present in each platform's packaged format; validation runs on each platform during its respective build process

### Key Entities

- **Assets Directory**: The location `renderer/assets/node_modules` within the packaged ASAR archive where webpack-copied dependencies are stored for runtime access by plugins and the renderer process
- **Required Asset Packages**: The three packages (@anikitenko/fdo-sdk types, @babel/standalone, goober) that must be present in the assets directory for plugin functionality and dynamic code execution
- **ASAR Archive**: The packaged file format (app.asar) used by Electron that contains the application code and must include the assets directory
- **Webpack Copy Configuration**: The CopyWebpackPlugin patterns in webpack.renderer.config.js that define which node_modules should be copied to the assets directory during build

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Packaged application contains the directory `renderer/assets/node_modules` in the ASAR archive with all three required packages, verified by automated ASAR extraction and directory inspection
- **SC-002**: All plugins that import from @anikitenko/fdo-sdk, use Babel for transpilation, or utilize goober for styling function correctly in the packaged application with 100% functionality parity to the development environment
- **SC-003**: Post-packaging validation (after electron-builder completes) detects missing assets with 100% accuracy, immediately failing the build and preventing distribution if any webpack-copied assets are absent from the packaged ASAR archive
- **SC-004**: The fix applies to all supported platforms, with verification showing the assets directory present in packaged applications for macOS, Windows, and Linux
- **SC-005**: Package size increases by no more than the actual size of the three asset packages (estimated 5-15MB), with no unnecessary files included
- **SC-006**: When webpack CopyWebpackPlugin configuration changes, validation automatically adapts without requiring manual updates, verified by adding/removing asset patterns and confirming validation accuracy

## Assumptions

- The webpack CopyWebpackPlugin configuration correctly identifies all required asset dependencies that need to be available at runtime
- The three specified packages are the complete set of runtime asset dependencies required for plugin functionality
- Electron-builder's default ASAR packaging is currently excluding the assets directory due to configuration or pattern matching issues
- The assets do not contain native binaries that require unpacking (they are pure JavaScript/TypeScript files)
- Plugins and renderer processes access these assets through relative paths or configured module resolution that expects them in the `assets/node_modules` directory
- The build tooling supports including specific node_modules subdirectories in the ASAR archive while excluding others based on configuration
- Validation can programmatically access and parse the webpack configuration to determine expected asset locations, enabling automatic synchronization between webpack patterns and validation logic
