# Validation API Contract

**Feature**: 003-fix-asar-node-modules  
**Component**: ASAR Asset Validation Script  
**Path**: `scripts/validate-asar-assets.js`

## Overview

This document defines the interface contract for the ASAR asset validation script that runs post-packaging to verify all webpack-copied assets are present in the final packaged application.

## Command Line Interface

### Synopsis

```bash
node scripts/validate-asar-assets.js --platform=<platform> [options]
```

### Required Arguments

| Argument | Type | Values | Description |
|----------|------|--------|-------------|
| `--platform` | string | `mac` \| `linux` \| `win` | Target platform to validate |

### Optional Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--verbose` | boolean | `false` | Enable detailed logging |
| `--asar-path` | string | (auto-detected) | Override ASAR archive path |
| `--webpack-config` | string | `webpack.renderer.config.js` | Override webpack config path |
| `--json` | boolean | `false` | Output results as JSON |

### Exit Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `0` | Success | All assets found in ASAR archive |
| `1` | Validation Failed | One or more assets missing from ASAR |
| `2` | Configuration Error | Invalid arguments, webpack config not found, ASAR not found, etc. |

---

## Input Contracts

### 1. Webpack Configuration

**Path**: `webpack.renderer.config.js` (or custom via `--webpack-config`)  
**Format**: CommonJS module exporting webpack configuration

**Required Structure**:
```javascript
module.exports = {
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: string, to: string, globOptions?: object },
        // ... more patterns
      ]
    })
  ]
}
```

**Contract**:
- Must be valid JavaScript loadable via `require()`
- Must export object or function returning object
- Must contain `plugins` array
- `plugins` must include at least one `CopyWebpackPlugin` instance
- CopyWebpackPlugin must have `patterns` property

**Behavior on Contract Violation**:
- Exit code `2`
- Error message: "Failed to parse webpack configuration: <reason>"

---

### 2. ASAR Archive

**Path**: Platform-specific (auto-detected or via `--asar-path`)

**Platform-Specific Paths**:
```javascript
{
  mac: 'release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar',
  linux: 'release/linux-unpacked/resources/app.asar',
  win: 'release/win-unpacked/resources/app.asar'
}
```

**Format**: Electron ASAR archive (readable via `@electron/asar`)

**Contract**:
- File must exist at specified path
- Must be valid ASAR archive (parseable by `@electron/asar.listPackage()`)
- Must contain `renderer/` directory

**Behavior on Contract Violation**:
- Exit code `2`
- Error message: "ASAR archive not found at: <path>" or "Invalid ASAR archive: <reason>"

---

## Output Contracts

### 1. Console Output (Human-Readable)

**Format**: Structured text with optional ANSI colors

#### Success Output

```text
✅ ASAR Asset Validation Passed

Platform: mac
ASAR Path: /Users/.../app.asar
Assets Found: 3/3

✓ renderer/assets/node_modules/@anikitenko/fdo-sdk
✓ renderer/assets/node_modules/@babel/standalone
✓ renderer/assets/node_modules/goober

Validation completed successfully.
```

#### Failure Output

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ ASAR Asset Validation Failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Missing Assets:
  ✗ renderer/assets/node_modules/@babel/standalone
  ✗ renderer/assets/node_modules/goober

Expected (from webpack.renderer.config.js):
  • node_modules/@anikitenko/fdo-sdk/dist/@types → assets/node_modules/@anikitenko/fdo-sdk
  • node_modules/@babel/standalone → assets/node_modules/@babel/standalone
  • node_modules/goober → assets/node_modules/goober

Actual (in app.asar):
  ✓ renderer/assets/node_modules/@anikitenko/fdo-sdk

Troubleshooting:
  1. Verify webpack build: check dist/renderer/assets/node_modules/
  2. Check electron-builder config: ensure assets not excluded
  3. Check package.json "files" patterns
  4. Run: npm run build && ls -la dist/renderer/assets/node_modules

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Contract** (FR-008 compliance):
- Must clearly identify missing asset paths
- Must show webpack patterns that generated expected paths
- Must include troubleshooting steps
- Must use visual indicators (✓, ✗) for clarity

---

### 2. JSON Output (Machine-Readable)

