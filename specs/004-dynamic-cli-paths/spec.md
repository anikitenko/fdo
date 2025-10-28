# Feature Specification: Dynamic CLI Path Resolution

**Feature Branch**: `004-dynamic-cli-paths`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "improve installation of CLI tool cross platform in @installFDOCLI.js file without hardcoded paths"

## Clarifications

### Session 2025-10-28

- Q: How should the installer handle an existing CLI file at the target installation path? → A: Skip installation silently and report success if any file exists at target path (idempotent)
- Q: What level of detail should be logged during path detection and installation? → A: Standard logging: info-level for major steps (detection start, each fallback attempt, final result), debug-level for all attempts
- Q: When multiple FDO installations exist and CLI already points to instance A, what happens when user installs CLI from instance B? → A: Apply idempotent rule: skip installation, report that CLI already exists (consistent with Q1 answer)
- Q: How should CLI installation behave when FDO is running from a development environment (e.g., webpack dev server, unbundled source)? → A: Allow installation using detected dev environment path, log warning that this is development mode
- Q: When CLI installation fails partway through (e.g., wrapper created but PATH update failed), what cleanup/recovery behavior should occur? → A: Leave partial installation intact, report detailed error with manual recovery instructions (user can retry or uninstall)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install CLI from Custom Application Location (Priority: P1)

A user installs the FDO application to a non-default location (e.g., custom drive, different directory) and wants to install the CLI tool. The CLI installer should automatically detect where the application is actually installed and create the appropriate CLI wrapper without requiring manual path configuration.

**Why this priority**: This is the core improvement needed. Hardcoded paths currently fail when the application is installed anywhere other than the default location, making the CLI installer unusable for many users.

**Independent Test**: Install FDO to a custom location (e.g., `D:\CustomApps\FDO` on Windows or `/opt/custom/FDO` on Linux), then trigger CLI installation. The CLI should work correctly without errors.

**Acceptance Scenarios**:

1. **Given** FDO is installed to a custom directory, **When** user requests CLI installation, **Then** the installer detects the actual application path and creates a working CLI wrapper
2. **Given** FDO is installed to the default system location, **When** user requests CLI installation, **Then** the installer continues to work as expected (backward compatibility)
3. **Given** user has FDO installed, **When** CLI installation is triggered, **Then** no hardcoded path assumptions cause installation to fail

---

### User Story 2 - Install CLI with Non-Standard System Paths (Priority: P2)

A user's system has non-standard PATH locations or permissions (e.g., `/usr/local/bin` doesn't exist, user doesn't have admin rights for default locations). The CLI installer should intelligently select appropriate fallback locations based on the user's system configuration and permissions.

**Why this priority**: Different system configurations and organizational policies mean default paths may not always be available. Users should still be able to install and use the CLI.

**Independent Test**: Test on a system where `/usr/local/bin` is not writable or doesn't exist. The installer should offer or use an appropriate alternative location (e.g., user's local bin directory).

**Acceptance Scenarios**:

1. **Given** the default CLI installation path is not writable, **When** user attempts CLI installation, **Then** the installer uses an appropriate fallback location that is writable
2. **Given** the system has custom PATH configurations, **When** CLI is installed, **Then** the installer detects and uses a PATH-accessible directory
3. **Given** user has limited permissions, **When** CLI installation is requested, **Then** the installer succeeds using user-writable locations

---

### User Story 3 - Uninstall CLI from Any Location (Priority: P2)

A user who previously installed the CLI (possibly to a custom location or with an older version that used different paths) wants to cleanly uninstall it. The CLI uninstaller should detect where the CLI is actually installed and remove it, regardless of whether paths have changed.

**Why this priority**: Clean uninstallation is important for system hygiene and troubleshooting. Users shouldn't have orphaned CLI files or broken symlinks.

**Independent Test**: Install CLI, then change system configuration or reinstall FDO to a different location. Uninstall should still find and remove the CLI installation.

**Acceptance Scenarios**:

