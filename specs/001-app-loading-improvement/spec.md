# Feature Specification: Improve Packaged Application Loading

**Feature Branch**: `001-app-loading-improvement`  
**Created**: 2025-10-27  
**Status**: Draft  
**Input**: User description: "Improve packaged application loading"

## Definitions

### Startup Performance Terms

- **Cold Start**: First application launch after installation or system reboot. No cached application data in memory or on disk. Measured from process start to interactive UI state.
- **Warm Start**: Subsequent application launch when OS caches (filesystem, memory) contain application data. Measured from process start to interactive UI state.
- **First Paint**: The moment when the application window first becomes visible to the user with any content rendered, even if not fully styled or interactive.
- **Interactive UI**: Application state where the user can successfully interact with primary UI elements (sidebar, navigation, command bar, main content area) and receive immediate visual feedback. Specifically: UI responds to click events within 100ms and navigation actions complete without loading delays.

## Clarifications

### Session 2025-10-27

- Q: Where should startup metrics be reported? → A: Console + Log File - metrics logged to both console and persistent file (e.g., ~/.fdo/logs/startup.log)
- Q: What recovery action should occur when window creation fails? → A: Error Dialog + Retry - show error with retry button allowing user to attempt relaunch without closing process
- Q: What threshold should trigger slow startup detection? → A: 4.5 seconds (150% of the 3-second target)
- Q: What should happen when launching the app while it's already running? → A: Single Instance - Focus Existing - bring existing window to front instead of launching new instance
- Q: How should "critical" vs "non-critical" assets be categorized? → A: Initial View Only - load all assets needed for home/dashboard screen; defer plugin UI, editor assets, settings screens until accessed

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fast Application Launch (Priority: P1)

As a DevOps engineer, when I launch the packaged FDO application (DMG/AppImage/installer version), I want it to open quickly so I can start working immediately without waiting.

**Why this priority**: Application launch time is the first user experience and directly impacts daily productivity. Slow launches cause frustration and reduce application adoption.

**Independent Test**: Can be fully tested by timing from clicking the FDO icon to seeing the interactive main window, measuring on various platforms (macOS, Linux, Windows) with packaged builds.

**Acceptance Scenarios**:

1. **Given** FDO is installed from the DMG/installer, **When** I launch the application for the first time (cold start), **Then** the main window appears and is interactive within 3 seconds
2. **Given** FDO has been launched previously, **When** I launch it again (warm start), **Then** the main window appears and is interactive within 2 seconds
3. **Given** I'm on a lower-spec machine (dual-core, 8GB RAM), **When** I launch FDO, **Then** it still launches within 6 seconds
4. **Given** FDO is already running, **When** I launch the application again (double-click icon), **Then** the existing window is brought to front and focused instead of opening a new instance

---

### User Story 2 - Smooth Initial Render (Priority: P1)

As a user, when the FDO window first appears, I want to see the complete UI immediately without blank screens or progressive rendering delays.

**Why this priority**: Blank screens or partially loaded UI create uncertainty about whether the application is working. Complete initial render provides confidence and immediate usability.

**Independent Test**: Can be fully tested by visually inspecting the first frame of the main window and verifying all UI elements (sidebar, navigation, command bar) are rendered and interactive.

**Acceptance Scenarios**:

1. **Given** FDO is launching, **When** the main window appears, **Then** all UI components (sidebar, navbar, main content area) are visible and styled correctly
2. **Given** the window has opened, **When** I attempt to interact with UI elements, **Then** they respond immediately without additional loading delays
3. **Given** FDO is starting, **When** the window appears, **Then** I do not see unstyled content (FOUC - Flash of Unstyled Content) or blank white screens

---

### User Story 3 - Efficient Resource Loading (Priority: P2)

As a user, I want the packaged application to load only essential resources at startup so the application doesn't consume excessive memory or CPU during launch.

**Why this priority**: Efficient resource management ensures FDO runs well on various hardware configurations and doesn't slow down other applications during startup.

**Independent Test**: Can be fully tested by monitoring process memory and CPU usage during startup and comparing against defined thresholds.