**Enabled**: `--json` flag

**Success Format**:
```json
{
  "valid": true,
  "platform": "mac",
  "asarPath": "/Users/.../app.asar",
  "timestamp": "2025-10-28T12:34:56.789Z",
  "expectedPaths": [
    "renderer/assets/node_modules/@anikitenko/fdo-sdk",
    "renderer/assets/node_modules/@babel/standalone",
    "renderer/assets/node_modules/goober"
  ],
  "foundPaths": [
    "renderer/assets/node_modules/@anikitenko/fdo-sdk/index.d.ts",
    "renderer/assets/node_modules/@anikitenko/fdo-sdk/types.d.ts",
    "renderer/assets/node_modules/@babel/standalone/babel.js",
    "renderer/assets/node_modules/@babel/standalone/package.json",
    "renderer/assets/node_modules/goober/index.js",
    "renderer/assets/node_modules/goober/package.json"
  ],
  "missingPaths": [],
  "expectedPatterns": [
    {
      "from": "/Users/.../node_modules/@anikitenko/fdo-sdk/dist/@types",
      "to": "assets/node_modules/@anikitenko/fdo-sdk"
    },
    {
      "from": "/Users/.../node_modules/@babel/standalone",
      "to": "assets/node_modules/@babel/standalone"
    },
    {
      "from": "/Users/.../node_modules/goober",
      "to": "assets/node_modules/goober"
    }
  ]
}
```

**Failure Format**:
```json
{
  "valid": false,
  "platform": "mac",
  "asarPath": "/Users/.../app.asar",
  "timestamp": "2025-10-28T12:34:56.789Z",
  "expectedPaths": [
    "renderer/assets/node_modules/@anikitenko/fdo-sdk",
    "renderer/assets/node_modules/@babel/standalone",
    "renderer/assets/node_modules/goober"
  ],
  "foundPaths": [
    "renderer/assets/node_modules/@anikitenko/fdo-sdk/index.d.ts",
    "renderer/assets/node_modules/@anikitenko/fdo-sdk/types.d.ts"
  ],
  "missingPaths": [
    "renderer/assets/node_modules/@babel/standalone",
    "renderer/assets/node_modules/goober"
  ],
  "expectedPatterns": [ /* same as above */ ],
  "error": "Validation failed: 2 asset packages missing from ASAR archive"
}
```

**Error Format**:
```json
{
  "valid": false,
  "error": "ASAR archive not found at: /Users/.../app.asar",
  "platform": "mac",
  "asarPath": "/Users/.../app.asar",
  "timestamp": "2025-10-28T12:34:56.789Z"
}
```

---

## Functional Contract

### Core Validation Logic

```typescript
/**
 * Validates that all webpack-copied assets are present in the ASAR archive
 * 
 * @param platform - Target platform (mac | linux | win)
 * @param options - Validation options
 * @returns Validation result with detailed comparison
 * @throws Error if configuration is invalid
 */
async function validateAsarAssets(
  platform: string,
  options?: {
    asarPath?: string;
    webpackConfigPath?: string;
    verbose?: boolean;
  }
): Promise<ValidationResult>

interface ValidationResult {
  valid: boolean;
  platform: string;
  asarPath: string;
  timestamp: string;
  expectedPaths: string[];
  foundPaths: string[];
  missingPaths: string[];
  expectedPatterns: WebpackCopyPattern[];
  error?: string;
}
```

### Processing Steps

1. **Parse Arguments**
   - Validate required `--platform` argument
   - Apply defaults for optional arguments
   - Exit code `2` if invalid arguments

2. **Load Webpack Configuration**
   - Require webpack config file
   - Extract CopyWebpackPlugin patterns
   - Transform patterns to expected ASAR paths
   - Exit code `2` if config not found or invalid

3. **Locate ASAR Archive**
   - Use platform-specific path or `--asar-path` override
   - Verify file exists
   - Exit code `2` if ASAR not found

4. **Read ASAR Contents**
   - Call `@electron/asar.listPackage(asarPath)`
   - Filter for paths starting with `renderer/assets/node_modules/`
   - Exit code `2` if ASAR read fails

