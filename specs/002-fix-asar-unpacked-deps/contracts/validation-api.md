# API Contract: Package Validation

**Date**: October 28, 2025  
**Feature**: 002-fix-asar-unpacked-deps  
**Purpose**: Define the interface for post-packaging validation script

---

## Overview

This document defines the API contract for the `validate-package.js` script that runs as an electron-builder afterPack hook to verify that only expected packages are present in the unpacked resources directory.

---

## Script Interface

### Module Export

**Type**: electron-builder afterPack hook function  
**Path**: `scripts/validate-package.js`  
**Export**: Default export (CommonJS module.exports)

**Signature**:
```typescript
type AfterPackHook = (context: AfterPackContext) => Promise<void>;

module.exports = AfterPackHook;
```

---

## Input: AfterPackContext

**Type**: Object provided by electron-builder  
**Source**: electron-builder internal

**Schema**:
```typescript
interface AfterPackContext {
  // Output directory where packaged app is located
  appOutDir: string;
  
  // electron-builder packager instance
  packager: {
    appInfo: {
      productName: string;
      version: string;
    };
    platform: {
      name: 'mac' | 'win' | 'linux';
      nodeName: 'darwin' | 'win32' | 'linux';
    };
  };
  
  // Electron architecture (x64, arm64, etc.)
  arch: number;
  
  // Targets being built
  targets: Array<any>;
}
```

**Example Values**:
```javascript
// macOS build
{
  appOutDir: "/Users/dev/fdo/release/mac",
  packager: {
    appInfo: {
      productName: "FDO (FlexDevOPs)",
      version: "1.0.0"
    },
    platform: {
      name: "mac",
      nodeName: "darwin"
    }
  },
  arch: 1,  // arm64
  targets: [/* ... */]
}

// Windows build
{
  appOutDir: "C:\\Users\\dev\\fdo\\release\\win-unpacked",
  packager: {
    appInfo: {
      productName: "FDO (FlexDevOPs)",
      version: "1.0.0"
    },
    platform: {
      name: "win",
      nodeName: "win32"
    }
  },
  arch: 0,  // x64
  targets: [/* ... */]
}
```

**Validation**:
- `appOutDir` MUST be an absolute path that exists
- `packager.platform.name` MUST be one of: 'mac', 'win', 'linux'
- Context MUST be provided by electron-builder (not called directly)

---

## Output: Success Case

**Behavior**: Function resolves (returns Promise<void>)  
**Side Effects**: Console logs validation success  
**Exit Code**: Not applicable (electron-builder continues)

**Console Output**:
```
[Validation] Checking packaged dependencies for mac...
[Validation] Expected packages: esbuild, @esbuild, @anikitenko
[Validation] Actual packages: esbuild, @esbuild, @anikitenko
[Validation] ✅ Package validation passed!
```

**Requirements**:
- MUST log platform being validated
- MUST log expected packages list
- MUST log actual packages found
- MUST log success indicator (✅)

---

## Output: Failure Case

**Behavior**: Function throws Error  
**Side Effects**: Console logs error details, electron-builder aborts build  
**Exit Code**: Non-zero (set by electron-builder)

**Error Schema**:
```typescript
interface ValidationError extends Error {
  name: "Error";
  message: string;  // Multi-line with details
  stack?: string;   // Stack trace
}
```

**Error Message Format**:
```
Unexpected packages found in unpacked resources:
  Unexpected: {comma-separated list}
  Expected: {comma-separated list}
  Actual: {comma-separated list}

These packages should not be in app.asar.unpacked. 
Check webpack externals and electron-builder asarUnpack configuration.
```

**Console Output Before Error**:
```
[Validation] Checking packaged dependencies for mac...
[Validation] Expected packages: esbuild, @esbuild, @anikitenko
[Validation] Actual packages: esbuild, @esbuild, @anikitenko, electron, fsevents
```

**Requirements**:
- Error message MUST include actual vs expected comparison
- Error message MUST identify specific unexpected packages
- Error message MUST provide remediation hint
- MUST throw (not return) to fail the build

---

## API Functions

### Main Export: afterPackHook

**Function**: Main entry point called by electron-builder