**Acceptance Scenarios**:

1. **Given** FDO is launching, **When** the application reaches the interactive state, **Then** memory usage is under 300MB (excluding loaded plugins)
2. **Given** FDO is starting, **When** monitoring CPU usage, **Then** average CPU usage stays below 60% on a dual-core system
3. **Given** large assets exist (icons, images, fonts), **When** the application loads, **Then** only assets needed for initial view are loaded immediately

---

### User Story 4 - Consistent Cross-Platform Performance (Priority: P2)

As a user on any supported platform (macOS, Linux, Windows), I want comparable startup performance so the experience is consistent regardless of my operating system.

**Why this priority**: Platform-specific performance issues create inconsistent user experiences and make some platforms feel like "second-class" implementations.

**Independent Test**: Can be fully tested by measuring startup times on all three platforms and verifying variance is within acceptable range (less than 30% difference between slowest and fastest platform).

**Acceptance Scenarios**:

1. **Given** identical hardware specs on macOS and Linux, **When** launching FDO on both platforms, **Then** startup times differ by no more than 1 second
2. **Given** the Windows build, **When** launching FDO, **Then** it starts within acceptable time despite Windows-specific security scans
3. **Given** any platform, **When** comparing packaged vs dev mode, **Then** packaged version starts at least as fast as dev mode

---

### Edge Cases

**Handled in Requirements**:
- **Corrupted Bundle**: FR-018 - System detects integrity issues and offers reinstall/repair
- **Missing Libraries**: FR-017 - System detects missing libraries and displays installation instructions
- **Antivirus Scanning**: FR-P03-Windows - System handles delays, acceptable time 3.5s
- **OS Heavy Load**: FR-019 - System maintains performance within 150% of target
- **Retry Failures**: FR-016 - System limits to 3 retries with exponential backoff
- **Screen Resolutions/DPI**: FR-002 - System renders complete UI on first paint (all resolutions)

**Not in Scope** (acceptable current behavior):
- Network failures during startup: Application is offline-capable, no network required for startup
- Disk full scenarios: OS-level issue, application cannot start if disk is full (acceptable failure mode)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST complete application launch (from process start to interactive UI) within 3 seconds for first launch (cold start)
- **FR-002**: System MUST render the complete main window with all UI components styled on first paint
- **FR-003**: System MUST lazy-load non-critical assets after initial render, where non-critical assets are defined as: plugin UI resources, editor components and assets, settings screens, live-ui components, and any features not displayed on the home/dashboard screen
- **FR-004**: System MUST minimize webpack bundle size by code splitting and removing unused dependencies
- **FR-005**: System MUST preload critical resources before showing window, where critical resources are defined as: window chrome, main application framework, home/dashboard screen components, navigation/sidebar, command bar, and all CSS/assets required for the initial view
- **FR-006**: System MUST cache compiled assets between launches to avoid redundant processing
- **FR-007**: System MUST optimize Electron packaging configuration to reduce bundle size and startup overhead
- **FR-008**: System MUST use native modules efficiently to avoid slow initialization paths
- **FR-009**: System MUST measure and report application startup time in development and production builds to both console (stdout) and persistent log file (e.g., ~/.fdo/logs/startup.log)
- **FR-010**: System MUST detect and report slow startup scenarios (startup time exceeding 4.5 seconds) for debugging, including context such as startup type (cold start vs warm start), platform, and hardware specs
- **FR-011**: System MUST handle window creation errors gracefully by displaying an error dialog with detailed error message and a "Retry" button that allows users to attempt window creation again without restarting the application process
- **FR-012**: System MUST ensure consistent startup performance across macOS, Linux, and Windows builds
- **FR-013**: System MUST implement single instance behavior - when the application is launched while already running, it MUST bring the existing window to front and focus it instead of creating a new instance
- **FR-014**: System MUST load critical assets in the following order: (1) window chrome and framework, (2) critical CSS and layout, (3) home screen components, (4) navigation and sidebar, (5) command bar. Total preload time for critical assets MUST NOT exceed 1 second.
- **FR-015**: System MUST implement asset cache invalidation based on application version - cached assets MUST be invalidated and reloaded when application version changes
- **FR-016**: System MUST limit window creation retry attempts to 3 attempts with exponential backoff (1s, 2s, 4s delays), after which the application MUST display a fatal error dialog with troubleshooting guidance
- **FR-017**: System MUST detect missing required system libraries at startup and display an error dialog specifying which libraries are missing and how to install them, rather than crashing silently
- **FR-018**: System MUST gracefully handle corrupted application bundles by detecting integrity issues at startup and offering to reinstall or repair the application
- **FR-019**: System MUST maintain acceptable startup performance (within 150% of target) when OS is under heavy load (80%+ CPU usage), degrading gracefully if necessary
- **FR-020**: System MUST measure startup time using `process.hrtime.bigint()` with measurement points at: process start, app ready, window created, window visible, renderer loaded, React mount complete, and app interactive
- **FR-021**: System MUST log startup metrics in NDJSON format (newline-delimited JSON) with fields: event, timestamp, elapsed, platform, arch, startupType, session, version, electronVersion
- **FR-022**: System MUST retain startup log files indefinitely (no automatic rotation) and document that users can manually archive or delete old logs
- **FR-023**: System MUST preserve all existing functionality during code splitting implementation - no features MUST be removed or broken during optimization
- **FR-024**: System MUST use Electron's `app.requestSingleInstanceLock()` API for single-instance behavior and handle `second-instance` events by restoring/focusing the existing window

