# Implementation Plan: Improve Packaged Application Loading

**Branch**: `001-app-loading-improvement` | **Date**: 2025-10-27 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-app-loading-improvement/spec.md`

## Summary

Optimize FDO's packaged application startup performance to achieve sub-3-second launch times through webpack bundle optimization, code splitting, critical resource preloading, and efficient Electron configuration. The implementation will focus on the core application bootstrap (not plugin loading), ensuring fast time-to-interactive across macOS, Linux, and Windows builds.

## Technical Context

**Language/Version**: JavaScript/TypeScript (Node.js via Electron 37.2.6)  
**Primary Dependencies**: Electron 37.2.6, React 18.3.1, webpack 5.101.0, electron-builder 25.1.8  
**Storage**: electron-store for configuration; Local log files for startup metrics (`~/.fdo/logs/startup.log`)  
**Testing**: Jest 30.0.5; Manual performance profiling with Electron DevTools  
**Target Platform**: Desktop (macOS 10.15+, Linux x64, Windows 10+)  
**Project Type**: Electron desktop application (main process + renderer process architecture)  
**Performance Goals**: 
- Cold start: <3 seconds to interactive UI
- Warm start: <2 seconds to interactive UI  
- First paint: <1 second from process start
- Bundle size reduction: 20%+ through optimization

**Constraints**: 
- Memory usage at startup: <300MB (before plugins load)
- CPU usage during startup: <60% average on dual-core systems
- Platform variance: <30% difference between macOS/Linux/Windows
- Startup metrics must log to both console and persistent file

**Scale/Scope**: 
- 3 platform builds (macOS DMG+ZIP, Linux DEB/RPM/AppImage, Windows NSIS/Portable)
- ~2000+ source files including node_modules
- Target hardware: 8GB RAM, SSD, dual-core 2.5GHz+

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Relevant Principles

✅ **III. Developer Experience First**: Optimizing startup time directly improves developer productivity. Fast application launch reduces friction in daily workflow.

✅ **V. Desktop-Native Platform**: Changes focus on Electron packaging and bundling optimizations specific to desktop architecture. Web-based approaches are explicitly out of scope.

✅ **IX. Test-First Development**: Performance measurements and startup metrics will be implemented before optimizations. Each optimization will be validated against defined thresholds (3s cold start, 2s warm start).

✅ **X. Observability, Versioning & Simplicity**: 
- Startup metrics logged to console + file for observability
- Semantic versioning applies (PATCH for performance improvements without API changes)
- Simple optimizations (bundle analysis, code splitting) preferred over complex solutions

### Gate Evaluation (Pre-Phase 0)

| Gate | Status | Evidence |
|------|--------|----------|
| **Test-First** | ✅ PASS | Metrics implementation before optimization; Performance profiling tools identified |
| **No Core Feature Logic** | ✅ PASS | This is infrastructure optimization (startup performance), not new features |
| **Documentation Before Implementation** | ✅ PASS | Spec complete with success criteria; This plan documents approach |
| **Observability** | ✅ PASS | Startup metrics to console + log file (~/.fdo/logs/startup.log) |
| **Breaking Changes** | ✅ PASS | No API changes; PATCH version bump appropriate |

**Verdict**: All gates pass. Proceed to Phase 0 research.

### Gate Re-Evaluation (Post-Phase 1)

*Re-checked after completing research.md, data-model.md, contracts/, and quickstart.md*

| Gate | Status | Evidence |
|------|--------|----------|
| **Test-First** | ✅ PASS | StartupMetrics API designed; Test strategy defined in research.md; Performance validation checklist in quickstart.md |
| **Plugin-First Architecture** | ✅ PASS | No plugin impact; Core application optimization only; Plugin loading unchanged |
| **Developer Experience First** | ✅ PASS | Startup metrics logged automatically; Bundle analysis tools integrated; quickstart.md provides clear workflows |
| **Declarative Metadata** | ✅ N/A | Not applicable - infrastructure optimization |
| **Process Isolation** | ✅ PASS | No changes to plugin isolation model; Optimization targets main/renderer processes only |
| **Observability** | ✅ PASS | Comprehensive metrics (StartupMetric, StartupLogEntry) with NDJSON logging; Console + file output |
| **Simplicity** | ✅ PASS | No new abstractions; Standard webpack/Electron optimizations; Minimal API surface (4 functions) |
| **Documentation Quality** | ✅ PASS | Complete plan, research, data model, contracts, quickstart generated |

**Verdict**: All gates pass. Design is constitutional. Ready to proceed to Phase 2 (/speckit.tasks).

## Project Structure

### Documentation (this feature)

```text
specs/001-app-loading-improvement/
├── spec.md             # Feature specification (complete)
├── plan.md             # This file (implementation plan)
├── research.md         # Phase 0: Technical research and decisions
├── data-model.md       # Phase 1: Startup metrics data structures
├── quickstart.md       # Phase 1: Quick reference for developers
├── contracts/          # Phase 1: API contracts (if needed)
└── checklists/
    └── requirements.md # Specification quality checklist
```

### Source Code (repository root)

FDO uses Electron desktop application structure with webpack bundling:

```text
src/
├── main.js                    # Electron main process entry (MODIFY: add metrics)
├── renderer.js                # Renderer process entry (MODIFY: lazy loading)
├── preload.js                 # Preload script (REVIEW: minimize operations)
├── App.jsx                    # React app root (MODIFY: code splitting)
├── Home.jsx                   # Home/dashboard (CRITICAL: preload)
├── components/                # UI components
│   ├── editor/               # Editor components (LAZY LOAD)
│   ├── live-ui/              # Live UI components (LAZY LOAD)
│   ├── plugin/               # Plugin UI (LAZY LOAD)
│   ├── CommandBar.jsx        # Command bar (CRITICAL: preload)
│   ├── SideBar.jsx           # Sidebar (CRITICAL: preload)
│   └── NavigationPluginsButton.jsx  # Navigation (CRITICAL: preload)
├── ipc/                      # IPC handlers (REVIEW: defer non-critical)
└── utils/                    # Utilities (REVIEW: tree-shake unused)