**Signature**:
```typescript
async function afterPackHook(context: AfterPackContext): Promise<void>
```

**Behavior**:
1. Extract platform from context
2. Determine unpacked node_modules path for platform
3. Verify path exists
4. List packages in directory
5. Compare against expected packages
6. Log results
7. Throw error if validation fails
8. Return successfully if validation passes

**Error Cases**:
- Unpacked node_modules path doesn't exist → throw Error
- Missing required packages → throw Error
- Unexpected packages found → throw Error
- filesystem read errors → throw Error

---

### Internal Function: getUnpackedPath

**Purpose**: Determine platform-specific path to unpacked node_modules

**Signature**:
```typescript
function getUnpackedPath(
  appOutDir: string,
  platform: 'mac' | 'win' | 'linux'
): string
```

**Implementation**:
```javascript
function getUnpackedPath(appOutDir, platform) {
  const path = require("path");
  
  if (platform === "mac") {
    return path.join(
      appOutDir,
      "FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules"
    );
  } else if (platform === "win") {
    return path.join(
      appOutDir,
      "resources/app.asar.unpacked/node_modules"
    );
  } else if (platform === "linux") {
    return path.join(
      appOutDir,
      "resources/app.asar.unpacked/node_modules"
    );
  }
  
  throw new Error(`Unknown platform: ${platform}`);
}
```

**Return Value**: Absolute path to unpacked node_modules directory  
**Throws**: Error if platform is unrecognized

**Test Cases**:
```javascript
// macOS
getUnpackedPath("/path/to/release/mac", "mac")
// => "/path/to/release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules"

// Windows
getUnpackedPath("C:\\path\\to\\release\\win-unpacked", "win")
// => "C:\\path\\to\\release\\win-unpacked\\resources\\app.asar.unpacked\\node_modules"

// Linux
getUnpackedPath("/path/to/release/linux-unpacked", "linux")
// => "/path/to/release/linux-unpacked/resources/app.asar.unpacked/node_modules"

// Unknown platform
getUnpackedPath("/path", "ios")
// => throws Error("Unknown platform: ios")
```

---

### Internal Function: listPackages

**Purpose**: List top-level directories in node_modules (package names)

**Signature**:
```typescript
function listPackages(nodeModulesPath: string): string[]
```

**Implementation**:
```javascript
function listPackages(nodeModulesPath) {
  const fs = require("fs");
  
  if (!fs.existsSync(nodeModulesPath)) {
    throw new Error(`Directory not found: ${nodeModulesPath}`);
  }
  
  const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}
```

**Return Value**: Array of package names (directory names)  
**Throws**: Error if path doesn't exist or read fails

**Test Cases**:
```javascript
// Normal case
listPackages("/path/to/node_modules")
// => ["esbuild", "@esbuild", "@anikitenko"]

// Empty directory
listPackages("/path/to/empty")
// => []

// Directory doesn't exist
listPackages("/path/to/nonexistent")
// => throws Error

// Directory with files and folders
listPackages("/path/with/mixed")
// => Only returns folder names, ignores files
```

**Edge Cases**:
- Hidden directories (starting with .) SHOULD be excluded
- Files in node_modules (e.g., .package-lock.json) MUST be ignored
- Symlinks MAY be treated as directories (platform-dependent)

---

### Internal Function: comparePackages

**Purpose**: Compare actual packages against expected, identify discrepancies

**Signature**:
```typescript
interface ComparisonResult {
  missing: string[];     // Expected but not found
  unexpected: string[];  // Found but not expected
}

function comparePackages(
  actual: string[],
  expected: Set<string>
): ComparisonResult
```

**Implementation**:
```javascript
function comparePackages(actual, expected) {
  const missing = Array.from(expected).filter(
    pkg => !actual.includes(pkg)
  );
  
  const unexpected = actual.filter(
    pkg => !expected.has(pkg)
  );
  
  return { missing, unexpected };
}
```

**Return Value**: Object with missing and unexpected arrays

