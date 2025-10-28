# Research: Fix Unwanted Dependencies in Packaged Application

**Date**: October 28, 2025  
**Feature**: 002-fix-asar-unpacked-deps  
**Purpose**: Investigate root cause and identify solution for unwanted packages in app.asar.unpacked

---

## Research Questions & Findings

### Q1: Why are @unrs, electron, and fsevents being included?

**Finding**: The issue stems from a combination of webpack-asset-relocator-loader behavior and electron-builder's asarUnpack configuration.

**Root Causes Identified**:

1. **@vercel/webpack-asset-relocator-loader** (lines 23-32 in webpack.main.config.js):
   - Automatically scans all files in node_modules matching `/.+\.(m?js|node)$/`
   - Attempts to relocate native binary dependencies to `native_modules/` directory
   - Creates "fake" .node files that reference actual native binaries
   - This loader may be pulling in transitive dependencies from esbuild or other packages

2. **CopyWebpackPlugin** (lines 48-63 in webpack.main.config.js):
   - Explicitly copies three packages: esbuild, @esbuild, @anikitenko/fdo-sdk
   - Uses directory-level copying which includes all contents
   - Does NOT prevent webpack-asset-relocator-loader from processing other dependencies

3. **electron-builder asarUnpack** (line 168-170 in package.json):
   ```json
   "asarUnpack": [
     "dist/main/node_modules/**/*"
   ]
   ```
   - Uses wildcard pattern `dist/main/node_modules/**/*`
   - Unpacks EVERYTHING in dist/main/node_modules, not just the three intended packages
   - This is the final stage where unwanted packages get included

**Evidence**:
- fsevents: Likely a transitive dependency of a development tool (chokidar/watchpack used by webpack)
- electron: May be referenced by webpack or build tools
- @unrs: Unclear origin, needs further investigation (possibly misread of @esbuild)

**Decision**: The asarUnpack wildcard pattern is the primary culprit. We need to make it specific.

---

### Q2: How does electron-builder determine what goes in app.asar.unpacked?

**Finding**: electron-builder uses the `asarUnpack` configuration in package.json to specify glob patterns.

**Current Configuration** (package.json:168-170):
```json
"asarUnpack": [
  "dist/main/node_modules/**/*"
]
```

**How it works**:
1. electron-builder first creates the ASAR archive with all files from `dist/`
2. Files matching `asarUnpack` patterns are then extracted from ASAR and placed in `app.asar.unpacked/`
3. Glob patterns support:
   - `*` - matches any characters except `/`
   - `**` - matches any characters including `/` (recursive)
   - Specific paths can be listed individually

**Best Practice Research**:

From electron-builder documentation:
- Use specific paths when possible instead of wildcards
- List individual packages to avoid including unwanted dependencies
- Pattern: `"dist/main/node_modules/{package1,package2,package3}/**/*"`

**Alternative Approaches**:

**Option A**: Specific package list (RECOMMENDED)
```json
"asarUnpack": [
  "dist/main/node_modules/esbuild/**/*",
  "dist/main/node_modules/@esbuild/**/*",
  "dist/main/node_modules/@anikitenko/fdo-sdk/**/*"
]
```

**Option B**: Brace expansion syntax
```json
"asarUnpack": [
  "dist/main/node_modules/{esbuild,@esbuild,@anikitenko/fdo-sdk}/**/*"
]
```

**Option C**: Remove asarUnpack and rely on externals
- Mark packages as external in webpack
- Don't unpack them, reference from app.asar directly
- **Risk**: Native binaries (.node files) cannot be executed from within ASAR

**Decision**: Option A (specific package list) is safest and most explicit.

**Rationale**: 
- Most readable and maintainable
- Each package is clearly visible
- Easy to add/remove packages
- No risk of pattern matching errors

---

### Q3: What's the correct way to exclude unwanted packages?

**Finding**: Multi-layered approach combining webpack configuration and electron-builder settings.

**Strategy**:

**Layer 1: Webpack Externals** (prevents bundling)
```javascript
externals: {
  esbuild: "commonjs esbuild",
  "@esbuild/darwin-arm64": "commonjs @esbuild/darwin-arm64",
  "@esbuild/darwin-x64": "commonjs @esbuild/darwin-x64",
  "@esbuild/linux-x64": "commonjs @esbuild/linux-x64",
  "@esbuild/win32-x64": "commonjs @esbuild/win32-x64",
  "@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk"
}
```
- Tells webpack: "don't bundle these, they'll be available at runtime"
- Prevents webpack from trying to process these packages
- **Note**: @esbuild is a package directory containing platform-specific sub-packages