webpack.main.config.js         # MODIFY: optimize main process bundle
webpack.renderer.config.js     # MODIFY: code splitting, optimize bundle
webpack.preload.config.js      # REVIEW: minimize size
webpack.rules.js               # REVIEW: loader optimizations

package.json                   # MODIFY: add bundle analysis scripts

dist/                         # Build output
├── main/                     # Main process bundle
└── renderer/                 # Renderer process bundle
    └── assets/               # OPTIMIZE: lazy load non-critical assets

tests/
├── performance/              # NEW: startup performance tests
│   └── startup.test.js       # NEW: validate 3s target
└── integration/              # NEW: cross-platform launch tests
    └── launch.test.js        # NEW: test single-instance behavior
```

**Structure Decision**: FDO follows Electron's recommended multi-process architecture. Optimizations will target webpack configuration for bundle size reduction and React app structure for code splitting. The main process bundle (dist/main/) and renderer bundle (dist/renderer/) will be separately optimized. Critical path is: main.js → window creation → renderer.js → App.jsx → Home.jsx (initial view).

## Complexity Tracking

**No violations** - This feature aligns with existing architecture and constitution principles. All work is infrastructure optimization without introducing new patterns or abstractions.

---

## Phase 0: Research

### Research Tasks

1. **Webpack Bundle Analysis**
   - Current bundle sizes for main and renderer processes
   - Identify unused dependencies and tree-shaking opportunities
   - Large module analysis (which dependencies contribute most to bundle size)

2. **Electron Startup Profiling**
   - Current startup timeline (process start → window visible → interactive)
   - Bottlenecks identification (main process init, renderer load, React mount)
   - Platform-specific performance characteristics

3. **Code Splitting Strategies**
   - React lazy loading patterns for route-based splitting
   - Dynamic imports for large components (editor, live-ui)
   - Critical vs non-critical asset categorization

4. **Electron-Builder Optimization**
   - ASAR packaging configuration
   - Compression settings
   - Asset exclusion patterns

5. **Electron Single-Instance API**
   - `app.requestSingleInstanceLock()` implementation
   - Second-instance event handling
   - Window focus/restoration patterns

### Research Execution

See [research.md](./research.md) for detailed findings, decisions, and alternatives considered.

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) for:
- **StartupMetrics**: Structure for tracking launch performance
- **AssetManifest**: Critical vs lazy-loaded resource definitions
- **StartupLog**: Log file format for persistent metrics

### Contracts

**Internal APIs** (no external contracts - this is infrastructure):

1. **Startup Metrics Logger**
   - Input: Event name, timestamp, metadata
   - Output: Console log + file append
   - Location: `src/utils/startupMetrics.js` (NEW)

2. **Asset Categorization**
   - Critical assets list (home screen components)
   - Lazy load boundaries (editor, live-ui, settings)
   - Webpack configuration: entry points and chunks

3. **Single Instance Manager**
   - Check: `app.requestSingleInstanceLock()`
   - Action on second instance: Focus existing window
   - Location: `src/main.js` (MODIFY)

See [contracts/](./contracts/) directory for detailed API definitions (if external APIs are introduced).

### Quick Start

See [quickstart.md](./quickstart.md) for:
- How to measure startup performance locally
- How to analyze webpack bundles
- How to add new lazy-loaded routes
- How to update critical asset list

---

## Phase 2: Task Decomposition

**Note**: Phase 2 (task breakdown) is executed by `/speckit.tasks` command, not by `/speckit.plan`.

The tasks will be generated based on this plan and organized by:
1. Metrics implementation (measure before optimize)
2. Bundle analysis and optimization
3. Code splitting implementation
4. Electron configuration optimization
5. Single-instance behavior
6. Cross-platform testing
7. Documentation updates

---

## Implementation Notes

### Critical Path Analysis

**Target: 3 seconds from click to interactive**

Breakdown of ideal timeline:
- 0-500ms: Process start, Electron initialization
- 500ms-1000ms: Main process ready, create window
- 1000ms-2000ms: Renderer process load, React bootstrap
- 2000ms-3000ms: React mount, Home component render, interactive

**Optimization Priorities**:
1. **Highest Impact**: Webpack bundle size reduction (affects 1000ms-2000ms window)
2. **High Impact**: Code splitting (defer non-home components)
3. **Medium Impact**: Electron-builder config (affects 0-500ms startup)
4. **Low Impact**: Asset lazy loading (improves after-interactive performance)

### Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bundle optimization breaks build | High | Incremental changes with validation at each step |
| Code splitting breaks navigation | Medium | Keep fallback synchronous imports; test all routes |
| Platform-specific regressions | Medium | Test on all 3 platforms before merging |
| Metrics overhead slows startup | Low | Use high-resolution timers; file writes async |

### Success Validation

Each optimization will be validated against:
- ✅ Cold start <3s on test hardware
- ✅ Warm start <2s 
- ✅ First paint <1s
- ✅ Bundle size reduced 20%+
- ✅ Memory usage <300MB at startup
- ✅ Platform variance <30%
- ✅ Single-instance behavior works

---

## Next Steps

1. ✅ Phase 0: Complete research.md with bundle analysis and profiling data
2. ✅ Phase 1: Complete data-model.md and contracts
3. ⏭️ Run `/speckit.tasks` to generate task breakdown
4. ⏭️ Begin implementation following task priority order
