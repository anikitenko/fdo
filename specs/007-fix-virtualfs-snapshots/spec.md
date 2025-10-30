# Feature Specification: VirtualFS Snapshot Creation and Restoration Fix

**Feature Branch**: `007-fix-virtualfs-snapshots`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "Need to fix a bug with @VirtualFS.js where it's creating a snapshot and restoring snapshot.. the process is too buggy and needs refinement"

## Clarifications

### Session 2025-10-28

- Q: How do users trigger snapshot creation? → A: Manual creation only - Users explicitly trigger snapshot via UI button/action
- Q: What happens when snapshot storage limit is reached or how do users manage old snapshots? → A: Warn when approaching limit, allow manual deletion anytime via UI
- Q: What do users see during and after a failed snapshot operation that triggers rollback? → A: Show error message, confirm rollback succeeded, editor stays at original state
- Q: What visual feedback do users see during long-running snapshot operations? → A: Progress bar with percentage and operation stage indicator (e.g., "Restoring files 15/20")
- Q: Can users add custom names or labels to snapshots for easier identification? → A: Timestamps only, system-generated version IDs (no custom names)
- Q: What diagnostic information should be logged during snapshot operations? → A: Log operation lifecycle events and errors to electron-log (start, complete, errors, rollback)
- Q: What happens when the same project is open in multiple editor windows and snapshot operations occur? → A: Shared snapshots - All windows see same version list, last operation wins on conflicts

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable Snapshot Creation (Priority: P1)

A developer is working on a plugin in the editor and wants to save their current work state by creating a snapshot (version). When they trigger a snapshot creation, the system must reliably capture all file contents, editor states, and metadata without data loss or corruption, regardless of how many files are open or how complex the project structure is.

**Why this priority**: Snapshot creation is the primary mechanism for saving work progress. If this fails or corrupts data, users lose their work, which is catastrophic. This is the foundation of the version control system within the editor.

**Independent Test**: Can be fully tested by creating a project with multiple files, making changes across different files, creating a snapshot, and verifying all file contents and states are preserved correctly. Test can be repeated with varying numbers of files and content sizes.

**Acceptance Scenarios**:

1. **Given** an editor session with 5 open files containing unsaved changes, **When** user creates a snapshot, **Then** all file contents are captured exactly as they appear in the editor
2. **Given** user has files with syntax errors visible in the editor, **When** snapshot is created, **Then** the snapshot completes successfully without corruption despite the errors
3. **Given** user creates a snapshot while files are still being loaded or processed, **When** the snapshot operation executes, **Then** the system waits for pending operations to complete or handles them gracefully without data loss
4. **Given** user creates multiple snapshots in rapid succession (within 1 second), **When** each snapshot is triggered, **Then** all snapshots are created successfully without overwriting or corrupting each other
5. **Given** browser storage space is nearly full, **When** user attempts to create a snapshot, **Then** the system either completes successfully or provides clear feedback about the storage issue without leaving partial/corrupted data
6. **Given** a snapshot operation fails midway through execution, **When** the system performs automatic rollback, **Then** user receives an error message explaining the failure and explicit confirmation that the editor has been returned to its previous stable state

---

### User Story 2 - Reliable Snapshot Restoration (Priority: P1)

A developer wants to restore a previous version of their plugin to review or continue work from an earlier state. When they select a snapshot to restore, the system must reliably reconstruct the exact editor state including all files, open tabs, editor positions, and tree structure, without leaving residual data from the previous state.

**Why this priority**: Restoration is equally critical to creation - if users can save but not restore, the feature is worthless. Failed restoration can leave the editor in an inconsistent state requiring application restart, disrupting workflow.

**Independent Test**: Can be tested by creating a snapshot with known state (specific files, content, open tabs), making substantial changes, then restoring the original snapshot and verifying the editor returns to the exact previous state. Test with multiple restore cycles to ensure repeatability.

**Acceptance Scenarios**:

1. **Given** user has created a snapshot with 3 open files, **When** user makes changes and then restores that snapshot, **Then** the editor displays exactly those 3 files with their original content and the same files are open in tabs
2. **Given** a snapshot contains a folder structure with nested directories, **When** user restores that snapshot, **Then** the file tree rebuilds completely showing all folders and files in the correct hierarchy
3. **Given** user restores a snapshot while the editor is currently processing a build, **When** the restoration executes, **Then** the build operation is cancelled cleanly and the snapshot restores without interference
4. **Given** user rapidly switches between different snapshot versions (restore A, then B, then A again within 5 seconds), **When** each restore completes, **Then** each restoration produces the correct state without state bleeding between versions
5. **Given** a snapshot was created with specific error and warning indicators visible in the editor, **When** user restores that snapshot, **Then** indicators are cleared and re-established correctly based on the restored content
6. **Given** user initiates restoration of a large snapshot (20+ files), **When** the restoration is in progress, **Then** user sees a progress bar with percentage and stage indicators (e.g., "Restoring files 15/20") showing operation progress

---

### User Story 3 - Consistent State During Version Operations (Priority: P2)