**Layer 2: CopyWebpackPlugin** (copies to dist)
```javascript
new CopyWebpackPlugin({
  patterns: [
    { from: "node_modules/esbuild", to: "node_modules/esbuild" },
    { from: "node_modules/@esbuild", to: "node_modules/@esbuild" },
    { from: "node_modules/@anikitenko/fdo-sdk", to: "node_modules/@anikitenko/fdo-sdk" }
  ]
})
```
- Copies exact packages needed to dist/main/node_modules
- Preserves directory structure
- **Current issue**: Other packages may still end up in dist/main/node_modules via webpack-asset-relocator-loader

**Layer 3: electron-builder asarUnpack** (unpacks from ASAR)
```json
"asarUnpack": [
  "dist/main/node_modules/esbuild/**/*",
  "dist/main/node_modules/@esbuild/**/*",
  "dist/main/node_modules/@anikitenko/fdo-sdk/**/*"
]
```
- Explicitly lists what to unpack
- Prevents wildcard from catching unwanted packages

**Layer 4: Clean dist/main/node_modules** (before packaging)
- Option to add a pre-packaging script that removes any unexpected packages
- Provides defense in depth
- **Trade-off**: Adds build complexity

**Recommended Approach**:
1. Update webpack externals to include all platform-specific @esbuild packages
2. Keep CopyWebpackPlugin as-is (explicit copies)
3. Update asarUnpack to specific package list (Layer 3)
4. Verify webpack-asset-relocator-loader isn't copying extra packages

**Why not remove webpack-asset-relocator-loader?**
- It's handling the native .node file transformations
- The loader is configured in webpack.rules.js and applied to both main and renderer configs
- It's needed for other native dependencies the app might use
- The issue is the asarUnpack wildcard, not the loader itself

---

### Q4: How to implement post-packaging validation?

**Finding**: electron-builder provides lifecycle hooks for post-packaging validation.

**Implementation Approaches**:

**Option A**: electron-builder afterPack hook (RECOMMENDED)
```javascript
// package.json
"build": {
  "afterPack": "./scripts/validate-package.js"
}
```

```javascript
// scripts/validate-package.js
const fs = require("fs");
const path = require("path");

module.exports = async function(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.name;
  
  // Determine path based on platform
  let unpackedPath;
  if (platform === "mac") {
    unpackedPath = path.join(appOutDir, "FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules");
  } else if (platform === "win") {
    unpackedPath = path.join(appOutDir, "resources/app.asar.unpacked/node_modules");
  } else if (platform === "linux") {
    unpackedPath = path.join(appOutDir, "resources/app.asar.unpacked/node_modules");
  }
  
  const expectedPackages = ["esbuild", "@esbuild", "@anikitenko"];
  const actualPackages = fs.readdirSync(unpackedPath);
  
  const unexpected = actualPackages.filter(p => !expectedPackages.includes(p));
  
  if (unexpected.length > 0) {
    throw new Error(`Unexpected packages in unpacked resources: ${unexpected.join(", ")}`);
  }
};
```

**Option B**: npm script with afterBuild
- Run validation after electron-builder completes
- Use exit code to fail CI/CD
- Less integrated, requires manual chaining

**Option C**: Jest/Mocha test
- Create a test that packages the app and verifies contents
- Slower, but provides test coverage
- Good for CI but not for local builds

**Decision**: Option A (afterPack hook)

**Rationale**:
- Runs automatically as part of packaging
- Integrated with electron-builder lifecycle
- Fails build immediately if validation fails
- Works for all platforms
- No manual script orchestration needed

**Additional Features**:
- Log actual vs expected packages for debugging
- Support for platform-specific validation
- Clear error messages with remediation hints

---

### Q5: How to ensure platform-specific packages don't add dependencies?

**Finding**: @esbuild package structure contains platform-specific sub-packages that need special handling.

**@esbuild Package Structure**:
```
node_modules/
├── esbuild/              # Main package with CLI and JS wrapper
│   └── bin/
│       └── esbuild       # Launcher script
└── @esbuild/             # Scoped package directory
    ├── darwin-arm64/     # macOS ARM64 native binary
    ├── darwin-x64/       # macOS x64 native binary
    ├── linux-x64/        # Linux x64 native binary
    └── win32-x64/        # Windows x64 native binary
```

**Key Findings**:

1. **esbuild uses optional dependencies**:
   - package.json lists all platform packages as optionalDependencies
   - Only the matching platform gets installed (e.g., darwin-arm64 on M1 Mac)
   - Other platforms are skipped during npm install

2. **Platform packages are thin wrappers**:
   - Each @esbuild/platform package contains only native binary
   - No additional dependencies
   - No transitive dependency risk

3. **Copying @esbuild directory is safe**:
   - CopyWebpackPlugin copying `node_modules/@esbuild` copies entire directory
   - Only contains the installed platform-specific package
   - Other platforms aren't present to be copied

