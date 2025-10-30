# Feature Specification: Fix UI Test Launches and Address Failing Tests

**Feature Branch**: `001-fix-ui-tests`  
**Created**: October 30, 2025  
**Status**: Draft  
**Input**: User description: "UI test launches must be fixed and addressed all failing UI tests"

## Clarifications

### Session 2025-10-30

- Q: When multiple test runs occur on the same machine and port 9555 is already in use, should the system fail immediately, queue and wait, or auto-select another port? → A: Fail immediately with error message indicating port conflict and suggesting to check for running Electron processes
- Q: What timing strategy should be used between Electron launch retry attempts (immediate, linear backoff, or exponential backoff)? → A: Wait 2 seconds between each retry attempt (linear backoff: 2s, 2s, 2s)
- Q: How should the system handle cleanup failures (e.g., Electron unresponsive, port not released) after tests finish? → A: Log error and attempt force-kill (SIGKILL) of Electron before continuing
- Q: Which machine-readable test report format should CI use? → A: JUnit XML
- Q: What should happen if Monaco content is still unavailable after the 2s polling window? → A: Fail the test with detailed diagnostics (models, active file path, last errors)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developers Run E2E Tests Locally (Priority: P1)

Developers need to run end-to-end tests on their local machines to verify UI behavior before committing code. Currently, Electron launch behavior is intermittent in sandboxed environments, causing tests to fail unpredictably even when the application code is correct.

**Why this priority**: Reliable local testing is critical for development workflow. Developers cannot confidently verify their changes if tests fail randomly due to infrastructure issues rather than code problems.

**Independent Test**: Can be fully tested by running `npm run test:e2e` multiple times in succession and verifying that Electron launches successfully and all tests execute (success rate should be >95%).

**Acceptance Scenarios**:

1. **Given** a developer runs `npm run test:e2e` on macOS, **When** the test command executes, **Then** Electron launches successfully within 5 seconds and the WebSocket test server starts on port 9555
2. **Given** Electron has launched for testing, **When** the test suite runs, **Then** at least 95% of test runs succeed without launch failures
3. **Given** a test run completes, **When** the developer reviews results, **Then** any failures are due to actual code issues, not environment/launch problems

---

### User Story 2 - UI Tests Validate Editor Content Display (Priority: P1)

The application must display file content in the Monaco editor both after initial plugin creation and after version switches. Currently, two E2E tests are failing because index file content is not visible in the editor, even though the editor UI loads correctly.

**Why this priority**: Content not appearing in the editor is a critical user-facing bug. Users cannot work with files if content doesn't display, making this a blocker for the core functionality.

**Independent Test**: Can be fully tested by creating a plugin, opening the editor, and verifying that `index.ts`/`index.js` content appears in Monaco. Then switch between snapshot versions and verify content remains visible.

**Acceptance Scenarios**:

1. **Given** a user creates a new plugin and opens the editor, **When** the editor page loads, **Then** the default `index.ts` file content appears within 2 seconds
2. **Given** the editor is displaying a file, **When** the user switches to a different snapshot version, **Then** the file content for that version appears within 3 seconds
3. **Given** content should be displayed, **When** Monaco editor models are queried, **Then** at least one model contains non-empty content for the index file

---

### User Story 3 - Skeleton Loading States Work Correctly (Priority: P2)

The application shows skeleton loading animations during version switches but not during initial silent loads. Previous issues with skeleton flickering (multiple rapid on/off transitions) have been partially addressed, but tests need to verify the fix is complete and stable.

**Why this priority**: Loading states provide critical user feedback. Flickering creates a poor user experience and indicates unstable state management. This is important but less critical than content display issues.

**Independent Test**: Can be fully tested by monitoring skeleton class changes during initial load and version switches, counting transitions, and verifying timing requirements (<200ms for appearance).

**Acceptance Scenarios**:

1. **Given** the editor loads for the first time, **When** background restoration occurs, **Then** skeleton loading state never appears (silent load)
2. **Given** a user switches snapshot versions, **When** the switch begins, **Then** skeleton appears within 200ms and transitions exactly twice (OFF→ON→OFF)
3. **Given** skeleton is monitoring during operations, **When** state changes occur, **Then** no flickering (more than 2 transitions) is detected