**Test Cases**:
```javascript
// Perfect match
comparePackages(
  ["esbuild", "@esbuild", "@anikitenko"],
  new Set(["esbuild", "@esbuild", "@anikitenko"])
)
// => { missing: [], unexpected: [] }

// Unexpected packages
comparePackages(
  ["esbuild", "@esbuild", "@anikitenko", "electron", "fsevents"],
  new Set(["esbuild", "@esbuild", "@anikitenko"])
)
// => { missing: [], unexpected: ["electron", "fsevents"] }

// Missing packages
comparePackages(
  ["esbuild", "@esbuild"],
  new Set(["esbuild", "@esbuild", "@anikitenko"])
)
// => { missing: ["@anikitenko"], unexpected: [] }

// Both missing and unexpected
comparePackages(
  ["esbuild", "electron"],
  new Set(["esbuild", "@esbuild", "@anikitenko"])
)
// => { missing: ["@esbuild", "@anikitenko"], unexpected: ["electron"] }

// Empty actual
comparePackages(
  [],
  new Set(["esbuild", "@esbuild", "@anikitenko"])
)
// => { missing: ["esbuild", "@esbuild", "@anikitenko"], unexpected: [] }
```

---

## Configuration Constants

### EXPECTED_PACKAGES

**Type**: Set<string>  
**Purpose**: Define which packages should be in unpacked resources

**Value**:
```javascript
const EXPECTED_PACKAGES = new Set([
  "esbuild",
  "@esbuild",
  "@anikitenko"
]);
```

**Maintenance**:
- MUST be updated if required packages change
- SHOULD match asarUnpack patterns in package.json
- Package names MUST be top-level directory names (not full scoped names)

**Rationale**:
- "@anikitenko" instead of "@anikitenko/fdo-sdk" because filesystem has:
  ```
  node_modules/
  └── @anikitenko/
      └── fdo-sdk/
  ```
  The top-level directory is "@anikitenko"

---

## Error Codes & Messages

### Error 1: Directory Not Found

**Condition**: Unpacked node_modules directory doesn't exist  
**Message**:
```
Unpacked node_modules directory not found: {path}
```

**Cause**: electron-builder didn't create unpacked directory (configuration error)  
**Resolution**: Check asarUnpack patterns in package.json

---

### Error 2: Missing Required Packages

**Condition**: Expected packages not found in unpacked directory  
**Message**:
```
Missing required packages in unpacked resources:
  Missing: {comma-separated list}
  Expected: {comma-separated list}
  Actual: {comma-separated list}
```

**Cause**: 
- CopyWebpackPlugin didn't copy package
- asarUnpack pattern didn't match package
- Package not installed (npm install issue)

**Resolution**: 
- Verify CopyWebpackPlugin patterns in webpack.main.config.js
- Verify asarUnpack patterns in package.json
- Run npm install to ensure packages present

---

### Error 3: Unexpected Packages Found

**Condition**: Packages found that weren't expected  
**Message**:
```
Unexpected packages found in unpacked resources:
  Unexpected: {comma-separated list}
  Expected: {comma-separated list}
  Actual: {comma-separated list}

These packages should not be in app.asar.unpacked. 
Check webpack externals and electron-builder asarUnpack configuration.
```

**Cause**:
- asarUnpack patterns too broad (wildcards matching unwanted packages)
- webpack-asset-relocator-loader copying extra dependencies
- Manual files in dist/main/node_modules

**Resolution**:
- Replace asarUnpack wildcard with specific package patterns
- Review webpack externals configuration
- Clean dist/ directory and rebuild

---

## Performance Requirements

**Execution Time**: < 100ms typical, < 500ms maximum  
**Memory Usage**: < 10MB (minimal, only directory listing)  
**Disk I/O**: Read-only operations (no writes)

**Benchmarks**:
- getUnpackedPath(): ~1ms (path construction)
- listPackages(): ~10ms (directory scan of ~3-10 packages)
- comparePackages(): ~1ms (Set operations on small arrays)
- Console logging: ~5ms
- **Total**: ~20ms typical

**Scaling**:
- Linear with number of packages in node_modules
- Negligible impact on overall build time (webpack build is ~30-60 seconds)
- Well within 10% overhead requirement (SC-004)

---

## Security Considerations

### Input Validation
- MUST validate context parameter exists
- MUST validate platform is recognized
- MUST handle filesystem errors gracefully
- MUST NOT execute arbitrary code from node_modules