**Verification**:
```bash
# Check what's actually in @esbuild
ls -la node_modules/@esbuild/
# On M1 Mac: only darwin-arm64 will be present
```

**@anikitenko/fdo-sdk Investigation**:
- Need to verify it doesn't have platform-specific native dependencies
- Check package.json for optionalDependencies
- Confirm it's pure JavaScript or has bundled natives

**Action Items**:
1. Verify @anikitenko/fdo-sdk package.json for dependencies
2. Test on each platform to ensure only appropriate binaries are copied
3. Document that @esbuild directory copy is intentional and platform-safe

**Decision**: Current CopyWebpackPlugin patterns are correct for esbuild and @esbuild.

---

## Solution Design

Based on research findings, the solution has three components:

### 1. Update asarUnpack Configuration (package.json)

**Change**:
```json
"asarUnpack": [
  "dist/main/node_modules/esbuild/**/*",
  "dist/main/node_modules/@esbuild/**/*",
  "dist/main/node_modules/@anikitenko/**/*"
]
```

**Rationale**: 
- Replace wildcard with explicit package list
- Prevents electron-builder from unpacking unwanted packages
- @anikitenko captures @anikitenko/fdo-sdk

---

### 2. Verify webpack externals (webpack.main.config.js)

**Current**:
```javascript
externals: {
  esbuild: "commonjs esbuild",
}
```

**Recommended Update**:
```javascript
externals: {
  esbuild: "commonjs esbuild",
  "@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk"
}
```

**Rationale**:
- Ensures webpack doesn't try to bundle these packages
- Marks them as available at runtime (CommonJS require)
- Prevents webpack-asset-relocator-loader from processing them

**Note**: Platform-specific @esbuild packages don't need to be listed as externals because:
- They're not directly imported by the code
- esbuild package handles loading them dynamically at runtime
- Copying @esbuild directory is sufficient

---

### 3. Add Post-Packaging Validation

**New File**: `scripts/validate-package.js`

```javascript
/**
 * Validates that only expected packages are in app.asar.unpacked/node_modules
 * Run automatically by electron-builder afterPack hook
 */
const fs = require("fs");
const path = require("path");

const EXPECTED_PACKAGES = new Set(["esbuild", "@esbuild", "@anikitenko"]);

module.exports = async function afterPackHook(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.name;
  
  console.log(`\n[Validation] Checking packaged dependencies for ${platform}...`);
  
  // Determine unpacked node_modules path based on platform
  let unpackedPath;
  if (platform === "mac") {
    unpackedPath = path.join(
      appOutDir,
      "FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules"
    );
  } else if (platform === "win") {
    unpackedPath = path.join(
      appOutDir,
      "resources/app.asar.unpacked/node_modules"
    );
  } else if (platform === "linux") {
    unpackedPath = path.join(
      appOutDir,
      "resources/app.asar.unpacked/node_modules"
    );
  }
  
  // Check if directory exists
  if (!fs.existsSync(unpackedPath)) {
    throw new Error(`Unpacked node_modules directory not found: ${unpackedPath}`);
  }
  
  // List actual packages
  const actualPackages = fs.readdirSync(unpackedPath);
  
  // Compare against expected
  const unexpected = actualPackages.filter(pkg => !EXPECTED_PACKAGES.has(pkg));
  const missing = Array.from(EXPECTED_PACKAGES).filter(
    pkg => !actualPackages.includes(pkg)
  );
  
  // Report results
  console.log(`[Validation] Expected packages: ${Array.from(EXPECTED_PACKAGES).join(", ")}`);
  console.log(`[Validation] Actual packages: ${actualPackages.join(", ")}`);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required packages in unpacked resources:\n` +
      `  Missing: ${missing.join(", ")}\n` +
      `  Expected: ${Array.from(EXPECTED_PACKAGES).join(", ")}\n` +
      `  Actual: ${actualPackages.join(", ")}`
    );
  }
  
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected packages found in unpacked resources:\n` +
      `  Unexpected: ${unexpected.join(", ")}\n` +
      `  Expected: ${Array.from(EXPECTED_PACKAGES).join(", ")}\n` +
      `  Actual: ${actualPackages.join(", ")}\n\n` +
      `These packages should not be in app.asar.unpacked. ` +
      `Check webpack externals and electron-builder asarUnpack configuration.`
    );
  }
  
  console.log(`[Validation] ✅ Package validation passed!\n`);
};
```

**Update package.json**:
```json
"build": {
  "afterPack": "./scripts/validate-package.js",
  // ... rest of build config
}
```

---

## Alternative Approaches Considered

### Alternative 1: Remove asarUnpack entirely