---

### User Story 4 - CI/CD Pipeline Runs Tests Reliably (Priority: P2)

Automated tests must run reliably in GitHub Actions or other CI environments to catch regressions before code merges. The test infrastructure should work consistently in headless Linux environments using Xvfb or similar virtual display solutions.

**Why this priority**: Automated testing in CI prevents bugs from reaching production. While important, local testing (P1) is more immediately critical for active development.

**Independent Test**: Can be fully tested by configuring GitHub Actions workflow with Ubuntu runner, Xvfb, and running the full test suite. Success means consistent pass/fail results across multiple runs.

**Acceptance Scenarios**:

1. **Given** tests run in a GitHub Actions Ubuntu environment, **When** Xvfb provides a virtual display, **Then** Electron launches successfully and all tests execute
2. **Given** the same code is tested multiple times in CI, **When** no code changes occur between runs, **Then** test results are deterministic (same tests pass/fail)
3. **Given** CI tests complete, **When** developers review the results, **Then** clear logs indicate which tests passed/failed and why

---

### Edge Cases

- What happens when Electron fails to launch after multiple retry attempts? System should provide clear error messages indicating whether the issue is environmental (sandbox/permissions) or code-related.
- How does the system handle concurrent test runs on the same machine? Tests must fail immediately when port 9555 is already in use, displaying an error message that indicates the port conflict and suggests checking for running Electron processes.
- What happens when Monaco editor takes longer than expected to initialize? Tests should implement exponential backoff polling rather than fixed timeouts to accommodate varying system performance.
- How do tests behave when file content is partially loaded? Tests should verify complete content presence, not just that content exists, to catch truncation bugs.
- What happens during rapid version switches (user clicks multiple times)? Application should prevent concurrent restore operations through operation locking mechanisms.

## Requirements *(mandatory)*

### Functional Requirements

#### Test Infrastructure

- **FR-001**: System MUST launch Electron reliably (>95% success rate) in test mode on macOS development machines
- **FR-002**: System MUST start WebSocket test server on port 9555 when `ELECTRON_TEST_MODE=true` environment variable is set
- **FR-003**: System MUST detect and report when Electron fails to launch within 30 seconds with clear error messaging
- **FR-004**: System MUST implement retry logic (up to 3 attempts) for Electron launch failures before reporting test failure, with 2 seconds wait between each retry attempt
- **FR-005**: System MUST validate that WebSocket server is accepting connections before proceeding with test execution
- **FR-005a**: System MUST fail immediately with clear error message when port 9555 is already in use, indicating port conflict and suggesting checking for running Electron processes

#### Content Display

 - **FR-006**: Application MUST display Monaco editor content for index files within 2 seconds of editor page load
 - **FR-006a**: If content is not available within 2 seconds, the test MUST fail with detailed diagnostics (e.g., list of Monaco models, active file path, recent renderer errors)
- **FR-007**: Application MUST maintain visible file content after snapshot version switches complete
- **FR-008**: Application MUST ensure Monaco models contain non-empty content before test assertions validate content display
- **FR-009**: System MUST poll for content availability with exponential backoff (up to 2 seconds total) rather than single-check assertions; upon timeout, emit diagnostics per FR-006a and fail the assertion
- **FR-010**: Application MUST trigger Monaco content refresh after VirtualFS restoration completes

#### Loading State Management

- **FR-011**: Application MUST NOT display skeleton loading state during silent initial background restoration
- **FR-012**: Application MUST display skeleton loading state immediately (<200ms) when user-initiated version switch begins
- **FR-013**: Application MUST transition skeleton state exactly twice during version switches (OFF→ON→OFF)
- **FR-014**: System MUST prevent concurrent create/restore operations that could cause skeleton state flickering
- **FR-015**: Application MUST remove skeleton loading state only after VirtualFS restoration completes successfully

#### Test Execution

