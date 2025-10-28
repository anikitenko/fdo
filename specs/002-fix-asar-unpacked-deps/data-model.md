# Data Model: Fix Unwanted Dependencies in Packaged Application

**Date**: October 28, 2025  
**Feature**: 002-fix-asar-unpacked-deps  
**Purpose**: Define configuration schema and data structures for build and validation

---

## Overview

This document defines the data structures, configuration schemas, and relationships involved in controlling which packages are included in the packaged Electron application's unpacked resources directory.

---

## Entity: Build Configuration

### webpack.main.config.js

**Purpose**: Controls webpack bundling behavior for the main Electron process.

**Schema**:
```javascript
{
  // Entry point for main process
  entry: string,
  
  // Electron-main target ensures Node.js modules available
  target: 'electron-main',
  
  // Output configuration
  output: {
    path: string,      // Absolute path to output directory
    filename: string   // Output bundle filename
  },
  
  // External packages (not bundled by webpack)
  externals: {
    [packageName: string]: string  // e.g., "commonjs esbuild"
  },
  
  // Plugins array
  plugins: [
    CopyWebpackPlugin({
      patterns: [
        {
          from: string,  // Source path in node_modules
          to: string     // Destination path in dist/
        }
      ]
    })
  ]
}
```

**Current State**:
```javascript
externals: {
  esbuild: "commonjs esbuild"
}

plugins: [
  new CopyWebpackPlugin({
    patterns: [
      { from: "node_modules/esbuild", to: "node_modules/esbuild" },
      { from: "node_modules/@esbuild", to: "node_modules/@esbuild" },
      { from: "node_modules/@anikitenko/fdo-sdk", to: "node_modules/@anikitenko/fdo-sdk" }
    ]
  })
]
```

**Proposed Changes**:
```javascript
externals: {
  esbuild: "commonjs esbuild",
  "@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk"
}

// CopyWebpackPlugin patterns remain unchanged
```

**Validation Rules**:
- Each external package MUST have corresponding CopyWebpackPlugin pattern
- CopyWebpackPlugin patterns MUST copy to `node_modules/[package]` to maintain structure
- Package paths MUST be relative to project root

---

### package.json (electron-builder configuration)

**Purpose**: Controls how electron-builder packages the application and what gets unpacked from ASAR.

**Schema**:
```json
{
  "build": {
    "appId": string,
    "productName": string,
    "asar": boolean,
    "asarUnpack": string[],  // Glob patterns for files to unpack from ASAR
    "files": string[],       // Files to include in app package
    "directories": {
      "output": string,
      "buildResources": string
    },
    "mac": { /* platform config */ },
    "win": { /* platform config */ },
    "linux": { /* platform config */ },
    "afterPack": string      // Path to post-packaging hook script
  }
}
```

**Current State**:
```json
"asarUnpack": [
  "dist/main/node_modules/**/*"
]
```

**Proposed Changes**:
```json
"asarUnpack": [
  "dist/main/node_modules/esbuild/**/*",
  "dist/main/node_modules/@esbuild/**/*",
  "dist/main/node_modules/@anikitenko/**/*"
],
"afterPack": "./scripts/validate-package.js"
```

**Validation Rules**:
- asarUnpack patterns MUST match packages copied by CopyWebpackPlugin
- asarUnpack patterns MUST be specific (no wildcards that match unexpected packages)
- afterPack script MUST exist at specified path
- afterPack script MUST be executable (chmod +x on Unix)

---

## Entity: Package Validation Rules

**Purpose**: Defines expected packages and validation logic for post-packaging verification.

**Schema**:
```typescript
interface ValidationRules {
  expectedPackages: Set<string>;      // Top-level package names
  strictMode: boolean;                // Fail on unexpected packages
  allowMissing: boolean;              // Allow missing packages (warning only)
  platformSpecific: {
    [platform: string]: {
      expectedSubPackages?: string[]; // e.g., @esbuild/darwin-arm64
    }
  }
}
```

**Implementation**:
```javascript
const EXPECTED_PACKAGES = new Set([
  "esbuild",
  "@esbuild",
  "@anikitenko"
]);

const VALIDATION_RULES = {
  expectedPackages: EXPECTED_PACKAGES,
  strictMode: true,           // Fail build on unexpected packages
  allowMissing: false,        // Fail build on missing packages
  platformSpecific: {
    mac: {
      expectedSubPackages: ["darwin-arm64", "darwin-x64"]  // in @esbuild/
    },
    win: {
      expectedSubPackages: ["win32-x64"]
    },
    linux: {
      expectedSubPackages: ["linux-x64"]
    }
  }
};
```

**Validation Rules**:
- expectedPackages MUST match packages in asarUnpack configuration
- strictMode MUST be true to prevent regression
- Platform-specific validation MUST check only installed platform binaries

---

## Entity: Validation Result

**Purpose**: Represents the outcome of post-packaging validation.