1. **Given** CLI was installed using dynamic paths, **When** user requests uninstall, **Then** the uninstaller locates and removes the CLI correctly
2. **Given** CLI was installed with a previous version using hardcoded paths, **When** user requests uninstall, **Then** the uninstaller checks multiple possible locations and removes what it finds
3. **Given** no CLI is currently installed, **When** user attempts uninstall, **Then** the uninstaller reports clearly that nothing was found to remove

---

### User Story 4 - Portable FDO Installation (Priority: P3)

A user runs FDO from a portable/movable location (e.g., USB drive, network share, different machine) and wants the CLI to continue working when the application is moved or accessed from different mount points.

**Why this priority**: While less common, portable installations are valuable for developers who work across multiple machines or environments. This represents the ultimate flexibility.

**Independent Test**: Install FDO to a portable drive, install CLI, then move the drive to a different mount point or machine. Re-running CLI installation should update paths appropriately.

**Acceptance Scenarios**:

1. **Given** FDO is on a portable drive at location A, **When** user installs CLI, **Then** CLI works correctly
2. **Given** CLI was installed and FDO is moved to location B, **When** user runs CLI installation again, **Then** the CLI wrapper is updated to the new location
3. **Given** FDO location changes, **When** user runs the CLI, **Then** either it works with the new location or provides clear guidance to reinstall

---

### Edge Cases

- What happens when the application path contains spaces or special characters (e.g., `FDO (FlexDevOPs)`)?
- What happens when multiple versions of FDO are installed in different locations? (Resolved: idempotent behavior - first installation wins, subsequent installations skip)
- How does the system handle when the target CLI installation directory doesn't exist and can't be created?
- What happens if the application is running from a development environment (not installed)? (Resolved: allow installation with dev path, log warning about development mode)
- How does the system behave when there's an existing CLI installation at the target path? (Resolved: idempotent - skip and report success)
- What happens on systems with strict security policies that prevent symlink creation?
- How does the installer handle network paths or cloud-synced directories?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST dynamically detect the actual FDO application installation path at runtime, regardless of where it was installed
- **FR-002**: System MUST use Electron's runtime APIs (e.g., `app.getPath()`, `app.getAppPath()`) to determine application location instead of hardcoded paths
- **FR-003**: System MUST validate that the detected application path exists and is executable before creating CLI wrapper
- **FR-004**: System MUST handle paths containing spaces, special characters, and Unicode characters correctly across all platforms
- **FR-005**: System MUST determine appropriate CLI installation directories based on platform conventions and user permissions
- **FR-006**: System MUST check write permissions for target CLI installation directory before attempting installation
- **FR-007**: System MUST provide fallback installation locations if the primary target directory is not writable
- **FR-008**: System MUST create platform-appropriate CLI wrappers (shell scripts for Unix-like systems, batch/cmd files for Windows) using detected paths
- **FR-009**: System MUST handle both administrator/root installations and user-level installations gracefully
- **FR-010**: CLI uninstaller MUST detect current CLI installation location rather than assuming a hardcoded path
- **FR-011**: CLI uninstaller MUST check multiple possible installation locations to find CLI installations from previous versions
- **FR-012**: System MUST preserve backward compatibility with existing CLI installations when possible
- **FR-013**: System MUST provide clear error messages when path detection fails, including the attempted paths and reasons for failure
- **FR-014**: System MUST log path detection and installation activities with info-level logging for major steps (detection start, each fallback attempt, final result) and debug-level logging for all detailed attempts and checks
- **FR-015**: System MUST update PATH environment variable only for directories that are actually used
- **FR-016**: System MUST handle platform-specific path separators and conventions correctly
- **FR-017**: System MUST implement idempotent installation behavior: if a file already exists at the target CLI path, skip writing and report success without modification
- **FR-018**: System MUST support CLI installation from development environments (unbundled source, dev server) using detected dev paths, with warning-level logging indicating development mode
- **FR-019**: When installation fails partway through, system MUST leave partial installation intact, report detailed error including what succeeded and what failed, and provide manual recovery instructions (retry installation or run uninstall)

