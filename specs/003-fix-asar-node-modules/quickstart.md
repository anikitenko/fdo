# Quickstart: Fix Missing Asset Node Modules

**Feature**: 003-fix-asar-node-modules  
**Target Audience**: Developers building and packaging FDO application

## Overview

This guide helps you ensure that asset dependencies (@anikitenko/fdo-sdk, @babel/standalone, goober) are correctly included in packaged FDO applications.

**Problem**: Webpack copies asset dependencies to `dist/renderer/assets/node_modules/`, but electron-builder was excluding them from the final ASAR archive, causing plugin runtime failures.

**Solution**: Configure electron-builder to include assets + add post-packaging validation.

---

## Quick Setup (5 Minutes)

### 1. Update Electron-Builder Configuration

**File**: `package.json` or `electron-builder.yml`

Add explicit `files` pattern to include assets:

```json
{
  "build": {
    "appId": "com.alexvwan.fdo",
    "files": [
      "dist/**/*",
      "!dist/**/*.map",
      "!**/node_modules/**",
      "dist/renderer/assets/node_modules/**/*"
    ]
  }
}
```

**Key Points**:
- `dist/renderer/assets/node_modules/**/*` **must come after** `!**/node_modules/**`
- Pattern order matters: later patterns override earlier ones
- This ensures assets are included despite global node_modules exclusion

---

### 2. Create Validation Script

**File**: `scripts/validate-asar-assets.js`

See [contracts/validation-api.md](./contracts/validation-api.md) for full specification.

**Quick Implementation**:
```javascript
#!/usr/bin/env node

const asar = require('@electron/asar');
const path = require('path');
const fs = require('fs');

// Platform-specific ASAR paths
const ASAR_PATHS = {
  mac: 'release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar',
  linux: 'release/linux-unpacked/resources/app.asar',
  win: 'release/win-unpacked/resources/app.asar'
};

async function validateAssets(platform) {
  // 1. Get ASAR path
  const asarPath = path.join(__dirname, '..', ASAR_PATHS[platform]);
  
  if (!fs.existsSync(asarPath)) {
    console.error(`❌ ASAR not found: ${asarPath}`);
    process.exit(2);
  }
  
  // 2. Load webpack config
  const webpackConfig = require('../webpack.renderer.config.js');
  const copyPlugin = webpackConfig.plugins.find(
    p => p.constructor.name === 'CopyWebpackPlugin'
  );
  
  const expectedAssets = copyPlugin.patterns.map(p => 
    `renderer/${p.to}`
  );
  
  // 3. Read ASAR contents
  const files = await asar.listPackage(asarPath);
  const assetFiles = files.filter(f => 
    f.startsWith('renderer/assets/node_modules/')
  );
  
  // 4. Check each expected asset
  const missingAssets = expectedAssets.filter(expected =>
    !assetFiles.some(f => f.startsWith(expected))
  );
  
  // 5. Report results
  if (missingAssets.length === 0) {
    console.log('✅ ASAR Asset Validation Passed');
    console.log(`Assets Found: ${expectedAssets.length}/${expectedAssets.length}`);
    process.exit(0);
  } else {
    console.error('❌ ASAR Asset Validation Failed');
    console.error('\nMissing Assets:');
    missingAssets.forEach(a => console.error('  ✗', a));
    console.error('\nExpected:', expectedAssets);
    console.error('Found:', assetFiles.slice(0, 5), '...');
    process.exit(1);
  }
}

// Parse CLI args
const platform = process.argv.find(a => a.startsWith('--platform='))?.split('=')[1];
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  console.error('Usage: node validate-asar-assets.js --platform=<mac|linux|win>');
  process.exit(2);
}

validateAssets(platform).catch(err => {
  console.error('❌ Validation error:', err.message);
  process.exit(2);
});
```

**Install dependencies**:
```bash
npm install --save-dev @electron/asar
```

---

### 3. Update Build Scripts

**File**: `package.json`

Add validation to each platform build:

```json
{
  "scripts": {
    "build": "webpack --config webpack.main.config.js && webpack --config webpack.renderer.config.js && webpack --config webpack.preload.config.js",
    "dist:mac": "npm run build && electron-builder --mac && npm run validate:asar -- --platform=mac",
    "dist:linux": "npm run build && electron-builder --linux && npm run validate:asar -- --platform=linux",
    "dist:win": "npm run build && electron-builder --win && npm run validate:asar -- --platform=win",
    "validate:asar": "node scripts/validate-asar-assets.js"
  }
}
```

---

## Usage

### Build with Validation

```bash
# macOS
npm run dist:mac

# Linux
npm run dist:linux

# Windows
npm run dist:win
```

**What happens**:
1. Webpack builds and copies assets to `dist/renderer/assets/node_modules/`
2. electron-builder packages into ASAR with assets included
3. Validation script checks ASAR contents
4. Build succeeds (exit 0) or fails (exit 1)

### Manual Validation

```bash
# After building
node scripts/validate-asar-assets.js --platform=mac --verbose
```

### Verify Assets Manually

```bash
# Extract ASAR to inspect contents
npx @electron/asar extract \
  "release/mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar" \
  /tmp/asar-contents

# Check assets
ls -la /tmp/asar-contents/renderer/assets/node_modules/
```

---

## Verification Checklist

After implementing the fix:

- [ ] electron-builder config includes `dist/renderer/assets/node_modules/**/*` pattern
- [ ] Pattern comes **after** `!**/node_modules/**` exclusion
- [ ] Validation script exists at `scripts/validate-asar-assets.js`
- [ ] `@electron/asar` is installed as dev dependency
- [ ] Build scripts include validation step
- [ ] Run `npm run dist:mac` (or your platform) successfully
- [ ] Validation reports "✅ ASAR Asset Validation Passed"
- [ ] Manually extract ASAR and verify `renderer/assets/node_modules/` exists
- [ ] Test plugin functionality in packaged app

---

## Troubleshooting

### Issue: "ASAR not found"

**Symptoms**: Validation script exits with code 2, message "ASAR not found: ..."

**Causes**:
- electron-builder didn't run
- Platform argument doesn't match actual build
- Custom build output directory

**Fix**:
```bash
# Verify electron-builder completed
ls -la release/

# Check actual ASAR location
find release/ -name "app.asar"

# Use custom path
node scripts/validate-asar-assets.js --platform=mac --asar-path=/path/to/app.asar
```

---

### Issue: "Assets missing from ASAR"

**Symptoms**: Validation fails with missing assets listed

**Causes**:
1. Webpack didn't copy assets
2. electron-builder excluded assets
3. Pattern order in `files` config

**Diagnostic Steps**:
```bash
# Step 1: Verify webpack created assets
npm run build
ls -la dist/renderer/assets/node_modules/
# Should show: @anikitenko/, @babel/, goober/

# Step 2: Check electron-builder config
cat package.json | grep -A 10 '"build"'
# Ensure: "dist/renderer/assets/node_modules/**/*" is present

# Step 3: Verify pattern order
# Must be: exclusion first, inclusion after
# WRONG: ["dist/renderer/assets/node_modules/**/*", "!**/node_modules/**"]
# RIGHT: ["!**/node_modules/**", "dist/renderer/assets/node_modules/**/*"]
```

**Fix**:
1. If webpack didn't create assets → Check `webpack.renderer.config.js` CopyWebpackPlugin
2. If assets exist but not in ASAR → Fix electron-builder `files` patterns
3. Re-run build: `npm run dist:mac`

---

### Issue: "Webpack config not found"

**Symptoms**: Validation script exits with code 2, "Failed to parse webpack configuration"

**Causes**:
- Webpack config path incorrect
- Config has syntax errors
- Config exports function but script doesn't call it

**Fix**:
```javascript
// In validate-asar-assets.js, handle both object and function exports:
let webpackConfig = require('../webpack.renderer.config.js');
if (typeof webpackConfig === 'function') {
  webpackConfig = webpackConfig({}, { mode: 'production' });
}
```

---

### Issue: Build succeeds but plugins still fail

**Symptoms**: Validation passes, but plugins can't access SDK types/Babel/goober at runtime

**Diagnosis**:
```bash
# Extract ASAR and check actual file presence (not just directories)
npx @electron/asar extract "release/.../app.asar" /tmp/check
find /tmp/check/renderer/assets/node_modules -type f | head -20
```

