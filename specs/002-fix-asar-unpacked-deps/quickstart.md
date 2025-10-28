# Quickstart: Fix Unwanted Dependencies in Packaged Application

**Date**: October 28, 2025  
**Feature**: 002-fix-asar-unpacked-deps  
**Purpose**: Quick guide for testing and verifying the packaging fix

---

## Overview

This guide provides step-by-step instructions for verifying that the packaging fix correctly includes only the three required packages (esbuild, @esbuild, @anikitenko/fdo-sdk) in the unpacked resources directory.

**Time Required**: 10-15 minutes  
**Prerequisites**: Node.js installed, project dependencies installed (`npm install`)

---

## Quick Verification (Recommended)

### Step 1: Clean Previous Builds

```bash
# Remove all build artifacts
rm -rf dist/ release/

# Or use npm script if available
npm run clean
```

**Why**: Ensures you're testing with a fresh build, not cached artifacts.

---

### Step 2: Build the Application

```bash
# Build webpack bundles
npm run build

# This should complete in 30-60 seconds
```

**Expected Output**:
```
[webpack output...]
webpack compiled successfully
```

**Troubleshooting**:
- If build fails, check for TypeScript errors
- Ensure all dependencies installed: `npm install`
- Check Node.js version: `node --version` (should be 18+)

---

### Step 3: Package for Your Platform

```bash
# macOS
npm run dist:mac

# Windows (if on Windows)
npm run dist:win

# Linux (if on Linux)
npm run dist:linux
```

**Expected Duration**: 2-5 minutes depending on platform

**Expected Output**:
```
[electron-builder output...]
[Validation] Checking packaged dependencies for mac...
[Validation] Expected packages: esbuild, @esbuild, @anikitenko
[Validation] Actual packages: esbuild, @esbuild, @anikitenko
[Validation] ✅ Package validation passed!

Building... done
```

**Success Indicators**:
- ✅ Build completes without errors
- ✅ Validation log shows ✅ checkmark
- ✅ `release/` directory contains packaged app

---

### Step 4: Verify Package Contents

#### macOS

```bash
# List unpacked packages
ls -la release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/

# Or use tree for detailed view
tree -L 2 release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/
```

**Expected Output**:
```
drwxr-xr-x  esbuild
drwxr-xr-x  @esbuild
drwxr-xr-x  @anikitenko
```

**Count Check**:
```bash
# Should output: 3
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/ | wc -l
```

#### Windows (PowerShell)

```powershell
# List unpacked packages
Get-ChildItem release\win-unpacked\resources\app.asar.unpacked\node_modules\

# Count directories
(Get-ChildItem release\win-unpacked\resources\app.asar.unpacked\node_modules\).Count
# Should output: 3
```

#### Linux

```bash
# List unpacked packages
ls -la release/linux-unpacked/resources/app.asar.unpacked/node_modules/

# Count directories
ls release/linux-unpacked/resources/app.asar.unpacked/node_modules/ | wc -l
# Should output: 3
```

---

### Step 5: Verify Application Functionality

```bash
# macOS
open release/mac/FDO\ \(FlexDevOPs\).app

# Windows
start release\win-unpacked\FDO\ \(FlexDevOPs\).exe

# Linux
./release/linux-unpacked/fdo-flexdevops
```

**Functional Tests**:
1. ✅ Application launches without errors
2. ✅ Navigate to plugin editor
3. ✅ Create a new plugin
4. ✅ Build the plugin (uses esbuild)
5. ✅ Deploy the plugin (uses @anikitenko/fdo-sdk)
6. ✅ Verify no console errors related to missing packages

---

## Detailed Verification

### Inspect Package Contents

#### Check @esbuild Platform Binary

```bash
# macOS ARM64 (M1/M2/M3)
ls -la release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/
# Should show: darwin-arm64/

# macOS x64 (Intel)
ls -la release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/
# Should show: darwin-x64/

# Windows
dir release\win-unpacked\resources\app.asar.unpacked\node_modules\@esbuild\
# Should show: win32-x64/

# Linux
ls -la release/linux-unpacked/resources/app.asar.unpacked/node_modules/@esbuild/
# Should show: linux-x64/
```

**Expected**: Only the platform-specific binary for your current platform

---

#### Check Package Sizes

```bash
# macOS
du -sh release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/*

# Windows (PowerShell)
Get-ChildItem release\win-unpacked\resources\app.asar.unpacked\node_modules\ | ForEach-Object { "{0:N2} MB`t{1}" -f ((Get-ChildItem $_.FullName -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB), $_.Name }