### Platform-Specific Requirements

- **FR-P01-macOS**: System MUST handle macOS Gatekeeper verification delays on first launch, with acceptable startup time of 4 seconds for first launch on macOS (1s longer than other platforms due to signature verification)
- **FR-P02-macOS**: System MUST support both x64 (Intel) and arm64 (Apple Silicon) architectures with universal binaries, with startup performance targets applying equally to both
- **FR-P03-Windows**: System MUST handle Windows Defender and antivirus scanning delays, with acceptable startup time of 3.5 seconds when antivirus scanning is active
- **FR-P04-Windows**: System MUST support both NSIS installer and portable executable package formats with identical performance characteristics
- **FR-P05-Linux**: System MUST support AppImage, DEB, and RPM package formats with identical performance characteristics
- **FR-P06-Linux**: System MUST handle FUSE mounting delays for AppImage format, with acceptable startup time of 3.2 seconds for first AppImage launch

### Hardware Requirements

- **NFR-HW-001**: System MUST support minimum hardware: 4GB RAM, HDD (5400 RPM), dual-core 1.8GHz CPU, with degraded startup time target of 8 seconds
- **NFR-HW-002**: System MUST achieve optimal performance on standard hardware: 8GB RAM, SSD, dual-core 2.5GHz CPU, with 3-second cold start target
- **NFR-HW-003**: System MUST achieve enhanced performance on high-end hardware: 16GB+ RAM, NVMe SSD, quad-core 3.0GHz+ CPU, with 2-second cold start target

### Observability & Monitoring Requirements

- **NFR-OBS-001**: System MUST collect telemetry data for 95% consistency metric (SC-005) by recording all startup times and calculating percentile distributions
- **NFR-OBS-002**: System MUST provide performance regression detection by comparing current startup time against historical median and flagging regressions >10%
- **NFR-OBS-003**: System MUST integrate with webpack-bundle-analyzer and source-map-explorer for bundle analysis during development
- **NFR-OBS-004**: System MUST provide startup timeline visualization by outputting event sequence and durations in a format compatible with Chrome DevTools Performance timeline

### Recovery & Error Handling Requirements

- **NFR-REC-001**: System MUST handle asset loading failures by falling back to cached versions if available, or displaying specific error messages identifying which assets failed
- **NFR-REC-002**: System MUST handle corrupted asset cache by detecting cache integrity errors and automatically clearing and rebuilding cache
- **NFR-REC-003**: System MUST handle timeout scenarios by displaying a progress indicator if startup exceeds 3 seconds and allowing user to cancel startup after 10 seconds
- **NFR-REC-004**: System MUST define degraded performance mode: if optimization targets cannot be met, system MUST still provide functional application within 8 seconds maximum