**Approach**: Don't unpack node_modules, let electron-builder handle it automatically.

**Rejected Because**:
- electron-builder's auto-detection may still include unwanted packages
- Less explicit control over what gets unpacked
- Native binaries (.node files) require unpacking to execute
- Current approach (explicit CopyWebpackPlugin) is more maintainable

---

### Alternative 2: Clean dist/main/node_modules before packaging

**Approach**: Add a script that deletes unwanted packages before electron-builder runs.

**Rejected Because**:
- Treats symptom, not root cause
- Adds complexity to build process
- Fragile (easy to forget to update when adding new packages)
- Better to configure webpack/electron-builder correctly

---

### Alternative 3: Use electron-builder files instead of asarUnpack

**Approach**: Use `files` configuration to control what goes into the app.

**Rejected Because**:
- `files` controls what goes into ASAR, not what gets unpacked
- asarUnpack is specifically designed for native modules
- Would require rewriting entire build configuration
- Current approach is simpler and more targeted

---

## Testing Plan

### Manual Verification Steps

1. **Clean build**:
   ```bash
   npm run clean  # or rm -rf dist/ release/
   npm run build
   npm run dist:mac  # or dist:linux, dist:win
   ```

2. **Inspect packaged app**:
   ```bash
   # macOS
   ls -la release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/
   
   # Windows
   ls -la release/win-unpacked/resources/app.asar.unpacked/node_modules/
   
   # Linux
   ls -la release/linux-unpacked/resources/app.asar.unpacked/node_modules/
   ```

3. **Expected output**: Only 3 directories:
   - esbuild/
   - @esbuild/
   - @anikitenko/

4. **Verify functionality**:
   - Launch packaged app
   - Create a new plugin in the editor
   - Build/compile the plugin (uses esbuild)
   - Deploy the plugin (uses @anikitenko/fdo-sdk)
   - Verify no runtime errors

### Automated Validation

Validation script runs automatically during `npm run dist` and will:
- ✅ Pass if only expected packages are present
- ❌ Fail build with detailed error if unexpected packages found
- ❌ Fail build if expected packages are missing

### Platform-Specific Testing

Test on each platform to ensure:
- macOS (arm64): Only @esbuild/darwin-arm64 present
- macOS (x64): Only @esbuild/darwin-x64 present
- Windows (x64): Only @esbuild/win32-x64 present
- Linux (x64): Only @esbuild/linux-x64 present

---

## Risk Analysis

### Risk 1: Breaking existing functionality

**Likelihood**: Low  
**Impact**: High  
**Mitigation**: 
- Test plugin build/deploy workflow thoroughly
- Verify esbuild and fdo-sdk are accessible at runtime
- Run on all platforms before releasing

### Risk 2: Platform-specific issues

**Likelihood**: Medium  
**Impact**: Medium  
**Mitigation**:
- Test on all platforms (macOS, Windows, Linux)
- Verify @esbuild platform packages are correctly included
- Add validation for each platform in afterPack hook

### Risk 3: Validation script false positives

**Likelihood**: Low  
**Impact**: Medium  
**Mitigation**:
- Clear error messages with actual vs expected
- Test validation script with intentionally incorrect configuration
- Provide override mechanism if needed (environment variable)

### Risk 4: Future dependencies added unintentionally

**Likelihood**: Medium  
**Impact**: Low  
**Mitigation**:
- Automated validation prevents regression
- Document expected packages in README
- CI/CD will catch issues before release

---

## Success Criteria (from spec)

- ✅ **SC-001**: Packaged application contains exactly three packages in unpacked resources
  - **Verification**: `ls` command shows only esbuild, @esbuild, @anikitenko
  
- ✅ **SC-002**: Package size reduced by 50-100MB
  - **Verification**: Compare `du -sh` before and after fix
  
- ✅ **SC-003**: 100% functional parity
  - **Verification**: Manual testing of all plugin workflows
  
- ✅ **SC-004**: Build time increase < 10%
  - **Verification**: Time `npm run dist` before and after
  
- ✅ **SC-005**: Automated regression prevention
  - **Verification**: Validation script runs and fails on incorrect packages

---

## Next Steps

1. ✅ Research complete - all questions answered
2. ⏭️ Create data-model.md defining configuration schema
3. ⏭️ Create contracts/validation-api.md defining validation interface
4. ⏭️ Create quickstart.md with verification instructions
5. ⏭️ Update agent context with research findings
6. ⏭️ Run `/speckit.tasks` to generate implementation task breakdown

---

**Research Status**: ✅ COMPLETE  
**Key Decisions**:
- Update asarUnpack to explicit package list
- Add @anikitenko/fdo-sdk to webpack externals
- Implement afterPack validation hook
- Test on all platforms before release