# Linux
du -sh release/linux-unpacked/resources/app.asar.unpacked/node_modules/*
```

**Expected Sizes** (approximate):
- esbuild: ~1-2 MB
- @esbuild: ~15-20 MB (contains native binary)
- @anikitenko: ~10-15 MB

**Total**: ~30-40 MB (significantly smaller than before with unwanted packages)

---

### Compare Package Size (Before vs After)

If you have a previous build:

```bash
# macOS
du -sh release-old/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/
du -sh release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/

# Calculate reduction
# Should see 50-100MB reduction
```

---

## Testing Validation Script

### Test 1: Validation Passes (Happy Path)

This test is covered by Step 3 above. If packaging succeeds, validation passed.

---

### Test 2: Validation Fails (Intentional Failure)

**Purpose**: Verify that validation correctly detects unwanted packages

**Steps**:

1. **Temporarily modify package.json**:
   ```json
   "asarUnpack": [
     "dist/main/node_modules/**/*"
   ]
   ```
   (Change back to wildcard to allow all packages)

2. **Package the application**:
   ```bash
   npm run dist:mac
   ```

3. **Expected Result**: Build FAILS with error:
   ```
   [Validation] Checking packaged dependencies for mac...
   [Validation] Expected packages: esbuild, @esbuild, @anikitenko
   [Validation] Actual packages: esbuild, @esbuild, @anikitenko, electron, fsevents

   Error: Unexpected packages found in unpacked resources:
     Unexpected: electron, fsevents
     Expected: esbuild, @esbuild, @anikitenko
     Actual: esbuild, @esbuild, @anikitenko, electron, fsevents
   ```

4. **Revert package.json** to correct configuration:
   ```json
   "asarUnpack": [
     "dist/main/node_modules/esbuild/**/*",
     "dist/main/node_modules/@esbuild/**/*",
     "dist/main/node_modules/@anikitenko/**/*"
   ]
   ```

**Why This Test Matters**: Confirms that validation prevents shipping incorrect packages.

---

### Test 3: Missing Package Detection

**Purpose**: Verify validation detects missing required packages

**Steps**:

1. **After successful build, manually delete a package**:
   ```bash
   # macOS
   rm -rf release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/@anikitenko
   ```

2. **Re-run validation manually**:
   ```bash
   # Create a test script or modify the validation script temporarily to run standalone
   node -e "
   const validate = require('./scripts/validate-package.js');
   const context = {
     appOutDir: './release/mac',
     packager: { platform: { name: 'mac' } }
   };
   validate(context).catch(err => {
     console.error(err.message);
     process.exit(1);
   });
   "
   ```

3. **Expected Result**: Error about missing @anikitenko

**Note**: This test requires manual setup after a successful build. Optional for routine verification.

---

## Troubleshooting

### Issue: Validation script not running

**Symptoms**: Build completes but no "[Validation]" logs

**Causes**:
1. `afterPack` not configured in package.json
2. Validation script path incorrect
3. Validation script not executable (Unix)

**Solutions**:
```bash
# Check afterPack configuration
grep -A 2 "afterPack" package.json
# Should show: "afterPack": "./scripts/validate-package.js"

# Verify script exists
ls -la scripts/validate-package.js

# Make executable (Unix)
chmod +x scripts/validate-package.js

# Test script directly
node scripts/validate-package.js
```

---

### Issue: Unexpected packages still present

**Symptoms**: Validation fails with unexpected packages

**Causes**:
1. asarUnpack patterns still use wildcards
2. webpack-asset-relocator-loader copying extra packages
3. Old build artifacts not cleaned

**Solutions**:
```bash
# 1. Verify asarUnpack configuration
grep -A 5 "asarUnpack" package.json
# Should show specific package patterns, not "**/*"

# 2. Clean everything and rebuild
rm -rf dist/ release/ node_modules/
npm install
npm run build
npm run dist:mac

# 3. Check webpack config
grep -A 10 "externals" webpack.main.config.js
# Should list esbuild and @anikitenko/fdo-sdk
```

---

### Issue: Application won't launch after packaging

**Symptoms**: Packaged app crashes or shows errors on launch

**Causes**:
1. Required packages not copied
2. Native binaries missing
3. Package paths incorrect

**Solutions**:
```bash
# 1. Verify all three packages present
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/
# Must show: esbuild, @esbuild, @anikitenko