### Optimization Constraints

- **NFR-OPT-001**: System MUST maintain backward compatibility - no breaking changes to plugin API, configuration format, or user data structures during optimization
- **NFR-OPT-002**: System MUST target main process bundle (dist/main/) and renderer process bundle (dist/renderer/) separately with optimization techniques appropriate to each
- **NFR-OPT-003**: System MUST apply bundle optimization techniques: tree shaking, code splitting, vendor chunk separation, common chunk extraction, and minification

### Key Entities

- **Startup Metrics**: Tracks launch time, bundle size, memory usage, CPU usage during startup
- **Asset Manifest**: Defines which resources are critical (home/dashboard screen: window chrome, framework, navigation, sidebar, command bar) vs lazy-loaded (plugin UI, editor, settings, live-ui - loaded on demand when accessed)
- **Build Configuration**: Webpack and electron-builder settings optimized for startup performance
- **Platform Profile**: Platform-specific optimizations and known performance characteristics

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Packaged application launches to interactive UI in under 3 seconds on standard hardware (8GB RAM, SSD, dual-core 2.5GHz+)
- **SC-002**: First paint (window visible) occurs within 1 second of process start
- **SC-003**: Application bundle size reduces by at least 20% through optimization (measured via webpack-bundle-analyzer before/after comparison)
- **SC-004**: Memory usage at startup (before plugins load) stays under 300MB (measured at app-interactive event)
- **SC-005**: 95% of users experience launch times within 1 second of median time (consistent performance, calculated from startup log telemetry over 100+ launches)
- **SC-006**: Zero instances of blank white screens lasting more than 500ms during startup (validated through automated visual regression testing)
- **SC-007**: Startup performance variance across platforms (macOS/Linux/Windows) is less than 30% (calculated as (max-min)/mean across platforms)
- **SC-008**: Cold start (first launch after install) takes no more than 2x warm start time (ratio validation: cold/warm ≤ 2.0)
- **SC-009**: Single-instance behavior works correctly on all platforms - second launch focuses existing window within 200ms (measured from second launch to window focus event)

## Assumptions

1. **Current Performance**: Packaged application currently takes 4-6 seconds to launch on average hardware (baseline to be measured using process.hrtime.bigint() instrumentation across 20+ launches on standard hardware before optimization begins)
2. **Build Configuration**: Current webpack and electron-builder configurations have optimization opportunities (to be validated via webpack-bundle-analyzer inspection)
3. **Asset Size**: Significant unused dependencies or assets are included in current builds (to be identified via bundle analysis)
4. **Platform Differences**: Each platform has unique characteristics that may require platform-specific optimizations (macOS Gatekeeper, Windows Defender, Linux FUSE mounting)
5. **User Hardware**: Target hardware is mainstream business laptops (8GB RAM, SSD, dual/quad-core CPUs) representing 80%+ of user base
6. **Electron Version**: Using Electron 37.2.6 with modern performance optimizations available (V8 engine, native module support, ASAR packaging)
7. **Development Environment**: Dev mode (npm start) provides baseline for comparison but may perform differently than packaged builds due to webpack dev server overhead and source maps
8. **Bundler Impact**: Webpack configuration significantly impacts bundle size and load performance (tree shaking, code splitting, minification can achieve 20-40% size reduction)

## Dependencies

- Profiling tools to measure startup performance (Electron DevTools, performance profiling)
- Understanding of current webpack configuration and bundle analysis
- Knowledge of electron-builder packaging options and optimizations
- Access to test hardware on all supported platforms (macOS, Linux, Windows)
- Metrics collection system to track startup performance over time

## Out of Scope

- Plugin loading performance (separate from core application launch)
- Runtime performance optimization after application has loaded
- UI redesign or functionality changes
- Changes to plugin API or architecture
- Auto-update mechanism implementation
- Memory usage optimization during runtime (focus is on startup)
