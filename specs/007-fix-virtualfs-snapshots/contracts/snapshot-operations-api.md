# Contract: Snapshot Operations API

**Version**: 1.0  
**Status**: Draft  
**Created**: October 28, 2025

## Overview

This contract defines the interface and behavior guarantees for the VirtualFS snapshot operations. Any implementation must adhere to these contracts to ensure reliability and consistency.

## Snapshot Creation Contract

### Input Contract

**Preconditions:**
- Editor state is stable (no pending file operations)
- At least one file exists in the project OR project is intentionally empty
- Browser storage has available quota (checked before operation)

**Parameters:**
- `prevVersion` (optional): Version ID of the previous snapshot to link to
- `tabs` (optional): Current tab state to preserve

### Output Contract

**Success Response:**
```javascript
{
  version: string,      // Unique ID for the created snapshot
  date: string,         // ISO 8601 timestamp
  prev: string | null   // Previous version ID or null
}
```

**Postconditions (Guarantees):**
1. All visible and hidden file contents are captured exactly as they exist
2. Tab states (open tabs, active tab) are preserved
3. New snapshot is set as both `version_latest` and `version_current`
4. Data is persisted to browser storage
5. In-memory state matches persisted state
6. Version chain integrity is maintained
7. UI notifications are triggered in correct sequence

**Error Conditions:**
- `STORAGE_QUOTA_EXCEEDED`: Browser storage quota exhausted
- `INVALID_STATE`: Editor state is invalid or corrupted
- `OPERATION_IN_PROGRESS`: Another snapshot operation is running
- `COMPRESSION_FAILED`: Data compression operation failed

---

## Snapshot Restoration Contract

### Input Contract

**Preconditions:**
- Target snapshot version exists and is valid
- No other snapshot operation is in progress
- Editor is in a restorable state (can be cleaned up)

**Parameters:**
- `version` (required): Version ID of snapshot to restore

### Output Contract

**Success Response:**
```javascript
{
  tabs: TabState[]     // Restored tab configuration
}
```

**Postconditions (Guarantees):**
1. ALL previous file representations are cleaned up (no orphaned data)
2. ALL files from snapshot are recreated exactly
3. Tab states match the snapshot (same tabs open, correct active tab)
4. Tree structure reflects snapshot state
5. Error/warning indicators are cleared before restoration
6. `version_current` is updated to target version
7. In-memory state matches persisted state
8. UI is fully updated and responsive

**Error Conditions:**
- `VERSION_NOT_FOUND`: Target version does not exist
- `CORRUPTED_DATA`: Snapshot data is corrupted or invalid
- `OPERATION_IN_PROGRESS`: Another snapshot operation is running
- `DECOMPRESSION_FAILED`: Data decompression operation failed
- `RESTORE_FAILED`: Restoration failed midway (should trigger rollback)

---

## Version List Contract

### Input Contract

**Preconditions:**
- Version system is initialized

**Parameters:**
- None

### Output Contract

**Success Response:**
```javascript
[
  {
    version: string,
    date: string,
    prev: string | null,
    current: boolean
  },
  // ... more versions
]
```

**Postconditions:**
- List is sorted by creation date (newest first)
- Exactly one version has `current: true` (if any versions exist)
- All `prev` references are valid or null

---

## Atomicity Guarantee

**Contract**: All snapshot operations are atomic.

**If an operation fails:**
1. System MUST revert to the state before the operation began
2. No partial data is left in storage or memory
3. Version pointers remain unchanged
4. User receives clear error message
5. Editor remains in a usable state

**Implementation Requirement:**
- Operations use transaction-like patterns
- State changes are buffered until operation completes
- Rollback procedures are defined for each step
- Validation occurs before committing changes

---

## Concurrency Contract

**Contract**: Only one snapshot operation executes at a time.

**Guarantees:**
1. If operation A is in progress, operation B waits or is rejected
2. No race conditions between create/restore operations
3. Loading indicators accurately reflect operation state
4. Queue depth is limited (no infinite queuing)

---

## Data Integrity Contract

**Contract**: Snapshot data maintains integrity through all operations.

**Validation Points:**
1. **Before Creation**: Verify all file contents are accessible
2. **After Compression**: Verify compressed data can be decompressed
3. **Before Restoration**: Verify snapshot data is not corrupted
4. **After Restoration**: Verify all files were recreated correctly

**Checksum/Validation:**
- Snapshots include validation metadata
- Data corruption is detected before use
- Invalid snapshots are flagged and isolated

---

## Memory Management Contract

**Contract**: Snapshot operations do not leak memory.

**Guarantees:**
1. All file representations are disposed before creating new ones
2. Event listeners are removed when no longer needed
3. Large objects are eligible for garbage collection after operations
4. Memory usage returns to baseline after operation completes

**Monitoring:**
- Memory profiling should show stable usage pattern
- 10 consecutive operations should not show continuous growth
- Peak memory during operation should be bounded

---

## Performance Contract

**Contract**: Operations complete within acceptable time limits.

**Guarantees:**
- **Small Projects** (≤5 files, <1MB): 
  - Create: <500ms
  - Restore: <1s
  
- **Medium Projects** (6-20 files, 1-5MB):
  - Create: <2s
  - Restore: <3s
  
- **Large Projects** (21-50 files, 5-10MB):
  - Create: <5s
  - Restore: <7s

**Loading Indicators:**
- Progress indication starts within 100ms
- UI remains responsive throughout operation
- User can cancel long-running operations

---

## Error Handling Contract

**Contract**: All errors are handled gracefully with clear user feedback.

**Guarantees:**
1. No silent failures (all errors are reported)
2. Error messages are user-friendly (no stack traces)
3. Suggested actions are provided for recoverable errors
4. Critical errors prevent further operations until resolved

**Error Message Format:**
```javascript
{
  code: string,           // Machine-readable error code
  message: string,        // User-friendly description
  details?: string,       // Additional context
  action?: string,        // Suggested user action
  recoverable: boolean    // Can user retry/recover?
}
```

---

## Test Scenarios

Each contract must be validated with these test scenarios:

1. **Happy Path**: Normal operation with typical project
2. **Edge Cases**: Empty projects, single file, 50 files
3. **Error Conditions**: Storage full, corrupted data, invalid state
4. **Concurrent Operations**: Attempt simultaneous create/restore
5. **Memory Testing**: 20 consecutive operations, check for leaks
6. **Performance Testing**: Measure against performance contract
7. **Atomicity Testing**: Simulate failures at each step, verify rollback
8. **Data Integrity**: Verify byte-for-byte restoration accuracy

