# Baseline Metrics: Fix Unwanted Dependencies

**Date**: October 28, 2025  
**Build**: From release/ directory (Oct 27 build)

## Package Sizes (Before Fix)

- **x64 DMG**: 185M (`FDO (FlexDevOPs)-1.0.0.dmg`)
- **arm64 DMG**: 180M (`FDO (FlexDevOPs)-1.0.0-arm64.dmg`)

## Unpacked Packages (Before Fix)

**Location**: `release/mac/FDO (FlexDevOPs).app/Contents/Resources/app.asar.unpacked/node_modules/`

**Actual packages present**:
1. @esbuild/ ✅ (correct - should stay)
2. @unrs/ ❌ (unwanted - should remove)
3. fsevents/ ❌ (unwanted - should remove)

**Expected packages missing**:
- esbuild/ (should be present)
- @anikitenko/fdo-sdk/ (should be present)

## Configuration (Before Fix)

**webpack.main.config.js externals**:
```javascript
externals: {
    esbuild: "commonjs esbuild",
}
```

**package.json asarUnpack**:
```json
"asarUnpack": [
  "dist/main/node_modules/**/*"
]
```

## Notes

The wildcard pattern `"dist/main/node_modules/**/*"` is unpacking whatever webpack copies to `dist/main/node_modules/`, which includes unwanted packages (@unrs, fsevents) but is missing the expected packages (esbuild, @anikitenko/fdo-sdk).

This suggests:
1. CopyWebpackPlugin may not be copying all required packages
2. OR the webpack-asset-relocator-loader is copying unwanted ones
3. The wildcard asarUnpack pattern is the final stage where this manifests

