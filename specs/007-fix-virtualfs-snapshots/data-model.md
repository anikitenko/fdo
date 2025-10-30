# Data Model: VirtualFS Snapshot System

## Overview

This document defines the data structures and relationships for the snapshot versioning system. All descriptions are technology-agnostic and focus on the logical data model.

## Core Entities

### Snapshot Version

A complete point-in-time capture of the editor state.

**Properties:**
- `version`: Unique identifier for this snapshot
- `date`: Timestamp when snapshot was created
- `prev`: Reference to the previous snapshot version (forming a version chain)
- `current`: Boolean indicating if this is the currently active version
- `tabs`: Collection of open tab states
- `content`: Collection of file contents and metadata

### File Content Entry

Represents a single file within a snapshot.

**Properties:**
- `id`: Full path identifier for the file (e.g., "/index.ts", "/components/Button.tsx")
- `content`: The complete text content of the file
- `state`: Editor state metadata for this file

### Editor State

Per-file editor view state that should be preserved.

**Properties:**
- `cursorPosition`: Line and column of cursor
- `scrollPosition`: Vertical scroll offset
- `selection`: Selected text ranges (if any)
- `viewState`: Additional editor-specific view configuration

### Tab State

Represents an open tab in the editor.

**Properties:**
- `id`: File path that this tab displays
- `active`: Boolean indicating if this is the currently active/visible tab
- `markers`: Collection of error/warning indicators for this file (optional)

### Version Storage Structure

The persistent storage representation of the version system.

**Properties:**
- `versions`: Map of version ID to Snapshot Version objects
- `version_latest`: ID of the most recently created snapshot
- `version_current`: ID of the currently active/displayed snapshot

## Relationships

```
Version Storage
  └─ versions: Map<string, Snapshot Version>
       └─ Snapshot Version
            ├─ prev: string (reference to another Snapshot Version)
            ├─ tabs: Tab State[]
            │    └─ id: string (reference to File Content Entry)
            └─ content: File Content Entry[]
                 └─ state: Editor State
```

## Data Flow

### Snapshot Creation Flow

1. Collect all File Content Entries from current editor state
2. Collect Tab State for all open tabs
3. Generate unique version identifier
4. Create Snapshot Version with collected data
5. Link to previous version (if exists)
6. Update version_latest and version_current pointers
7. Persist to storage

### Snapshot Restoration Flow

1. Load Snapshot Version by version ID
2. Clear current editor state (files, tabs, tree)
3. Recreate files from File Content Entries
4. Restore Editor State for each file
5. Recreate tabs from Tab State
6. Update version_current pointer
7. Refresh UI to reflect restored state

## Storage Considerations

- Data is compressed before persistence to minimize storage usage
- Target compression ratio: at least 50%
- Typical storage per snapshot: 100KB - 2MB depending on project size
- Storage quota management: Monitor usage and warn when approaching limits
- Exclude auto-generated files (dependencies, build outputs) to reduce size

## Version Chain Integrity

The version chain must maintain these invariants:

1. **Single Latest**: Only one version can be marked as `version_latest` at any time
2. **Single Current**: Only one version can be marked as `version_current` at any time
3. **Valid References**: All `prev` references must point to existing versions (or null for first version)
4. **Temporal Ordering**: Snapshot dates must be monotonically increasing along the version chain
5. **Referential Integrity**: File references in Tab State must match File Content Entry IDs within the same snapshot

## Edge Cases

- **Empty Projects**: Snapshots can exist with zero files (only tree structure)
- **Large Files**: Individual files may exceed 1MB - system must handle gracefully
- **Circular References**: Version chain `prev` references must never form cycles
- **Orphaned Versions**: If storage corruption occurs, orphaned versions should be detected and cleaned up

