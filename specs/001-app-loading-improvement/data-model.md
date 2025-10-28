# Phase 1: Data Model - App Loading Improvement

**Feature**: 001-app-loading-improvement  
**Date**: 2025-10-27  
**Status**: Complete

## Overview

This document defines the data structures used for startup metrics tracking, asset categorization, and performance monitoring during FDO application launch.

---

## 1. Startup Metrics

### Purpose
Track application launch performance from process start to interactive UI, enabling performance analysis and regression detection.

### Structure

```typescript
interface StartupMetric {
  // Event identification
  event: StartupEvent;           // Which stage of startup
  timestamp: bigint;             // High-resolution timestamp (process.hrtime.bigint())
  
  // Calculated timing
  elapsed: number;               // Milliseconds since process start
  delta: number;                 // Milliseconds since previous event
  
  // Context
  platform: Platform;            // darwin | linux | win32
  arch: Architecture;            // x64 | arm64 | ia32
  startupType: StartupType;      // cold | warm
  
  // Performance flags
  slow: boolean;                 // true if exceeds 4.5s threshold
  
  // Optional metadata
  metadata?: Record<string, any>;  // Event-specific data
}

type StartupEvent =
  | 'process-start'              // Process initialization begins
  | 'app-ready'                  // Electron app.ready fired
  | 'window-created'             // BrowserWindow instance created
  | 'window-visible'             // Window shown to user
  | 'renderer-process-start'     // Renderer process begins loading
  | 'renderer-loaded'            // webContents.did-finish-load
  | 'react-mount-start'          // React.render() called
  | 'react-mount-complete'       // React mount finished
  | 'app-interactive'            // UI fully interactive (FINAL)
  ;

type Platform = 'darwin' | 'linux' | 'win32';
type Architecture = 'x64' | 'arm64' | 'ia32';
type StartupType = 'cold' | 'warm';
```

### Relationships

- **Sequence**: Events occur in strict order (enforced by monotonic timestamps)
- **Parent**: All metrics belong to a single startup session
- **Aggregation**: Multiple startups can be aggregated for statistical analysis

### Validation Rules

- `timestamp` MUST be monotonically increasing within a session
- `elapsed` MUST be >= 0
- `delta` MUST be >= 0
- `slow` flag MUST be true if `elapsed` > 4500ms (4.5 second threshold)
- `platform` MUST match `process.platform`
- `arch` MUST match `process.arch`

### Example

```json
{
  "event": "app-interactive",
  "timestamp": "1234571190000000",
  "elapsed": 2850,
  "delta": 500,
  "platform": "darwin",
  "arch": "arm64",
  "startupType": "warm",
  "slow": false,
  "metadata": {
    "pluginCount": 3,
    "memoryUsage": 245000000
  }
}
```

---

## 2. Startup Log Entry

### Purpose
Persistent record of startup metrics for historical analysis and debugging.

### Structure

```typescript
interface StartupLogEntry {
  // Event data (from StartupMetric)
  event: StartupEvent;
  timestamp: string;             // bigint as string for JSON serialization
  elapsed: string;               // e.g., "2850ms"
  
  // Context
  platform: Platform;
  arch: Architecture;
  startupType: StartupType;
  
  // Performance flags
  slow?: boolean;                // Only present if true
  
  // Session metadata
  session: string;               // UUID for this startup session
  version: string;               // FDO application version
  electronVersion: string;       // Electron version
  
  // Additional context
  metadata?: Record<string, any>;
}
```

### Storage Format

**File**: `~/.fdo/logs/startup.log` (or OS equivalent)  
**Format**: Newline-delimited JSON (NDJSON)  
**Rotation**: Append-only, manual rotation by user if needed

### Example Log File

```ndjson
{"event":"process-start","timestamp":"1234567890000000","elapsed":"0ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"app-ready","timestamp":"1234568390000000","elapsed":"500ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"app-interactive","timestamp":"1234570740000000","elapsed":"2850ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"process-start","timestamp":"1234580000000000","elapsed":"0ms","platform":"darwin","arch":"arm64","startupType":"warm","session":"e5f6g7h8","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"app-interactive","timestamp":"1234581800000000","elapsed":"1800ms","platform":"darwin","arch":"arm64","startupType":"warm","session":"e5f6g7h8","version":"1.0.0","electronVersion":"37.2.6"}
```

### Validation Rules

- Each line MUST be valid JSON
- Lines MUST be separated by newline (`\n`)
- `timestamp` MUST be valid bigint as string
- `session` MUST be consistent within a startup sequence
- File MUST be appendable (no overwrites)

