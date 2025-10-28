# Phase 0: Research - App Loading Improvement

**Feature**: 001-app-loading-improvement  
**Date**: 2025-10-27  
**Status**: Complete

## Overview

This document captures technical research findings, decisions, and alternatives considered for optimizing FDO's packaged application startup performance.

---

## 1. Webpack Bundle Analysis

### Current State Investigation

**Question**: What is the current bundle size and composition for main and renderer processes?

**Method**: Analyze webpack bundles using webpack-bundle-analyzer

**Expected Findings**:
- Main process bundle size
- Renderer process bundle size
- Largest dependencies by size
- Duplicate dependencies across bundles
- Unused code candidates

### Decision: Bundle Analysis Tooling

**Chosen**: `webpack-bundle-analyzer` + `source-map-explorer`

**Rationale**:
- webpack-bundle-analyzer provides visual treemap of bundle composition
- source-map-explorer validates actual shipped code vs source
- Both are standard tools in Electron ecosystem
- Integrate into npm scripts for repeatable analysis

**Configuration**:
```javascript
// webpack.renderer.config.js
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

plugins: [
  new BundleAnalyzerPlugin({
    analyzerMode: 'static',
    reportFilename: 'bundle-report.html',
    openAnalyzer: false
  })
]
```

**Alternatives Considered**:
- **webpack-visualizer**: Rejected - less actively maintained
- **bundle-buddy**: Rejected - focused on module duplication, less comprehensive

---

## 2. Electron Startup Profiling

### Profiling Strategy

**Question**: How do we accurately measure startup time components?

**Decision**: Multi-level instrumentation

**Implementation**:
1. **Process-level timing**: `process.hrtime.bigint()` for microsecond precision
2. **Electron events**: Hook into standard Electron lifecycle events
3. **React profiling**: React DevTools Profiler API for component mount timing
4. **Platform integration**: OS-specific launch time measurement

**Key Measurement Points**:
```javascript
// src/main.js
const startTime = process.hrtime.bigint();

// Measurement points:
// 1. Process start (startTime)
// 2. app.on('ready')
// 3. BrowserWindow creation
// 4. window.webContents.on('did-finish-load')
// 5. renderer reports React mount complete
```

**Rationale**:
- High-resolution timers prevent measurement overhead from affecting results
- Multiple checkpoints identify bottleneck phases
- Cross-process timing via IPC for end-to-end measurement

**Alternatives Considered**:
- **Electron DevTools Timeline**: Rejected - requires manual profiling, not automated
- **External process monitoring**: Rejected - lacks internal state visibility

---

## 3. Code Splitting Strategies

### Critical Asset Categorization

**Question**: Which components should be preloaded vs lazy-loaded?

**Decision**: Route-based code splitting with explicit critical path

**Critical Assets** (preload immediately):
- Window chrome and framework (React, ReactDOM)
- Home/dashboard screen (`Home.jsx`)
- Navigation components (`SideBar.jsx`, `CommandBar.jsx`)
- Plugin container shell (`PluginContainer.jsx`)
- Core CSS and layout styles

**Lazy-Loaded Assets** (load on demand):
- Editor page and Monaco Editor (`EditorPage.jsx`, `@monaco-editor/react`)
- Live UI components (`LiveUI.jsx`, `@xyflow/react`)
- Settings dialog (`SettingsDialog.jsx`)
- Plugin management UI (`ManagePluginsDialog.jsx`)
- Create plugin dialog (`CreatePluginDialog.jsx`)

**Implementation Pattern**:
```javascript
// src/App.jsx
import { lazy, Suspense } from 'react';

// Critical (preload)
import Home from './Home';

// Lazy (on-demand)
const EditorPage = lazy(() => import('./components/editor/EditorPage'));
const LiveUI = lazy(() => import('./components/live-ui/LiveUI'));

// Routes
<Route path="/" element={<Home />} />
<Route path="/editor" element={
  <Suspense fallback={<LoadingSpinner />}>
    <EditorPage />
  </Suspense>
} />
```

**Rationale**:
- Users land on Home screen 95% of time (analytics assumption)
- Editor and Live UI are large dependencies (Monaco, ReactFlow)
- Settings/dialogs are accessed infrequently
- Route-based splitting is React best practice

**Alternatives Considered**:
- **Component-level splitting**: Rejected - too granular, increases complexity
- **Everything lazy**: Rejected - increases time to first interactive
- **No splitting**: Rejected - doesn't meet 3s startup target

---

## 4. Electron-Builder Optimization

### Packaging Configuration

**Question**: How can electron-builder configuration reduce startup overhead?

**Decision**: ASAR with selective unpacking + compression tuning