**Schema**:
```typescript
interface ValidationResult {
  success: boolean;
  platform: 'mac' | 'win' | 'linux';
  unpackedPath: string;
  expectedPackages: string[];
  actualPackages: string[];
  missing: string[];
  unexpected: string[];
  errors: string[];
  warnings: string[];
  timestamp: string;
}
```

**Example (Success)**:
```json
{
  "success": true,
  "platform": "mac",
  "unpackedPath": "/path/to/release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules",
  "expectedPackages": ["esbuild", "@esbuild", "@anikitenko"],
  "actualPackages": ["esbuild", "@esbuild", "@anikitenko"],
  "missing": [],
  "unexpected": [],
  "errors": [],
  "warnings": [],
  "timestamp": "2025-10-28T12:00:00.000Z"
}
```

**Example (Failure)**:
```json
{
  "success": false,
  "platform": "mac",
  "unpackedPath": "/path/to/release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules",
  "expectedPackages": ["esbuild", "@esbuild", "@anikitenko"],
  "actualPackages": ["esbuild", "@esbuild", "@anikitenko", "electron", "fsevents"],
  "missing": [],
  "unexpected": ["electron", "fsevents"],
  "errors": [
    "Unexpected packages found in unpacked resources: electron, fsevents"
  ],
  "warnings": [],
  "timestamp": "2025-10-28T12:00:00.000Z"
}
```

**Validation Rules**:
- success MUST be false if unexpected.length > 0 or missing.length > 0
- errors array MUST contain detailed message with actual vs expected
- timestamp MUST be ISO 8601 format

---

## Entity: Packaged Application Structure

**Purpose**: Represents the file system structure of the packaged application.

**Schema**:
```
Platform: macOS
└── release/mac/
    └── FDO (FlexDevOPs).app/
        └── Contents/
            ├── MacOS/
            │   └── FDO (FlexDevOPs)         # Executable
            ├── Resources/
            │   ├── app.asar                  # Main application code (ASAR archive)
            │   └── app.asar.unpacked/        # Unpacked native modules
            │       └── node_modules/
            │           ├── esbuild/          # ✅ Expected
            │           ├── @esbuild/         # ✅ Expected
            │           │   └── darwin-arm64/ # Platform-specific binary
            │           └── @anikitenko/      # ✅ Expected
            │               └── fdo-sdk/
            └── Info.plist

Platform: Windows
└── release/win-unpacked/
    ├── FDO (FlexDevOPs).exe              # Executable
    └── resources/
        ├── app.asar                       # Main application code
        └── app.asar.unpacked/             # Unpacked native modules
            └── node_modules/
                ├── esbuild/               # ✅ Expected
                ├── @esbuild/              # ✅ Expected
                │   └── win32-x64/         # Platform-specific binary
                └── @anikitenko/           # ✅ Expected
                    └── fdo-sdk/

Platform: Linux
└── release/linux-unpacked/
    ├── fdo-flexdevops                     # Executable
    └── resources/
        ├── app.asar                       # Main application code
        └── app.asar.unpacked/             # Unpacked native modules
            └── node_modules/
                ├── esbuild/               # ✅ Expected
                ├── @esbuild/              # ✅ Expected
                │   └── linux-x64/         # Platform-specific binary
                └── @anikitenko/           # ✅ Expected
                    └── fdo-sdk/
```

**Key Paths**:
```javascript
const UNPACKED_PATHS = {
  mac: "Contents/Resources/app.asar.unpacked/node_modules",
  win: "resources/app.asar.unpacked/node_modules",
  linux: "resources/app.asar.unpacked/node_modules"
};
```

**Validation Rules**:
- app.asar MUST exist
- app.asar.unpacked/node_modules MUST exist if asarUnpack patterns match any files
- node_modules directory MUST contain only expected packages
- Each package directory MUST contain valid package.json

---

## Relationships

```
┌─────────────────────────────┐
│  webpack.main.config.js     │
│  - externals                │
│  - CopyWebpackPlugin        │
└──────────┬──────────────────┘
           │ copies to
           ↓
┌─────────────────────────────┐
│  dist/main/node_modules/    │
│  - esbuild/                 │
│  - @esbuild/                │
│  - @anikitenko/fdo-sdk/     │
└──────────┬──────────────────┘
           │ packaged by
           ↓
┌─────────────────────────────┐
│  electron-builder           │
│  - files config             │
│  - asarUnpack config        │
└──────────┬──────────────────┘
           │ creates
           ↓
┌─────────────────────────────┐
│  app.asar + unpacked/       │
│  (packaged application)     │
└──────────┬──────────────────┘
           │ validated by
           ↓
┌─────────────────────────────┐
│  afterPack hook             │
│  (validate-package.js)      │
└──────────┬──────────────────┘
           │ produces
           ↓
┌─────────────────────────────┐
│  ValidationResult           │
│  - success: boolean         │
│  - unexpected: string[]     │
│  - errors: string[]         │
└─────────────────────────────┘
```

---

## State Transitions

### Build Process States

