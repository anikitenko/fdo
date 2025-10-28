# Quick Start Guide - App Loading Optimization

**Feature**: 001-app-loading-improvement  
**Audience**: FDO developers implementing startup optimizations

---

## Overview

This guide provides quick reference commands and workflows for measuring, optimizing, and validating FDO application startup performance.

---

## 1. Measure Current Performance

### Run Startup Timing

```bash
# Development mode with metrics
npm start

# Look for console output:
# [STARTUP] process-start: 0ms
# [STARTUP] app-ready: 450ms
# [STARTUP] window-created: 780ms
# [STARTUP] app-interactive: 2850ms
```

### Check Startup Logs

```bash
# View all startup sessions
cat ~/.fdo/logs/startup.log | jq '.'

# Get latest startup time
tail -1 ~/.fdo/logs/startup.log | jq '.elapsed'

# Average cold start time (last 10 runs)
cat ~/.fdo/logs/startup.log | jq -s 'map(select(.startupType == "cold" and .event == "app-interactive")) | .[0:10] | map(.elapsed | tonumber) | add / length'

# Platform comparison
cat ~/.fdo/logs/startup.log | jq -s 'group_by(.platform) | map({platform: .[0].platform, avg: (map(.elapsed | tonumber) | add / length)})'
```

---

## 2. Analyze Bundle Size

### Generate Bundle Report

```bash
# Build with bundle analyzer
npm run build:analyze

# Open generated report
open dist/bundle-report.html

# Or use source-map-explorer
npm run build
npx source-map-explorer 'dist/renderer/*.js'
```

### Identify Large Dependencies

```bash
# Check dependency sizes
npx depsize

# List largest node_modules
du -sh node_modules/* | sort -rh | head -20

# Check specific package impact
npm ls @monaco-editor/react --depth=0
npm ls @xyflow/react --depth=0
```

---

## 3. Profile Startup

### Electron DevTools Timeline

1. Start app with `npm start`
2. Open DevTools: **View → Toggle Developer Tools**
3. Go to **Performance** tab
4. Click **Record** and restart app (**View → Reload**)
5. Stop recording when app is interactive
6. Analyze Main Thread timeline

### Node.js Profiling

```bash
# Start with CPU profiling
ELECTRON_RUN_AS_NODE=1 electron --cpu-prof src/main.js

# Analyze profile
node --prof-process isolate-*.log > profile.txt
less profile.txt
```

---

## 4. Add Lazy Loading

### Convert Component to Lazy Load

**Before** (synchronous import):
```javascript
// src/App.jsx
import EditorPage from './components/editor/EditorPage';

<Route path="/editor" element={<EditorPage />} />
```

**After** (lazy loading):
```javascript
// src/App.jsx
import { lazy, Suspense } from 'react';

const EditorPage = lazy(() => import('./components/editor/EditorPage'));

<Route path="/editor" element={
  <Suspense fallback={<div>Loading editor...</div>}>
    <EditorPage />
  </Suspense>
} />
```

### Verify Lazy Loading Works

1. Run `npm run build`
2. Check for separate chunks in `dist/renderer/`:
   ```bash
   ls -lh dist/renderer/*.js
   # Should see: main.js, vendors.js, editor.js, live-ui.js, etc.
   ```
3. Open app and check Network tab (DevTools)
4. Navigate to `/editor` - should see `editor.js` load on-demand

---

## 5. Optimize Dependencies

### Find Unused Dependencies

```bash
# Install depcheck
npm install -g depcheck

# Run analysis
depcheck

# Remove unused deps
npm uninstall <unused-package>
```

### Replace Heavy Dependencies

Common optimizations:
- `lodash` → `lodash-es` or individual imports (`lodash/get`)
- `moment` → `date-fns` or native `Intl`
- Large icon libraries → tree-shakeable alternatives

```bash
# Before
import _ from 'lodash';
_.get(obj, 'path');

# After
import get from 'lodash/get';
get(obj, 'path');
```

---

## 6. Test Packaged Build

### Build and Test on Local Platform

```bash
# Build distributable
npm run package

# macOS: Open DMG and test
open release/*.dmg

# Linux: Run AppImage
./release/*.AppImage

# Windows: Run portable exe
./release/*.exe
```

### Measure Packaged App Startup

```bash
# Run packaged app from terminal to see console output
# macOS
/Applications/FDO.app/Contents/MacOS/FDO

# Linux
./release/linux-unpacked/fdo

# Windows (PowerShell)
.\release\win-unpacked\FDO.exe

# Check startup time in logs
cat ~/.fdo/logs/startup.log | tail -1
```

---

## 7. Cross-Platform Testing

### Test on All Platforms

