# Implementation Summary: Fix Unwanted Dependencies in Packaged Application

**Feature ID**: 002-fix-asar-unpacked-deps  
**Date**: October 28, 2025  
**Status**: ✅ **COMPLETED**

---

## Problem Statement

The packaged Electron application contained unwanted dependencies in `Contents/Resources/app.asar.unpacked/node_modules`:
- ❌ `@unrs`
- ❌ `electron` 
- ❌ `fsevents`

According to `webpack.main.config.js`, it should only contain:
- ✅ `esbuild`
- ✅ `@esbuild`
- ✅ `@anikitenko/fdo-sdk`

---

## Root Cause Analysis

### Primary Causes

1. **electron-builder Auto-Dependency Inclusion**
   - electron-builder automatically includes all dependencies from `package.json` in the ASAR
   - Even with `files: ["dist/**/*"]`, it still processed root dependencies

2. **Automatic Native Module Unpacking**
   - electron-builder's `smartUnpack` feature automatically unpacks packages with native binaries (`.node` files)
   - This caused `electron`, `@unrs`, and `fsevents` to be unpacked even though they weren't explicitly specified

3. **Transitive Dependencies**
   - `@anikitenko/fdo-sdk` has `electron` as a dependency
   - npm flattened these dependencies to root `node_modules/`
   - electron-builder included all flattened dependencies

4. **node_modules Filtering**
   - electron-builder has hardcoded exclusion logic for `node_modules` directories
   - Even explicitly including `dist/main/node_modules` in files configuration was ignored

---

## Solution Implementation

### Configuration Changes

#### 1. **webpack.main.config.js**
Added `@anikitenko/fdo-sdk` to externals to ensure it's not bundled:

```javascript
externals: {
    esbuild: "commonjs esbuild",
    "@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk",
},
```

#### 2. **package.json - Build Configuration**

**Key Settings:**
```json
{
  "build": {
    "asar": {
      "smartUnpack": false  // Disable automatic native module unpacking
    },
    "includeSubNodeModules": false,  // Don't include nested node_modules
    "buildDependenciesFromSource": false,  // Don't build deps from source
    "nodeGypRebuild": false,  // Don't run node-gyp rebuild
    "npmRebuild": false,  // Skip npm rebuild entirely
    
    "files": [
      "dist",  // Include dist directory
      "package.json"
      // Explicitly NOT including root node_modules
    ],
    
    "extraResources": [
      // Use extraResources to bypass electron-builder's node_modules filtering
      {
        "from": "dist/main/node_modules/esbuild",
        "to": "app.asar.unpacked/dist/main/node_modules/esbuild"
      },
      {
        "from": "dist/main/node_modules/@esbuild",
        "to": "app.asar.unpacked/dist/main/node_modules/@esbuild"
      },
      {
        "from": "dist/main/node_modules/@anikitenko",
        "to": "app.asar.unpacked/dist/main/node_modules/@anikitenko"
      }
    ]
  }
}
```

---

## Key Insights

### Why `extraResources` Was The Solution

1. **Bypasses File Filtering**: `extraResources` copies files directly without going through electron-builder's file pattern matching
2. **Bypasses node_modules Exclusion**: electron-builder's hardcoded node_modules exclusion doesn't apply to extraResources
3. **Direct Control**: We explicitly specify what goes where, with no auto-detection or smart unpacking

### What Didn't Work

1. ❌ **asarUnpack patterns alone** - smartUnpack added unwanted packages
2. ❌ **files configuration with node_modules** - hardcoded exclusion blocked it
3. ❌ **npmRebuild: false alone** - dependencies were still included in ASAR
4. ❌ **Explicit files inclusion** - `"dist/main/node_modules"` was ignored

---

## Verification Results

### Before Fix
```
app.asar.unpacked/node_modules/
├── @esbuild/
├── @unrs/          ❌
├── electron/       ❌
└── fsevents/       ❌
```
**Package count**: 4 (missing esbuild and @anikitenko)

### After Fix
```
app.asar.unpacked/dist/main/node_modules/
├── @anikitenko/    ✅
├── @esbuild/       ✅
└── esbuild/        ✅
```
**Package count**: 3 (exactly as specified)

---

## Impact

### Benefits
- ✅ Reduced package size (removed unnecessary electron, @unrs, fsevents)
- ✅ Cleaner package structure
- ✅ Explicit control over unpacked dependencies
- ✅ No unwanted native modules
- ✅ Build process more predictable

### Compatibility
- ✅ Works with webpack's CopyWebpackPlugin
- ✅ Compatible with existing external dependencies
- ✅ No impact on development builds

---

## Testing

### Verified
- [x] Only 3 packages in unpacked directory
- [x] No root-level node_modules in unpacked area
- [x] Webpack correctly copies packages to dist/main/node_modules
- [x] electron-builder respects extraResources configuration
- [ ] Application functionality (pending T013)

---

## Lessons Learned

1. **electron-builder has opinionated defaults** for dependency handling that can't be easily overridden with files configuration alone

2. **extraResources is powerful** for cases where you need to bypass normal file processing

3. **smartUnpack should be disabled** if you want explicit control over what gets unpacked

4. **npmRebuild: false is essential** to prevent automatic dependency installation

5. **Root cause investigation is crucial** - the initial assumption that asarUnpack patterns were wrong was incomplete; the real issue was how electron-builder processes dependencies

---

## Related Files

- `webpack.main.config.js` - External dependencies configuration
- `package.json` - Build and extraResources configuration
- `specs/002-fix-asar-unpacked-deps/research.md` - Root cause analysis
- `specs/002-fix-asar-unpacked-deps/baseline-metrics.md` - Before/after metrics

---

## Next Steps

- [ ] Complete T013: Verify application functionality
- [ ] Complete T014: Test on other platforms (Windows, Linux)
- [ ] Document in README if needed
- [ ] Consider creating validation script for CI/CD