# 2. Check native binary exists
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/*/bin/esbuild
# Should find esbuild binary

# 3. Check application logs
# macOS: Console.app → filter for "FDO"
# Windows: Check event viewer
# Linux: Check journalctl
```

---

### Issue: Build takes longer than expected

**Symptoms**: Packaging takes >10 minutes or times out

**Causes**:
1. Network issues downloading dependencies
2. Antivirus scanning build artifacts
3. Disk I/O bottleneck

**Solutions**:
```bash
# 1. Check network connectivity
ping npmjs.com

# 2. Exclude build directories from antivirus (Windows)
# Add exclusions: dist/, release/, node_modules/

# 3. Check disk space
df -h  # Unix
# Ensure >5GB free space

# 4. Monitor build progress
npm run dist:mac --verbose
```

---

## Performance Metrics

### Expected Build Times

| Stage | Duration | Notes |
|-------|----------|-------|
| npm run build | 30-60s | Webpack compilation |
| electron-builder | 2-5min | Platform-specific |
| Validation | <1s | Script execution |
| **Total** | **3-6min** | Per platform |

### Package Size Comparison

| Configuration | Unpacked Size | Reduction |
|---------------|---------------|-----------|
| Before fix (all packages) | ~130-150 MB | - |
| After fix (3 packages only) | ~30-40 MB | 50-100 MB |
| **Improvement** | **-75%** | **✅ Meets SC-002** |

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Package Application

on:
  push:
    branches: [main, 002-fix-asar-unpacked-deps]

jobs:
  package-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run dist:mac
      # Validation runs automatically in dist:mac
      - uses: actions/upload-artifact@v3
        with:
          name: mac-app
          path: release/*.dmg
```

**Key Points**:
- Validation runs automatically during `npm run dist:mac`
- Build fails if validation detects issues
- No manual verification needed in CI

---

## Acceptance Checklist

Use this checklist to verify the fix meets all success criteria:

- [ ] **SC-001**: Packaged application contains exactly 3 packages in unpacked resources
  - [ ] esbuild present
  - [ ] @esbuild present (with platform-specific binary)
  - [ ] @anikitenko present
  - [ ] No other packages present

- [ ] **SC-002**: Package size reduced by 50-100MB
  - [ ] Measured before size: _______ MB
  - [ ] Measured after size: _______ MB
  - [ ] Reduction: _______ MB (≥50MB)

- [ ] **SC-003**: 100% functional parity
  - [ ] Application launches successfully
  - [ ] Plugin editor opens
  - [ ] Can create new plugin
  - [ ] Plugin build works (esbuild)
  - [ ] Plugin deploy works (@anikitenko/fdo-sdk)
  - [ ] No console errors

- [ ] **SC-004**: Build time increase <10%
  - [ ] Before: _______ seconds
  - [ ] After: _______ seconds
  - [ ] Increase: _______ % (<10%)

- [ ] **SC-005**: Automated validation prevents regression
  - [ ] Validation script runs automatically
  - [ ] Build fails on unexpected packages (verified by Test 2)
  - [ ] Clear error messages displayed

- [ ] **Platform Testing** (if applicable)
  - [ ] macOS x64 tested
  - [ ] macOS arm64 tested
  - [ ] Windows x64 tested
  - [ ] Linux x64 tested

---

## Next Steps After Verification

Once all checks pass:

1. ✅ Commit changes to feature branch
2. ✅ Push to remote repository
3. ✅ Create pull request
4. ✅ Request code review
5. ✅ Merge to main after approval
6. ✅ Create release build
7. ✅ Update documentation (if needed)

---

## Quick Reference Commands

```bash
# Full clean build and package (macOS)
rm -rf dist/ release/ && npm run build && npm run dist:mac

# Verify package contents (macOS)
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/

# Count packages (should be 3)
ls release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/ | wc -l

# Check package sizes
du -sh release/mac/FDO\ \(FlexDevOPs\).app/Contents/Resources/app.asar.unpacked/node_modules/*

# Launch application
open release/mac/FDO\ \(FlexDevOPs\).app

# View validation logs
npm run dist:mac 2>&1 | grep "\[Validation\]"
```

---

**Quickstart Status**: ✅ COMPLETE  
**Estimated Verification Time**: 10-15 minutes  
**Next Steps**: Update agent context, then run `/speckit.tasks`