```bash
# Build for all platforms (requires macOS for DMG)
npm run package -- --mac --linux --win

# Distribute to testers
# macOS: release/*.dmg
# Linux: release/*.AppImage
# Windows: release/*.exe
```

### Performance Test Matrix

| Platform | Hardware | Expected Cold Start | Expected Warm Start |
|----------|----------|--------------------|--------------------|
| macOS (Intel) | 8GB RAM | <3s | <2s |
| macOS (Apple Silicon) | 8GB RAM | <2.5s | <1.8s |
| Linux (Ubuntu 22.04) | 8GB RAM | <3s | <2s |
| Windows 11 | 8GB RAM | <3.5s | <2.2s |

---

## 8. Common Issues & Fixes

### Issue: Startup time hasn't improved

**Check**:
1. Build production version: `npm run build` (not `npm start`)
2. Verify code splitting: Check for multiple chunks in `dist/renderer/`
3. Check bundle report: Run `npm run build:analyze`
4. Profile with DevTools: Identify actual bottleneck

### Issue: Lazy-loaded route shows blank screen

**Fix**:
```javascript
// Add loading fallback
<Suspense fallback={<div className="loading-spinner">Loading...</div>}>
  <LazyComponent />
</Suspense>
```

### Issue: "Module not found" after adding lazy loading

**Fix**: Ensure dynamic import path is relative:
```javascript
// ✅ Correct
const Editor = lazy(() => import('./components/editor/EditorPage'));

// ❌ Wrong
const Editor = lazy(() => import('components/editor/EditorPage'));
```

### Issue: Bundle size increased after optimization

**Check**:
- Did you add new dependencies?
- Run `npm ls` to check for duplicate dependencies
- Use `npm dedupe` to flatten dependency tree

### Issue: App crashes on specific platform

**Debug**:
```bash
# Enable verbose logging
export DEBUG=*
npm run package

# Check electron-builder output for packaging errors
cat release/builder-debug.yml
```

---

## 9. Performance Validation Checklist

Before merging optimization PR:

- [ ] Cold start <3s on test hardware (macOS, Linux, Windows)
- [ ] Warm start <2s on test hardware
- [ ] First paint <1s on test hardware
- [ ] Bundle size reduced by >=20% (check bundle report)
- [ ] Memory usage <300MB at startup (check DevTools Memory tab)
- [ ] No visual regressions (no FOUC, blank screens)
- [ ] Startup logs created at `~/.fdo/logs/startup.log`
- [ ] Console shows startup metrics during development
- [ ] All lazy-loaded routes work correctly
- [ ] Single-instance behavior works (try launching twice)
- [ ] All automated tests pass: `npm test`

---

## 10. Useful Commands Reference

```bash
# Development
npm start                          # Start dev mode with hot reload
npm run build                      # Production build
npm run build:analyze              # Build with bundle analysis
npm test                           # Run tests
npm run lint                       # Check code style

# Packaging
npm run package                    # Package for current platform
npm run package -- --mac           # Package for macOS only
npm run package -- --linux         # Package for Linux only
npm run package -- --win           # Package for Windows only

# Performance Analysis
npx depcheck                       # Find unused dependencies
npx depsize                        # Check dependency sizes
du -sh node_modules/*              # Check module sizes
cat ~/.fdo/logs/startup.log        # View startup logs

# Bundle Analysis
npx source-map-explorer 'dist/renderer/*.js'   # Analyze bundle composition
npx webpack-bundle-analyzer dist/renderer/stats.json  # Interactive treemap

# Profiling
ELECTRON_RUN_AS_NODE=1 electron --cpu-prof src/main.js  # CPU profile
node --prof-process isolate-*.log > profile.txt         # Process profile
```

---

## 11. Resources

### Documentation
- Webpack optimization: https://webpack.js.org/guides/production/
- Electron performance: https://www.electronjs.org/docs/latest/tutorial/performance
- React code splitting: https://react.dev/reference/react/lazy

### Tools
- webpack-bundle-analyzer: https://github.com/webpack-contrib/webpack-bundle-analyzer
- source-map-explorer: https://github.com/danvk/source-map-explorer
- electron-builder: https://www.electron.build/

### Related Specs
- [spec.md](./spec.md) - Feature specification
- [plan.md](./plan.md) - Implementation plan
- [research.md](./research.md) - Technical research
- [data-model.md](./data-model.md) - Data structures

---

## Need Help?

- Check [WARP.md](/WARP.md) for general development guide
- Review constitution at [.specify/memory/constitution.md](/.specify/memory/constitution.md)
- Ask in team chat or open GitHub issue

---

**Last Updated**: 2025-10-27  
**Maintained By**: FDO Core Team