A developer is working with the version history UI, viewing the list of available snapshots and their metadata (date, version number). When performing snapshot operations (create, restore, view list), the version history UI must stay synchronized with the actual state, showing accurate information about current vs. available versions.

**Why this priority**: While not causing data loss, incorrect version metadata confuses users about which version is current and makes version navigation unreliable. This affects usability but doesn't block core functionality.

**Independent Test**: Can be tested by creating several snapshots, restoring different versions, and verifying the UI correctly indicates which version is current at each step. Verify version list updates in real-time during operations.

**Acceptance Scenarios**:

1. **Given** user has created 5 snapshots, **When** user restores snapshot #3, **Then** the version list shows snapshot #3 as "current" and displays accurate timestamps for all versions
2. **Given** user creates a new snapshot, **When** the creation completes, **Then** the version list updates immediately showing the new version at the top with correct metadata
3. **Given** user has multiple editor windows open for the same project, **When** a snapshot is created in one window, **Then** all windows see the new snapshot in their version list
4. **Given** user has the same project open in two windows and creates snapshots simultaneously, **When** both operations complete, **Then** both snapshots are created and the last completed operation determines the current version pointer
5. **Given** user has two windows open with one showing version A as current, **When** the other window restores version B, **Then** the first window's version list updates to show version B as current

---

### Edge Cases

- When browser storage quota is exceeded during snapshot creation, system provides clear error message and does not leave partially saved data
- If a file representation becomes invalid or is removed during snapshot creation, system handles gracefully by skipping that file and logging the issue rather than failing the entire snapshot
- When restoring a snapshot that references files no longer available in the project dependencies, system recreates what it can and notifies user of missing dependencies
- When user closes the editor window during snapshot creation or restoration, operations are cancelled cleanly or completed before window closes
- If two windows perform snapshot operations simultaneously, both operations complete successfully and the last write determines the current version pointer in shared storage
- When a snapshot is deleted in one window while another window has that snapshot active, the affected window either maintains its current editor state or switches to the latest available snapshot gracefully
- When a snapshot contains extremely large files (>10MB of code), restoration handles memory efficiently without freezing the UI
- If tree structure state (expanded/collapsed folders) differs between creation and restoration, system handles gracefully
- When network connectivity is lost during snapshot operations, system handles operations using locally cached data without errors
- If the user's system runs out of memory during restoration of a large snapshot, system provides clear error message and maintains editor in stable state
- When user attempts to delete a snapshot that is part of the version chain (has snapshots linked to it), system handles deletion gracefully without breaking version history
- If user attempts to delete the currently active snapshot, system prevents the deletion and provides clear feedback

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide explicit user-initiated snapshot creation triggered by UI action (button, menu, or keyboard shortcut), not automatic or time-based creation
- **FR-002**: System MUST capture complete file content during snapshot creation, including files that are open in tabs and files that exist in the tree but are not currently visible
- **FR-003**: System MUST store editor state metadata (cursor position, scroll position, selection) for each open file in the snapshot
- **FR-004**: System MUST maintain data consistency between temporary working memory and persistent storage throughout all operations
- **FR-005**: System MUST properly clean up existing file representations before creating new ones during restoration, preventing memory accumulation
- **FR-006**: System MUST validate that file representations exist and are valid before attempting cleanup operations during restoration
- **FR-007**: System MUST clear error and warning indicators before removing file representations to prevent orphaned visual markers
- **FR-008**: System MUST handle storage operations with proper error handling, including quota exceeded errors, and provide meaningful feedback to users
- **FR-009**: System MUST prevent concurrent snapshot operations (create or restore) from executing simultaneously, ensuring operations complete sequentially
- **FR-010**: System MUST show accurate loading indicators throughout snapshot operations, ensuring visual feedback matches actual operation state
- **FR-011**: System MUST display progress indicators showing percentage completion and current operation stage (e.g., "Restoring files 15/20", "Updating tree view") during snapshot operations
- **FR-012**: System MUST maintain tree structure state (expanded/collapsed folders, selected file) consistently between snapshot creation and restoration
- **FR-013**: System MUST validate snapshot data integrity after save and load operations, detecting corrupted data before attempting to use it
- **FR-014**: System MUST update user interface elements in the correct sequence during snapshot operations (tree view, file list, version list)
- **FR-015**: System MUST exclude auto-generated files (dependencies, build outputs) from snapshot content as they can be regenerated, reducing snapshot size
- **FR-016**: System MUST track open tabs state (which tabs are open, which is active) and restore this state accurately during snapshot restoration
- **FR-017**: System MUST clean up background processes and listeners properly when switching between snapshots to prevent memory accumulation
- **FR-018**: System MUST provide atomic operations for snapshot creation and restoration - if an operation fails midway, system reverts to previous stable state rather than leaving editor in inconsistent state
- **FR-019**: System MUST display clear error messages to users when snapshot operations fail, including the reason for failure and confirmation that rollback completed successfully
- **FR-020**: System MUST validate version relationships (current, latest, previous) and maintain correct version chain after each operation
- **FR-021**: System MUST complete each snapshot operation fully before allowing user to initiate another operation, preventing race conditions
- **FR-022**: System MUST preserve file encoding and line ending styles when capturing and restoring file content
- **FR-023**: System MUST handle storage quota limits gracefully by providing clear warnings before operations and helpful error messages when limits are reached
- **FR-024**: System MUST provide UI functionality for users to manually delete individual snapshots at any time
- **FR-025**: System MUST warn users when snapshot storage usage approaches 80% of browser storage quota, prompting them to delete old snapshots
- **FR-026**: System MUST prevent deletion of the currently active snapshot to avoid leaving the editor in an invalid state
- **FR-027**: System MUST identify snapshots using system-generated version IDs and timestamps only, without requiring or supporting custom user-provided names
- **FR-028**: System MUST log snapshot operation lifecycle events (start, complete, error, rollback) to application log for debugging and diagnostics
- **FR-029**: System MUST log error details including operation type, failure point, and relevant context (file count, storage usage) when snapshot operations fail
- **FR-030**: System MUST include version IDs and timestamps in log entries to enable correlation between user actions and system behavior
- **FR-031**: System MUST use shared storage for snapshots such that all editor windows for the same project access the same version list and snapshot data
- **FR-032**: System MUST implement last-write-wins conflict resolution when multiple windows perform snapshot operations simultaneously
- **FR-033**: System MUST refresh version list display when changes are detected in shared storage (from other window instances)
- **FR-034**: System MUST handle scenarios where the currently active snapshot in one window is deleted by another window, by reverting to the latest available snapshot or maintaining the current editor state