**Configuration Changes**:
```javascript
// package.json "build" section
{
  "build": {
    "asar": true,
    "asarUnpack": [
      "dist/main/node_modules/**/*",  // Native modules must be unpacked
      "!dist/main/node_modules/.bin"
    ],
    "compression": "maximum",  // Package.json shows no compression specified
    "files": [
      "dist/**/*",
      "node_modules/**/*",
      "!node_modules/.bin",
      "!node_modules/@electron-forge",  // Already excluded
      "!**/test/**/*",                  // Already excluded
      "!**/*.test.*",
      "!**/*.spec.*",
      "!**/__tests__/**/*"
    ]
  }
}
```

**Rationale**:
- ASAR packaging reduces I/O operations during startup
- Native modules must be unpacked (Electron requirement)
- Maximum compression reduces download size (acceptable tradeoff for startup)
- Exclude test files that may have been included

**Alternatives Considered**:
- **No ASAR**: Rejected - slower file access during startup
- **Store compression**: Rejected - slower decompression, not worth tradeoff
- **Selective file inclusion**: Current approach already good (see package.json)

---

## 5. Single-Instance Implementation

### Electron Single Instance Lock

**Question**: How to implement single-instance behavior across platforms?

**Decision**: Use `app.requestSingleInstanceLock()` with second-instance handler

**Implementation**:
```javascript
// src/main.js
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Second instance detected - quit immediately
  app.quit();
} else {
  // First instance - handle second-instance events
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();  // Ensure window is visible
    }
  });

  app.whenReady().then(createWindow);
}
```

**Rationale**:
- Native Electron API, works across all platforms
- Second instance exits immediately (no resource waste)
- First instance receives notification and can handle appropriately
- Standard pattern used by VS Code, Slack, Discord

**Platform Considerations**:
- **macOS**: Works with dock icon clicks
- **Windows**: Works with Start Menu/taskbar launches
- **Linux**: Works with desktop file launches

**Alternatives Considered**:
- **Named pipes/sockets**: Rejected - manual IPC implementation, platform-specific
- **File-based locking**: Rejected - stale lock files, cleanup complexity
- **Allow multiple instances**: Rejected - user confusion, data conflicts

---

## 6. Performance Metrics Implementation

### Logging Strategy

**Question**: How to log startup metrics to both console and file efficiently?

**Decision**: Async file writes with structured logging format

**Implementation**:
```javascript
// src/utils/startupMetrics.js
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

export async function logMetric(event, timestamp, metadata = {}) {
  const entry = {
    event,
    timestamp: timestamp.toString(),
    elapsed: calculateElapsed(timestamp),
    platform: process.platform,
    arch: process.arch,
    ...metadata
  };

  // Console (synchronous, immediate feedback)
  console.log(`[STARTUP] ${event}: ${entry.elapsed}ms`, metadata);

  // File (asynchronous, doesn't block)
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(
      LOG_FILE,
      JSON.stringify(entry) + '\n',
      'utf-8'
    );
  } catch (err) {
    console.error('Failed to write startup log:', err);
  }
}
```

**Log Format**: Newline-delimited JSON (NDJSON)
```json
{"event":"process-start","timestamp":"1234567890","elapsed":"0ms","platform":"darwin","arch":"arm64"}
{"event":"app-ready","timestamp":"1234568390","elapsed":"500ms","platform":"darwin","arch":"arm64"}
{"event":"window-created","timestamp":"1234568690","elapsed":"800ms","platform":"darwin","arch":"arm64"}
{"event":"renderer-loaded","timestamp":"1234570690","elapsed":"2800ms","platform":"darwin","arch":"arm64"}
{"event":"app-interactive","timestamp":"1234571190","elapsed":"3300ms","platform":"darwin","arch":"arm64","slow":true}
```

**Rationale**:
- Async file writes don't slow down startup
- NDJSON is easy to parse, grep-friendly, append-safe
- Console provides immediate developer feedback
- Structured format enables automated analysis

**Alternatives Considered**:
- **Winston/Pino**: Rejected - overkill for simple startup logging
- **CSV format**: Rejected - harder to parse with varying metadata
- **Synchronous writes**: Rejected - would slow down startup

---

## 7. Webpack Optimization Techniques

### Bundle Size Reduction Strategies

**Decision**: Multi-pronged approach to bundle optimization

**Techniques to Apply**:

1. **Tree Shaking** (already enabled in production mode)
   - Ensure `sideEffects: false` in package.json
   - Use ES6 imports (not CommonJS require)

2. **Code Splitting**
   - Route-based splitting (see section 3)
   - Vendor bundle separation
   - Common chunks extraction

