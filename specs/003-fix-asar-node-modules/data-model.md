# Data Model: Fix Missing Asset Node Modules

**Date**: 2025-10-28  
**Feature**: 003-fix-asar-node-modules

## Overview

This document defines the data structures, configuration formats, and file system entities involved in ensuring asset dependencies are correctly packaged in the ASAR archive.

## Configuration Entities

### 1. Webpack Copy Pattern

**Source**: `webpack.renderer.config.js`  
**Description**: CopyWebpackPlugin pattern defining which node_modules to copy to assets directory

**Structure**:
```typescript
interface WebpackCopyPattern {
  from: string;           // Source path (absolute or relative)
  to: string;             // Destination path relative to output directory
  globOptions?: {         // Optional glob configuration
    ignore?: string[];    // Patterns to exclude
    dot?: boolean;        // Include dotfiles
  };
  noErrorOnMissing?: boolean; // Don't fail if source missing
}
```

**Current Values** (from webpack.renderer.config.js):
```javascript
[
  {
    from: path.resolve(__dirname, "node_modules/@anikitenko/fdo-sdk/dist/@types"),
    to: "assets/node_modules/@anikitenko/fdo-sdk"
  },
  {
    from: path.resolve(__dirname, "node_modules/@babel/standalone"),
    to: "assets/node_modules/@babel/standalone"
  },
  {
    from: path.resolve(__dirname, "node_modules/goober"),
    to: "assets/node_modules/goober",
    globOptions: {
      ignore: ["**/__tests__/**", "**/*.test.js", "**/*.spec.js"]
    }
  }
]
```

**Validation Rules**:
- `from` must be absolute path or resolvable relative path
- `to` must be relative path within `dist/renderer/`
- Pattern must resolve to at least one file

---

### 2. Electron-builder Files Pattern

**Source**: `package.json` (or `electron-builder.yml`)  
**Description**: Pattern defining which files to include in the packaged application

**Structure**:
```typescript
interface ElectronBuilderConfig {
  files?: string[];       // Include patterns
  asar?: boolean;         // Enable ASAR packaging (default: true)
  asarUnpack?: string[];  // Patterns to unpack from ASAR
  extraFiles?: Array<{    // Additional files outside ASAR
    from: string;
    to: string;
  }>;
}
```

**Required Addition**:
```json
{
  "build": {
    "files": [
      "dist/**/*",
      "dist/renderer/assets/node_modules/**/*",
      "!**/node_modules/**",
      "!dist/renderer/assets/node_modules"
    ]
  }
}
```

**Pattern Precedence**: Later patterns override earlier ones (negation patterns must come after inclusion)

**Validation Rules**:
- Must explicitly include `dist/renderer/assets/node_modules/**/*`
- Negation pattern `!**/node_modules/**` must not exclude assets
- `asar: true` must be set (default)

---

### 3. Validation Configuration

**Source**: `scripts/validate-asar-assets.js` (runtime)  
**Description**: Configuration for the validation script execution

**Structure**:
```typescript
interface ValidationConfig {
  platform: 'mac' | 'linux' | 'win';           // Target platform
  asarPath?: string;                            // Override ASAR path
  webpackConfigPath?: string;                   // Override webpack config path
  verbose?: boolean;                            // Detailed logging
}

interface ValidationResult {
  valid: boolean;                               // Overall validation status
  platform: string;                             // Platform validated
  asarPath: string;                             // Path to validated ASAR
  expectedPaths: string[];                      // Paths expected from webpack
  foundPaths: string[];                         // Paths found in ASAR
  missingPaths: string[];                       // Paths missing from ASAR
  expectedPatterns: WebpackCopyPattern[];       // Original webpack patterns
  timestamp: string;                            // Validation time (ISO 8601)
}
```

**CLI Arguments**:
```bash
node scripts/validate-asar-assets.js --platform=mac [--verbose] [--asar-path=/custom/path]
```

**Exit Codes**:
- `0`: Validation passed
- `1`: Validation failed (missing assets)
- `2`: Configuration error (webpack config not found, invalid platform, etc.)

---

## File System Entities

### 1. Assets Directory (Webpack Output)

**Path**: `dist/renderer/assets/node_modules/`  
**Created by**: Webpack CopyWebpackPlugin  
**Lifecycle**: Created during `npm run build`, consumed by electron-builder

**Structure**:
```text
dist/renderer/assets/node_modules/
├── @anikitenko/
│   └── fdo-sdk/
│       ├── index.d.ts
│       ├── types.d.ts
│       └── [other .d.ts files]
├── @babel/
│   └── standalone/
│       ├── babel.js
│       ├── babel.min.js
│       └── package.json
└── goober/
    ├── index.js
    ├── prefixer/
    ├── should-forward-prop/
    └── package.json
```

**Validation**:
- Directory must exist after webpack build
- Must contain all three packages
- Total size: ~5-15MB

---

### 2. ASAR Archive (Packaged Application)