---

## 3. Asset Manifest

### Purpose
Categorize application assets as critical (preload) or lazy (load on-demand) to optimize startup time.

### Structure

```typescript
interface AssetManifest {
  critical: CriticalAssets;     // Must load before interactive
  lazy: LazyAssets;              // Load on-demand
}

interface CriticalAssets {
  // Framework and runtime
  framework: string[];           // ['react', 'react-dom', 'react-router-dom']
  
  // Core UI components (home screen)
  components: string[];          // ['Home.jsx', 'SideBar.jsx', 'CommandBar.jsx']
  
  // Critical CSS
  styles: string[];              // ['main.css', 'layout.css']
  
  // Essential utilities
  utilities: string[];           // ['store.js', 'ipc/channels.js']
  
  // Window chrome
  chrome: string[];              // Window frame, title bar, etc.
}

interface LazyAssets {
  // Feature routes
  routes: LazyRoute[];
  
  // Large libraries
  libraries: LazyLibrary[];
  
  // Non-essential UI
  dialogs: string[];             // Modals, settings screens
}

interface LazyRoute {
  path: string;                  // React Router path
  component: string;             // Component to lazy load
  chunk: string;                 // Webpack chunk name
  size: number;                  // Estimated size in bytes
}

interface LazyLibrary {
  name: string;                  // Library name
  usage: string;                 // Where it's used
  size: number;                  // Bytes
  loadTrigger: string;           // When to load
}
```

### Example

```typescript
const manifest: AssetManifest = {
  critical: {
    framework: ['react', 'react-dom', 'react-router-dom'],
    components: [
      'Home.jsx',
      'SideBar.jsx',
      'CommandBar.jsx',
      'NavigationPluginsButton.jsx',
      'PluginContainer.jsx'
    ],
    styles: [
      'assets/css/style.css',
      'assets/css/pure-min.css',
      'Home.module.scss'
    ],
    utilities: [
      'utils/store.js',
      'ipc/channels.js',
      'utils/NotificationCenter.js'
    ],
    chrome: ['App.jsx', 'main.jsx']
  },
  lazy: {
    routes: [
      {
        path: '/editor',
        component: 'EditorPage.jsx',
        chunk: 'editor',
        size: 2500000  // ~2.5MB (Monaco Editor is large)
      },
      {
        path: '/live-ui',
        component: 'LiveUI.jsx',
        chunk: 'live-ui',
        size: 1800000  // ~1.8MB (ReactFlow is large)
      }
    ],
    libraries: [
      {
        name: '@monaco-editor/react',
        usage: 'Code editor',
        size: 2000000,
        loadTrigger: 'Navigate to /editor'
      },
      {
        name: '@xyflow/react',
        usage: 'Flow diagram editor',
        size: 1500000,
        loadTrigger: 'Navigate to /live-ui'
      }
    ],
    dialogs: [
      'SettingsDialog.jsx',
      'ManagePluginsDialog.jsx',
      'CreatePluginDialog.jsx'
    ]
  }
};
```

### Validation Rules

- All paths in `critical.components` MUST exist in source tree
- All paths in `lazy.routes` MUST have corresponding webpack chunks
- Combined `critical` asset size SHOULD be <1MB for fast load
- Each `lazy.routes` entry MUST have unique `path`
- `lazy.libraries` size estimates SHOULD be within 20% of actual

---

## 4. Startup Performance Report

### Purpose
Aggregate startup metrics for statistical analysis and trend detection.

### Structure

```typescript
interface StartupPerformanceReport {
  // Time range
  period: {
    start: Date;
    end: Date;
  };
  
  // Statistics
  samples: number;               // Number of startups measured
  
  cold: {
    mean: number;                // Average cold start time (ms)
    median: number;
    p95: number;                 // 95th percentile
    p99: number;                 // 99th percentile
    min: number;
    max: number;
  };
  
  warm: {
    mean: number;                // Average warm start time (ms)
    median: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  
  // Platform breakdown
  byPlatform: Record<Platform, PlatformStats>;
  
  // Slow starts
  slowStarts: number;            // Count of starts >4.5s
  slowStartRate: number;         // Percentage (0-100)
  
  // Trends
  trend: 'improving' | 'stable' | 'degrading';
}

interface PlatformStats {
  samples: number;
  mean: number;
  median: number;
  p95: number;
}
```

### Example