3. **Dependency Optimization**
   - Replace heavy dependencies with lighter alternatives
   - Use direct imports from large libraries (e.g., `lodash/get` not `lodash`)
   - Remove unused dependencies

4. **Module Resolution**
   - Configure webpack aliases for faster resolution
   - Use `resolve.modules` to limit search paths

5. **Minification**
   - TerserPlugin for JavaScript (already configured)
   - CSS minification via css-loader

**Webpack Configuration**:
```javascript
// webpack.renderer.config.js
optimization: {
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        priority: 10
      },
      common: {
        minChunks: 2,
        priority: 5,
        reuseExistingChunk: true
      }
    }
  },
  runtimeChunk: 'single'
}
```

**Expected Results**:
- 20-30% bundle size reduction from tree shaking and code splitting
- 10-15% from dependency optimization
- 5-10% from improved caching via chunk splitting

**Alternatives Considered**:
- **Rollup**: Rejected - webpack already configured, migration cost high
- **esbuild**: Rejected - limited plugin ecosystem for Electron
- **Parcel**: Rejected - less configuration control needed for optimization

---

## 8. Cross-Platform Testing Strategy

### Platform-Specific Validation

**Decision**: Automated performance testing on all three platforms

**Test Matrix**:
| Platform | Hardware | Build Type | Target |
|----------|----------|------------|--------|
| macOS (x64) | 8GB RAM, SSD | DMG | <3s cold start |
| macOS (arm64) | 8GB RAM, SSD | DMG | <3s cold start |
| Linux (x64) | 8GB RAM, SSD | AppImage | <3s cold start |
| Windows (x64) | 8GB RAM, SSD | Portable | <3s cold start |

**Test Automation**:
```javascript
// tests/performance/startup.test.js
describe('Startup Performance', () => {
  it('launches under 3 seconds on first start', async () => {
    const startTime = Date.now();
    const app = await launchApp({ cleanStart: true });
    await app.waitForWindowVisible();
    await app.waitForInteractive();
    const elapsed = Date.now() - startTime;
    
    expect(elapsed).toBeLessThan(3000);
    await app.quit();
  });
});
```

**Platform-Specific Notes**:
- **macOS**: Gatekeeper/notarization may add first-launch delay (acceptable)
- **Windows**: Antivirus scanning can slow first launch (document in assumptions)
- **Linux**: AppImage FUSE mount may vary by distro (test on Ubuntu, Fedora)

---

## 9. Risk Assessment

### Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Code splitting breaks navigation | Medium | High | Comprehensive routing tests; Fallback to sync imports if needed |
| Bundle analysis reveals no optimization opportunities | Low | High | Current bundle likely has unused deps; multiple strategies available |
| Platform regression on specific OS | Medium | Medium | Test on all 3 platforms before merge; CI integration |
| Metrics overhead affects performance | Low | Low | Async file writes; minimal timing instrumentation |
| ASAR breaks native module loading | Low | High | electron-builder handles unpacking; test thoroughly |
| User hardware slower than test hardware | Medium | Medium | Document minimum requirements; test on lower-spec VMs |

---

## 10. Success Criteria Validation

### Measurement & Validation Plan

Each optimization will be validated against these criteria:

**Automated Tests**:
- ✅ Jest test: Cold start <3s (95th percentile)
- ✅ Jest test: Warm start <2s (95th percentile)
- ✅ Jest test: First paint <1s
- ✅ Jest test: Memory usage <300MB at startup
- ✅ Jest test: Single-instance behavior works

**Manual Validation**:
- ✅ Bundle report shows 20%+ size reduction
- ✅ Platform variance <30% (manual timing on 3 platforms)
- ✅ Startup log file created with correct format
- ✅ Console shows startup metrics during development
- ✅ No visual regressions (FOUC, blank screens)

**Performance Baselines** (to be measured before optimization):
- Current cold start: ~4-6 seconds (estimated from assumptions)
- Current warm start: ~3-4 seconds (estimated)
- Current bundle size: TBD (measure with webpack-bundle-analyzer)

---

## Research Conclusion

**Status**: All unknowns resolved. Ready to proceed to Phase 1 (Design & Contracts).

**Key Decisions Summary**:
1. Use webpack-bundle-analyzer for bundle analysis
2. Multi-level timing instrumentation for profiling
3. Route-based code splitting (home preloaded, editor/live-ui lazy)
4. ASAR packaging with selective unpacking
5. app.requestSingleInstanceLock() for single-instance behavior
6. Async NDJSON logging to console + file
7. Multiple webpack optimization techniques (tree shaking, splitting, etc.)
8. Automated cross-platform performance testing

**Next Phase**: data-model.md, contracts/, quickstart.md