**Path** (platform-specific):
- macOS: `release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar`
- Linux: `release/linux-unpacked/resources/app.asar`
- Windows: `release/win-unpacked/resources/app.asar`

**Created by**: electron-builder  
**Format**: ASAR (Electron Archive)

**Required Contents**:
```text
app.asar (internal structure)
└── renderer/
    └── assets/
        └── node_modules/
            ├── @anikitenko/fdo-sdk/
            ├── @babel/standalone/
            └── goober/
```

**Access Pattern** (at runtime):
```javascript
// Electron automatically resolves ASAR paths
const asarPath = 'asar:///renderer/assets/node_modules/@babel/standalone/babel.js';
// Or relative from renderer
const relativePath = './assets/node_modules/@babel/standalone/babel.js';
```

**Validation**:
- ASAR must exist at platform-specific path
- `renderer/assets/node_modules/` must be present in ASAR file list
- All three packages must have files in ASAR

---

### 3. Validation Script

**Path**: `scripts/validate-asar-assets.js`  
**Purpose**: Post-packaging verification that assets are correctly included in ASAR

**Inputs**:
1. `webpack.renderer.config.js` - Source of truth for expected assets
2. `app.asar` (platform-specific path) - Target for validation
3. CLI arguments (platform, options)

**Outputs**:
1. Console output (structured error/success messages)
2. Exit code (0 = pass, 1 = fail, 2 = error)
3. Optional: JSON report for CI integration

**Data Flow**:
```text
webpack.renderer.config.js
          ↓
    [Parse CopyWebpackPlugin patterns]
          ↓
    expectedPaths[] = ["renderer/assets/node_modules/@anikitenko/fdo-sdk", ...]
          ↓
    [Read ASAR file list via @electron/asar]
          ↓
    foundPaths[] = [actual files in ASAR]
          ↓
    [Compare arrays]
          ↓
    missingPaths[] = expectedPaths - foundPaths
          ↓
    [Report results and exit]
```

---

## State Transitions

### Build Process State Machine

```text
[Webpack Build]
      ↓
  dist/renderer/assets/node_modules created
      ↓
[Electron-builder Package]
      ↓
  app.asar created at platform-specific path
      ↓
[Validation Script]
      ↓
  ┌─────────────┬─────────────┐
  │ Assets      │ Assets      │
  │ Found       │ Missing     │
  └─────────────┴─────────────┘
        ↓               ↓
   Exit 0          Exit 1
   (Success)       (Failure - Build Fails)
```

### Validation States

```typescript
enum ValidationState {
  PENDING = 'pending',           // Validation not started
  READING_WEBPACK = 'reading_webpack',   // Parsing webpack config
  READING_ASAR = 'reading_asar',         // Reading ASAR file list
  COMPARING = 'comparing',                // Comparing expected vs actual
  PASSED = 'passed',                      // All assets found
  FAILED = 'failed',                      // Assets missing
  ERROR = 'error'                         // Configuration or runtime error
}
```

---

## Relationships

```text
webpack.renderer.config.js (CopyWebpackPlugin)
            │
            │ defines
            ↓
    [Expected Asset Paths]
            │
            │ validated against
            ↓
    app.asar (actual contents)
            │
            │ accessed via
            ↓
    @electron/asar.listPackage()
            │
            │ produces
            ↓
    [Validation Result]
            │
            ├─ valid: true → Exit 0
            └─ valid: false → Exit 1 (Build Fails)
```

---

## Data Constraints

### Asset Packages

**Constraint**: Exactly 3 packages must be present

| Package | Path in ASAR | Min Size | Max Size | Required Files |
|---------|--------------|----------|----------|----------------|
| @anikitenko/fdo-sdk | `renderer/assets/node_modules/@anikitenko/fdo-sdk/` | 50KB | 500KB | `*.d.ts` files |
| @babel/standalone | `renderer/assets/node_modules/@babel/standalone/` | 2MB | 5MB | `babel.js`, `babel.min.js` |
| goober | `renderer/assets/node_modules/goober/` | 20KB | 200KB | `index.js`, subdirs |

**Total Size Constraint**: 5-15MB (per SC-005)

### Platform Paths

**Constraint**: ASAR path must match platform-specific structure

| Platform | ASAR Path Template | Validated |
|----------|-------------------|-----------|
| macOS (arm64) | `release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar` | ✓ |
| macOS (x64) | `release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar` | ✓ |
| Linux | `release/linux-unpacked/resources/app.asar` | ✓ |
| Windows | `release/win-unpacked/resources/app.asar` | ✓ |

**Fallback**: If platform-specific path not found, search common locations and report

---

## Summary

This data model ensures:
1. **Webpack configuration** defines source of truth for expected assets
2. **Electron-builder** preserves webpack output in ASAR archive
3. **Validation script** programmatically verifies ASAR contents match expectations
4. **Build process** fails immediately if validation detects discrepancies
5. **Automatic synchronization** via parsing webpack config at validation time (no manual maintenance)

All constraints align with functional requirements (FR-001 through FR-009) and success criteria (SC-001 through SC-006).