5. **Compare Expected vs. Actual**
   - For each expected path, check if present in ASAR file list
   - Build list of missing paths
   - Build list of found paths

6. **Report Results**
   - If `--json`: Output JSON to stdout
   - Else: Output structured console messages
   - Exit code `0` if all assets found, `1` if any missing

---

## Integration Contract

### Build Process Integration

**Pre-condition**: electron-builder has completed packaging

**Invocation** (in package.json):
```json
{
  "scripts": {
    "dist:mac": "npm run build && electron-builder --mac && npm run validate:asar -- --platform=mac",
    "dist:linux": "npm run build && electron-builder --linux && npm run validate:asar -- --platform=linux",
    "dist:win": "npm run build && electron-builder --win && npm run validate:asar -- --platform=win",
    "validate:asar": "node scripts/validate-asar-assets.js"
  }
}
```

**Post-condition**: Build fails if validation returns exit code `1`

**Error Propagation**: npm/CI detects non-zero exit code and halts pipeline

---

## Automatic Synchronization Contract (FR-007)

**Requirement**: Validation logic stays synchronized with webpack configuration without manual updates

**Implementation**:
- Validation script reads `webpack.renderer.config.js` at runtime
- Extracts CopyWebpackPlugin patterns dynamically
- Computes expected paths from patterns
- No hardcoded asset list in validation script

**Test Case**:
1. Add new pattern to webpack: `{ from: 'node_modules/newlib', to: 'assets/node_modules/newlib' }`
2. Run validation without updating validation script
3. Expected: Validation checks for `renderer/assets/node_modules/newlib` automatically

**Contract Guarantee**: If webpack patterns change, validation expectations change automatically (no code changes needed)

---

## Error Message Contract (FR-008)

### Required Elements

Every validation failure message MUST include:

1. **Missing asset paths** - Specific paths not found in ASAR
2. **Expected patterns** - Webpack CopyWebpackPlugin patterns that defined those paths
3. **Troubleshooting steps** - Actionable steps to diagnose the issue

### Prohibited Elements

Validation messages MUST NOT:
- Use vague language ("some files missing")
- Omit context (must show both expected and actual)
- Provide only technical errors without guidance

---

## Performance Contract

| Operation | Maximum Time | Notes |
|-----------|--------------|-------|
| Parse webpack config | 500ms | Dynamic require + plugin extraction |
| Read ASAR file list | 2s | Depends on ASAR size (~100MB) |
| Compare paths | 100ms | Array operations, O(n*m) where n, m < 1000 |
| Generate report | 100ms | String formatting |
| **Total validation** | **5s** | Per SC-004 performance goal |

**Constraint**: Validation overhead must not exceed 5 seconds (SC-004)

---

## Dependencies

### Required npm Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@electron/asar` | `^3.2.0` | ASAR archive reading |
| `chalk` (optional) | `^5.3.0` | Colored console output |

### Node.js Built-ins

- `fs` - File system operations
- `path` - Path manipulation
- `process` - Exit codes, arguments

---

## Testing Contract

### Test Scenarios

1. **Happy Path**: All assets present → Exit 0
2. **Missing Asset**: One asset missing → Exit 1 with clear error
3. **Invalid Platform**: Unknown platform → Exit 2 with error
4. **ASAR Not Found**: File doesn't exist → Exit 2 with error
5. **Webpack Config Error**: Config file invalid → Exit 2 with error
6. **Automatic Sync**: Add webpack pattern → Validation checks new asset

### Acceptance Criteria

- All exit codes must match documented values
- Error messages must include all FR-008 required elements
- JSON output must be valid and parseable
- Validation must complete within 5 seconds (SC-004)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-10-28 | Initial contract definition |

---

## Summary

This contract ensures:
- **Clear interface** for CLI invocation with documented arguments and exit codes
- **Structured output** satisfying FR-008 requirements for error messaging
- **Automatic synchronization** by parsing webpack config at runtime (FR-007)
- **Deterministic behavior** through explicit input/output contracts
- **Integration compliance** with npm build scripts and CI/CD pipelines
- **Performance guarantee** under 5 seconds (SC-004)

All aspects align with functional requirements FR-006 through FR-009 and success criteria SC-003, SC-006.