### Key Entities

- **Snapshot Version**: A complete saved state of the editor including file contents, tree structure, open tabs, editor states, and metadata (system-generated version ID, ISO timestamp, previous version reference)
- **File System State**: The collection of file representations, tree structure, and persistent storage that collectively represent the current editor state
- **Version Chain**: The linked relationship between snapshots tracking version history (version ID, previous version, creation date) stored persistently
- **Editor State**: Per-file metadata including cursor position, scroll offset, selection ranges, and view state that must be preserved across snapshot operations

## Assumptions and Dependencies

### Assumptions

- Users typically work with plugin projects containing 5-50 files with total size under 10MB
- Users create snapshots periodically (every few minutes to hours) rather than continuously
- Browser storage (IndexedDB/localStorage) provides at least 50MB of available quota for snapshot storage
- Users may occasionally have the same project open in multiple editor windows, but simultaneous snapshot operations are rare
- When multi-window scenarios occur, last-write-wins conflict resolution is acceptable (users don't expect CRDT-style merging)
- File content is primarily text-based code and configuration files, not binary assets
- Users expect snapshot operations to complete within a few seconds for typical project sizes
- Generated/derived files (build outputs, dependencies) do not need to be included in snapshots

### Dependencies

- The editor must provide stable file representation APIs that remain valid throughout snapshot operations
- The file tree structure must be fully loaded and stable before snapshot creation can begin
- Browser storage APIs must be available and functional (not disabled by browser settings or extensions)
- The version history UI must be able to receive and display real-time updates about snapshot operations
- Error and warning indicator systems must be accessible for cleanup during restoration operations
- The editor's tab management system must support programmatic tab creation and activation during restoration
- Browser storage events or polling mechanism must be available to detect when other window instances modify shared snapshot data

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Snapshot creation succeeds 100% of the time for projects with up to 50 files under normal conditions (adequate storage space available)
- **SC-002**: Snapshot restoration accurately reconstructs editor state with 100% fidelity - all files, content, and open tabs match the original snapshot state
- **SC-003**: Users can create and restore snapshots 20+ consecutive times without encountering state corruption or requiring application restart
- **SC-004**: Snapshot creation completes within 2 seconds for projects with up to 20 files and 5MB total content
- **SC-005**: Snapshot restoration completes within 3 seconds for projects with up to 20 files and 5MB total content
- **SC-006**: Application memory usage remains stable across multiple snapshot operations (no continuous memory growth over 10 consecutive operations)
- **SC-007**: Snapshot storage efficiency maintains at least 50% compression ratio, keeping 50 snapshots under browser storage quota for typical plugin projects
- **SC-008**: Version history UI shows accurate current version and version list 100% of the time after any snapshot operation
- **SC-009**: System handles storage quota exceeded scenarios gracefully with user-friendly error messages in 100% of cases (no silent failures)
- **SC-010**: Users can rapidly switch between different snapshot versions (restore operation every 2 seconds) without encountering errors or inconsistent state
- **SC-011**: Zero occurrences of snapshot operations leaving the editor in an unusable state requiring page reload or application restart
- **SC-012**: All snapshot operation failures produce diagnostic log entries containing sufficient context (operation type, version ID, error details) to enable issue reproduction and debugging
- **SC-013**: When multiple windows have the same project open, snapshot operations in one window reflect in other windows' version lists within 2 seconds (via storage change detection or polling)
- **SC-014**: Simultaneous snapshot operations from multiple windows complete without data corruption, with deterministic last-write-wins behavior