### Path Traversal Prevention
- Use path.join() for all path construction
- NO user input in paths (all hardcoded or from electron-builder)
- Verify constructed paths are within appOutDir

### Dependency Security
- Uses ONLY Node.js built-in modules (fs, path)
- NO external dependencies (no npm packages)
- NO network access required
- NO file writes (read-only validation)

---

## Testing Strategy

### Unit Tests

**Test File**: `scripts/validate-package.test.js`

**Test Cases**:
1. getUnpackedPath() - all platforms
2. listPackages() - success and error cases
3. comparePackages() - all combinations
4. EXPECTED_PACKAGES - constant validation

**Mocking**:
- Mock fs.readdirSync for controlled test data
- Mock context object for electron-builder integration

### Integration Tests

**Approach**: Test with actual packaged app

**Test Cases**:
1. Clean build with correct configuration → validation passes
2. Intentionally add unexpected package → validation fails
3. Remove expected package → validation fails
4. Test on all platforms (macOS, Windows, Linux)

**CI/CD Integration**:
- Run as part of package build in CI
- Fail CI build if validation fails
- Log validation output to CI logs

---

## Usage Examples

### Success Case

```javascript
// Called by electron-builder after packaging
const validatePackage = require("./scripts/validate-package.js");

const context = {
  appOutDir: "/path/to/release/mac",
  packager: {
    platform: { name: "mac" }
  }
};

await validatePackage(context);
// Logs: [Validation] ✅ Package validation passed!
// Returns: undefined (success)
```

### Failure Case

```javascript
// Called by electron-builder after packaging
const validatePackage = require("./scripts/validate-package.js");

const context = {
  appOutDir: "/path/to/release/mac",
  packager: {
    platform: { name: "mac" }
  }
};

try {
  await validatePackage(context);
} catch (error) {
  console.error(error.message);
  // Error: Unexpected packages found in unpacked resources:
  //   Unexpected: electron, fsevents
  //   Expected: esbuild, @esbuild, @anikitenko
  //   Actual: esbuild, @esbuild, @anikitenko, electron, fsevents
  process.exit(1);
}
```

### Direct Testing

```javascript
// For development/debugging
const validatePackage = require("./scripts/validate-package.js");

// Simulate electron-builder context
const context = {
  appOutDir: "./release/mac",
  packager: {
    appInfo: {
      productName: "FDO (FlexDevOPs)",
      version: "1.0.0"
    },
    platform: {
      name: "mac"
    }
  }
};

validatePackage(context)
  .then(() => console.log("Validation passed"))
  .catch((err) => console.error("Validation failed:", err.message));
```

---

## Backwards Compatibility

**Current State**: No existing validation script  
**Migration**: New script, no breaking changes  
**Rollback**: Remove afterPack hook from package.json

**Future Compatibility**:
- Script should continue working with future electron-builder versions
- AfterPackContext interface is stable in electron-builder
- If electron-builder changes, script may need updates

---

## Future Enhancements

### Potential Additions

1. **JSON Output**:
   ```javascript
   // Write validation-result.json for CI/CD parsing
   fs.writeFileSync(
     path.join(appOutDir, "validation-result.json"),
     JSON.stringify(result, null, 2)
   );
   ```

2. **Package Size Reporting**:
   ```javascript
   // Log size of each package
   packages.forEach(pkg => {
     const size = getDirectorySize(path.join(unpackedPath, pkg));
     console.log(`  ${pkg}: ${formatBytes(size)}`);
   });
   ```

3. **Platform-Specific Validation**:
   ```javascript
   // Verify correct @esbuild subpackage for platform
   if (platform === "mac" && arch === "arm64") {
     validateSubPackage("@esbuild", ["darwin-arm64"]);
   }
   ```

4. **Configuration File**:
   ```javascript
   // Load expected packages from config file
   const config = require("./validation-config.json");
   const EXPECTED_PACKAGES = new Set(config.expectedPackages);
   ```

### Not Planned

- Dynamic package detection (defeats purpose of validation)
- Package content verification (out of scope)
- Dependency tree analysis (unnecessary complexity)

---

**Contract Status**: ✅ COMPLETE  
**Next Steps**: Create quickstart.md with testing instructions