**Possible Causes**:
- Assets directory exists but files are missing (globOptions filtered too much)
- Runtime path resolution incorrect
- ASAR protocol not working

**Fix**:
1. Verify files (not just directories) exist in extracted ASAR
2. Check plugin code uses correct relative paths
3. Test in packaged app with DevTools console open

---

## Testing the Fix

### Test 1: Validation Detects Missing Assets

**Purpose**: Verify validation fails when assets are excluded

**Steps**:
1. Temporarily comment out `dist/renderer/assets/node_modules/**/*` in package.json
2. Run `npm run dist:mac`
3. **Expected**: Build fails with validation error listing missing assets
4. Restore pattern and rebuild

**Pass Criteria**: Build fails with clear error message

---

### Test 2: Plugin Functionality

**Purpose**: Verify plugins can access assets at runtime

**Steps**:
1. Create test plugin:
```typescript
import { FDO_SDK } from '@anikitenko/fdo-sdk';

class TestPlugin extends FDO_SDK {
  render() {
    // Test: SDK types available
    const types = require('./assets/node_modules/@anikitenko/fdo-sdk/index.d.ts');
    
    // Test: Babel available
    const Babel = require('./assets/node_modules/@babel/standalone/babel.js');
    
    // Test: Goober available
    const { css } = require('./assets/node_modules/goober');
    
    return '<div>Assets test passed</div>';
  }
}
```
2. Build and package app: `npm run dist:mac`
3. Install and activate test plugin
4. **Expected**: No runtime errors, plugin loads successfully

**Pass Criteria**: Plugin executes without missing module errors

---

## Maintenance

### When Adding New Asset Dependencies

**Scenario**: You add a new library that needs to be in `assets/node_modules/`

**Steps**:
1. Add CopyWebpackPlugin pattern to `webpack.renderer.config.js`:
```javascript
{
  from: path.resolve(__dirname, "node_modules/newlib"),
  to: "assets/node_modules/newlib"
}
```
2. Run build: `npm run dist:mac`
3. **Automatic**: Validation script reads updated webpack config and checks for new asset
4. If validation fails, check electron-builder `files` patterns

**No Code Changes Needed**: Validation automatically synchronizes with webpack patterns (FR-007)

---

### When Changing Asset Paths

**Scenario**: You reorganize assets directory structure

**Steps**:
1. Update webpack CopyWebpackPlugin `to` paths
2. Update any runtime code referencing asset paths
3. Re-run validation: `npm run validate:asar -- --platform=mac`
4. Validation automatically adapts to new paths

---

## Performance

**Expected Validation Time**: < 5 seconds (per SC-004)

**Breakdown**:
- Parse webpack config: ~100ms
- Read ASAR file list: ~2s (for ~100MB ASAR)
- Compare paths: ~50ms
- Generate report: ~50ms
- **Total**: ~2.2s typical, <5s worst case

**Note**: Validation runs **after** electron-builder, so it adds to total build time but doesn't slow down packaging itself.

---

## Success Verification

✅ **You've successfully implemented the fix when**:

1. Build completes without errors
2. Validation reports "Assets Found: 3/3"
3. Manual ASAR extraction shows `renderer/assets/node_modules/` with all three packages
4. Packaged app plugins can import from SDK, use Babel, apply goober styles
5. Adding webpack patterns auto-updates validation expectations

---

## Next Steps

- **Implement**: Follow this guide to apply the fix
- **Test**: Run all test scenarios above
- **Document**: Update team documentation if custom build process exists
- **CI/CD**: Ensure validation runs in continuous integration pipeline

For detailed implementation tasks, see `tasks.md` (generated via `/speckit.tasks`).

For technical deep-dive, see [research.md](./research.md) and [data-model.md](./data-model.md).

---

## Support

**Questions or Issues?**
- Check [research.md](./research.md) for technical decisions and alternatives
- See [contracts/validation-api.md](./contracts/validation-api.md) for validation script details
- Review [data-model.md](./data-model.md) for data structures and constraints

**Validation failing unexpectedly?**
- Run with `--verbose` flag: `npm run validate:asar -- --platform=mac --verbose`
- Manually extract ASAR and inspect contents
- Verify webpack build created assets: `ls -la dist/renderer/assets/node_modules/`