```
1. [Clean] → npm run build
   ↓
2. [Building] → webpack compiles + CopyWebpackPlugin copies
   ↓
3. [Built] → dist/ directory populated
   ↓
4. [Packaging] → electron-builder creates ASAR + unpacked
   ↓
5. [Packaged] → app.asar.unpacked/ created
   ↓
6. [Validating] → afterPack hook runs
   ↓
7. [Validated] → success/failure determined
   ↓
8a. [Success] → Build completes, artifacts in release/
8b. [Failed] → Build aborted, error logged
```

### Validation States

```
┌─────────────┐
│   Pending   │
└──────┬──────┘
       │ Check if unpacked path exists
       ↓
  ┌─────────┐
  │ Exists? │
  └────┬────┘
       │ yes          no
       ↓              ↓
┌──────────────┐  ┌────────┐
│   Scanning   │  │ Failed │
└──────┬───────┘  └────────┘
       │ List packages
       ↓
┌──────────────┐
│  Comparing   │
└──────┬───────┘
       │ Compare actual vs expected
       ↓
  ┌─────────┐
  │ Match?  │
  └────┬────┘
       │ yes          no
       ↓              ↓
┌──────────┐    ┌────────┐
│ Success  │    │ Failed │
└──────────┘    └────────┘
```

---

## Data Constraints

### Package Name Constraints
- MUST follow npm package naming rules
- Scoped packages (e.g., @esbuild) MUST include @
- Names MUST match exactly (case-sensitive)

### Path Constraints
- All paths MUST use forward slashes (/) for cross-platform compatibility
- Paths in asarUnpack MUST be relative to dist/ output directory
- Paths in CopyWebpackPlugin MUST be relative to project root

### Glob Pattern Constraints
- `**/*` matches all files recursively
- Specific package paths preferred over wildcards
- Patterns MUST NOT match unintended packages

---

## Performance Considerations

### Build Time Impact
- CopyWebpackPlugin: ~50ms per package (minimal)
- Validation script: <100ms (filesystem scan + comparison)
- Total overhead: <10% of build time (well within SC-004 requirement)

### Package Size Impact
- Removing unwanted packages: -50 to -100MB (SC-002 requirement)
- Three required packages: ~30-50MB total
- Net improvement: Significant size reduction

---

## Security Considerations

### Package Integrity
- Packages copied from node_modules MUST be from npm install
- No modifications to package contents during copy
- Validation verifies package.json exists in each package

### Validation Security
- Validation script runs as part of build process
- No external dependencies in validation script
- Uses only Node.js built-in modules (fs, path)

---

## Versioning

### Configuration Version
- webpack config: No version field (tracked via git)
- package.json build config: App version applies
- Validation rules: Embedded in script (track via git)

### Package Versions
- esbuild: 0.25.8 (from package.json dependencies)
- @esbuild/*: Matches esbuild version
- @anikitenko/fdo-sdk: 1.0.18 (from package.json dependencies)

**Maintenance**: When updating these packages, validation rules do NOT need to change (package names stay the same).

---

## Migration Path

### From Current State to Fixed State

1. **Backup current configuration**:
   - Save webpack.main.config.js
   - Save package.json build section

2. **Update webpack.main.config.js**:
   - Add @anikitenko/fdo-sdk to externals

3. **Update package.json**:
   - Replace asarUnpack wildcard with specific patterns
   - Add afterPack hook

4. **Create validation script**:
   - Add scripts/validate-package.js
   - Make executable (chmod +x)

5. **Test locally**:
   - Clean build: rm -rf dist/ release/
   - Build: npm run build
   - Package: npm run dist:mac (or platform)
   - Verify: Check release/ output

6. **Commit changes**:
   - Git commit with descriptive message
   - Push to feature branch

---

## Monitoring & Observability

### Build Logs
```
[Validation] Checking packaged dependencies for mac...
[Validation] Expected packages: esbuild, @esbuild, @anikitenko
[Validation] Actual packages: esbuild, @esbuild, @anikitenko
[Validation] ✅ Package validation passed!
```

### Error Logs
```
[Validation] Checking packaged dependencies for mac...
[Validation] Expected packages: esbuild, @esbuild, @anikitenko
[Validation] Actual packages: esbuild, @esbuild, @anikitenko, electron, fsevents

Error: Unexpected packages found in unpacked resources:
  Unexpected: electron, fsevents
  Expected: esbuild, @esbuild, @anikitenko
  Actual: esbuild, @esbuild, @anikitenko, electron, fsevents

These packages should not be in app.asar.unpacked. 
Check webpack externals and electron-builder asarUnpack configuration.
```

---

## Future Enhancements

### Potential Additions
1. **Package size tracking**: Log size of each package for monitoring
2. **Historical comparison**: Compare against previous builds
3. **JSON output**: Generate validation-result.json for CI/CD
4. **Platform-specific validation**: Verify correct @esbuild subpackage
5. **Checksum validation**: Verify package integrity with checksums

### Not Planned
- Dynamic package lists (keep hardcoded for predictability)
- Configuration file for validation rules (YAGNI)
- Complex dependency tree analysis (out of scope)

---

**Data Model Status**: ✅ COMPLETE  
**Next Steps**: Create contracts/validation-api.md