### Platform-Specific Requirements

#### macOS
- **FR-MAC-001**: System MUST detect application bundle path dynamically (may not always be in `/Applications`)
- **FR-MAC-002**: System MUST support both user-level (`~/bin`) and system-level (`/usr/local/bin`) CLI installations based on permissions
- **FR-MAC-003**: System MUST handle both Intel and Apple Silicon architectures

#### Windows
- **FR-WIN-001**: System MUST detect FDO executable path regardless of installation directory (`Program Files`, `Program Files (x86)`, custom locations)
- **FR-WIN-002**: System MUST use Windows Registry or environment variables to find application path when possible
- **FR-WIN-003**: System MUST handle both per-user and system-wide installations
- **FR-WIN-004**: System MUST properly escape PowerShell commands with paths containing spaces

#### Linux
- **FR-LIN-001**: System MUST detect application installation path which may vary by distribution and installation method
- **FR-LIN-002**: System MUST support standard Linux installation paths (`/usr/local/bin`, `/usr/bin`, `~/.local/bin`)
- **FR-LIN-003**: System MUST handle both AppImage, snap, flatpak, and traditional installations with different path structures

### Key Entities

- **Application Installation**: The location where FDO is actually installed, detected at runtime rather than assumed
  - Path (string, absolute, platform-specific)
  - Executable name (may vary by platform)
  - Installation type (system-wide vs user-level)
  - Detection method (how the path was determined)

- **CLI Installation Target**: The location where the CLI wrapper will be installed
  - Primary path (platform-appropriate default)
  - Fallback paths (alternatives if primary is not available)
  - Write permissions (boolean)
  - In system PATH (boolean)

- **Path Validation Result**: The outcome of attempting to use a specific path
  - Path (string)
  - Exists (boolean)
  - Writable (boolean)
  - In PATH (boolean)
  - Error message (if validation failed)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: CLI installation succeeds regardless of FDO installation location on all three supported platforms (macOS, Windows, Linux)
- **SC-002**: CLI installation completes without errors when FDO is installed to non-default directories in 100% of test cases
- **SC-003**: Installation process detects and handles paths with spaces and special characters correctly in 100% of cases
- **SC-004**: When default installation directory is not writable, the installer automatically selects and uses a valid fallback location without user intervention
- **SC-005**: CLI uninstaller successfully removes CLI installation in 100% of cases, including installations from previous versions
- **SC-006**: Users can complete CLI installation and verification (running `fdo --version` or similar) in under 30 seconds
- **SC-007**: Error messages for failed installations include specific, actionable information about what path was attempted, why it failed, and manual recovery steps
- **SC-008**: No user reports of CLI installation failures due to hardcoded path assumptions after this feature is deployed
- **SC-009**: Users experiencing partial installation failures can successfully retry installation without manual cleanup (idempotent recovery)

## Assumptions

1. The FDO application has access to standard Electron APIs for path detection (`app.getPath()`, `app.getAppPath()`, `process.execPath`, etc.)
2. Users installing CLI have at least write access to their user-level directories (e.g., `~/bin`, `%USERPROFILE%\AppData\Local`)
3. The CLI wrapper needs only to execute the main FDO application and pass through command-line arguments
4. For Linux, we'll prioritize standard desktop installations over containerized installations (snap/flatpak) for the first iteration
5. The application's main executable path doesn't change during runtime (no moving the app while it's running)
6. Standard sudo/administrator authentication mechanisms work as expected on each platform
7. When multiple FDO installations exist, the running instance is the one for which CLI should be installed
8. Installer uses idempotent behavior: any existing file at target path is left untouched, making repeated installations safe and fast

## Dependencies

- Electron framework APIs for application path detection
- Platform-specific system utilities (shell for Unix, PowerShell for Windows)
- `runWithSudo` utility for elevated permission operations
- File system APIs for path validation and permission checking

## Open Questions

None - all critical decisions have reasonable defaults based on platform conventions and Electron best practices.