- **FR-016**: Test suite MUST complete within 60 seconds for full E2E tests on standard development hardware
- **FR-017**: Tests MUST clean up resources (close Electron, release ports) after execution regardless of pass/fail status; if normal shutdown fails, the system MUST log the error and force-kill the Electron process (SIGKILL) to release resources without failing the test run
- **FR-018**: Tests MUST capture detailed timing metrics (tree ready, editor ready, content ready) for performance regression detection
- **FR-019**: System MUST limit DOM mutation counts during operations to prevent excessive re-renders (<400 mutations for tree and editor)
- **FR-020**: Tests MUST distinguish between environment failures (Electron launch) and code failures (UI behavior) in reporting

#### CI/CD Support

- **FR-021**: Test infrastructure MUST support headless execution on Linux using Xvfb virtual display
- **FR-022**: System MUST provide GitHub Actions workflow configuration for automated test execution
- **FR-023**: Tests MUST produce machine-readable output in JUnit XML format for CI integration
- **FR-024**: System MUST fail builds when UI tests fail, preventing broken code from merging

### Key Entities

- **Test Client**: WebSocket client that connects to Electron app and executes JavaScript in the renderer process. Provides high-level API for DOM queries, clicks, and evaluations.

- **Test Server**: WebSocket server running in Electron main process. Receives commands from test client and executes them via `webContents.executeJavaScript()`, returning results.

- **Skeleton Monitor**: JavaScript code injected into the application during tests to track skeleton class changes over time. Records timestamps and state transitions for validation.

- **Monaco Model**: Represents a file's content in the Monaco editor. Contains the text content and metadata (file path, language). Tests query models to verify content is loaded.

- **Performance Metrics**: Timing data collected during test execution (tree_ready, editor_ready, index_content_ready timestamps, mutation counts). Used to detect performance regressions.

- **Snapshot Version**: Represents a saved state of the plugin file system. Tests create multiple versions and switch between them to validate restoration behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can run `npm run test:e2e` successfully at least 95% of the time without Electron launch failures
- **SC-002**: All E2E tests pass consistently (7/7 tests passing) when application code is correct
- **SC-003**: Editor content displays within 2 seconds of plugin creation 100% of the time
- **SC-004**: Version switches complete in under 3 seconds with content visible afterward 100% of the time
- **SC-005**: Skeleton loading state transitions exactly 2 times during version switches (no flickering) in 100% of test runs
- **SC-006**: Tests complete full suite execution in under 60 seconds on standard MacBook hardware
- **SC-007**: CI pipeline runs tests successfully on every commit with deterministic pass/fail results
- **SC-008**: Test failure messages clearly distinguish environment issues from code bugs 100% of the time
- **SC-009**: Zero false positives in test results (tests only fail when actual bugs exist)
- **SC-010**: Integration test suite (12 UI tests) continues to pass at 100% rate after fixes are applied

## Assumptions

1. **Development Environment**: Developers are using macOS or Linux with Node.js 18+ and Electron 37.7.1
2. **Hardware Performance**: Tests are designed for modern development hardware (8GB+ RAM, quad-core CPU or better)
3. **Port Availability**: Port 9555 is available for test server usage during test execution
4. **Monaco Initialization**: Monaco editor library is properly bundled and loaded via webpack configuration
5. **WebSocket Support**: Development environments support WebSocket connections on localhost
6. **File System Access**: VirtualFS has proper read/write access to test plugin directories
7. **Notification System**: The application's notification queue system is functioning correctly for treeLoading events
8. **Test Isolation**: Each test run starts with a clean application state (no persistent data from previous runs)

## Dependencies

- **External**: Jest testing framework (v30.2.0), React Testing Library (v16.3.0), ws WebSocket library (v8.18.3)
- **Internal**: VirtualFS snapshot system, Monaco editor integration, Notification queue system, WebSocket IPC test harness
- **Environment**: Electron runtime, Node.js, macOS/Linux operating system with GUI capabilities

## Out of Scope

- Visual regression testing (screenshot comparison) - future enhancement
- Cross-platform testing on Windows - defer to future iteration
- Performance optimization beyond preventing excessive re-renders - not the focus of this fix
- Expanding test coverage to additional UI scenarios - focus is on fixing existing failing tests
- Mocking improvements for BlueprintJS or Monaco - current mocks are sufficient
- Multi-process testing (testing multiple Electron instances simultaneously) - not required
