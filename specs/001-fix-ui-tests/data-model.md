# Data Model: UI Test Infrastructure

**Branch**: 001-fix-ui-tests  
**Spec**: ./spec.md  
**Date**: 2025-10-30

## Entities

### Test Client
- Purpose: WebSocket-based controller for renderer evaluation
- Fields:
  - serverUrl: string (default ws://localhost:9555)
  - timeoutMs: number
  - connectedAt: timestamp
- Relationships:
  - Connects to Test Server (1:1 per run)
- Validation:
  - serverUrl must be ws:// or wss://

### Test Server
- Purpose: Electron main-process WebSocket server routing eval to renderer
- Fields:
  - port: number (9555)
  - pid: number
  - startedAt: timestamp
- Relationships:
  - Services exactly one Test Client per run
- Constraints:
  - Port must be available or run aborts per FR-005a

### Skeleton Monitor
- Purpose: In-page collector of `.bp6-skeleton` state transitions
- Fields:
  - events: Array<{ time: ms, hasSkeleton: boolean }>
  - startedAt: timestamp
- Validation:
  - events length transitions ≤ 2 for version switches

### Monaco Model Snapshot
- Purpose: Representation of editor content at assertion time
- Fields:
  - path: string (normalized)
  - language: string
  - contentLength: number
- Validation:
  - index file must have contentLength > 0 within 2s

### Performance Metrics
- Purpose: Timing and mutation counters for regression checks
- Fields:
  - tree_ready: ms since start
  - editor_ready: ms since start
  - index_content_ready: ms since start
  - mut_tree: number
  - mut_editor: number
- Constraints:
  - mut_tree, mut_editor < 400

## State Transitions

### Test Run Lifecycle
- INIT → SERVER_START → CLIENT_CONNECT → TEST_EXECUTE → CLEANUP → DONE
- Failure states:
  - PORT_CONFLICT (abort)
  - LAUNCH_TIMEOUT (retry up to 3)
  - CONTENT_TIMEOUT (fail with diagnostics)

## Identity & Uniqueness
- Test Server identity: (port, pid)
- Test Client session: (connectedAt, serverUrl)
- Skeleton event ordering by `time` ascending

## Scale Assumptions
- Single local developer; one active run at a time (no sharding)
- CI parallelism handled at job level, not per-port reuse