```typescript
const report: StartupPerformanceReport = {
  period: {
    start: new Date('2025-10-01'),
    end: new Date('2025-10-27')
  },
  samples: 150,
  cold: {
    mean: 2850,
    median: 2800,
    p95: 3200,
    p99: 3500,
    min: 2400,
    max: 4100
  },
  warm: {
    mean: 1850,
    median: 1800,
    p95: 2100,
    p99: 2300,
    min: 1600,
    max: 2500
  },
  byPlatform: {
    darwin: { samples: 80, mean: 2750, median: 2700, p95: 3100 },
    linux: { samples: 40, mean: 2900, median: 2850, p95: 3300 },
    win32: { samples: 30, mean: 2950, median: 2900, p95: 3400 }
  },
  slowStarts: 5,
  slowStartRate: 3.33,
  trend: 'improving'
};
```

---

## 5. Error Tracking

### Purpose
Track window creation failures and recovery attempts.

### Structure

```typescript
interface StartupError {
  // Error identification
  timestamp: bigint;
  session: string;
  
  // Error details
  phase: StartupEvent;           // Where error occurred
  error: {
    name: string;                // Error type
    message: string;             // Error message
    stack?: string;              // Stack trace
    code?: string;               // Error code (if available)
  };
  
  // Recovery attempts
  retryAttempt: number;          // 0 for first failure, increments
  recovered: boolean;            // true if retry succeeded
  
  // Context
  platform: Platform;
  arch: Architecture;
  version: string;
}
```

### Example

```typescript
const error: StartupError = {
  timestamp: 1234567890000000n,
  session: "x9y8z7w6",
  phase: "window-created",
  error: {
    name: "Error",
    message: "Failed to create browser window",
    stack: "Error: Failed to create browser window\n  at createWindow (main.js:45:12)",
    code: "EACCES"
  },
  retryAttempt: 0,
  recovered: false,
  platform: "linux",
  arch: "x64",
  version: "1.0.0"
};
```

---

## 6. Single Instance State

### Purpose
Track single-instance lock status and second-instance events.

### Structure

```typescript
interface SingleInstanceState {
  // Lock status
  hasLock: boolean;              // true if this is the first instance
  lockAcquiredAt: bigint;        // When lock was acquired
  
  // Second instance tracking
  secondInstanceEvents: SecondInstanceEvent[];
}

interface SecondInstanceEvent {
  timestamp: bigint;
  commandLine: string[];         // Command line args from second instance
  workingDirectory: string;      // CWD of second instance
  action: 'focused' | 'shown' | 'restored';  // What we did in response
}
```

### Example

```typescript
const state: SingleInstanceState = {
  hasLock: true,
  lockAcquiredAt: 1234567890000000n,
  secondInstanceEvents: [
    {
      timestamp: 1234570000000000n,
      commandLine: ['/Applications/FDO.app/Contents/MacOS/FDO'],
      workingDirectory: '/Users/username',
      action: 'focused'
    }
  ]
};
```

---

## Data Flow

### Startup Sequence

```
┌─────────────────┐
│ Process Start   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐       ┌──────────────────┐
│ Single Instance │──No──→│ Quit Process     │
│ Lock Check      │       └──────────────────┘
└────────┬────────┘
         │ Yes
         ↓
┌─────────────────┐       ┌──────────────────┐
│ Log Metric:     │──────→│ Console + File   │
│ process-start   │       │ (async write)    │
└────────┬────────┘       └──────────────────┘
         │
         ↓
┌─────────────────┐
│ App Ready       │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Create Window   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Load Critical   │
│ Assets Only     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐       ┌──────────────────┐
│ Log Metric:     │──────→│ Console + File   │
│ app-interactive │       │ (Final metric)   │
└─────────────────┘       └──────────────────┘
```

---

## Schema Versioning

**Current Version**: 1.0  
**Change Policy**: Backward-compatible additions only. Breaking changes require new log file or migration.

**Version History**:
- 1.0 (2025-10-27): Initial schema definition

---

## Implementation Notes

### Performance Considerations

- Use `process.hrtime.bigint()` for microsecond precision
- Async file writes to avoid blocking startup
- Structured logs for easy parsing and analysis
- Minimize metadata to reduce log size

### Storage Considerations

- Log rotation handled manually by user
- No automatic cleanup (preserve historical data)
- NDJSON format enables streaming processing
- Typical file size: ~500 bytes per startup → 50KB for 100 startups

### Future Enhancements

- Aggregate statistics calculation utility
- Log analysis dashboard
- Anomaly detection (sudden regressions)
- Cross-version performance comparison

