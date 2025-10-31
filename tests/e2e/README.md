# End-to-End (E2E) Testing Guide

This directory contains E2E tests for the FDO Electron application using a custom WebSocket-based test harness.

## Architecture

The E2E testing framework consists of:

1. **Test Server** (`src/ipc/test-server.js`): WebSocket server running inside Electron's main process
2. **Test Launcher** (`launcher.js`): Spawns the Electron application in test mode
3. **Test Client** (`client.js`): WebSocket client that communicates with the test server
4. **Test Suites** (`*.test.js`): Jest test files that use the client to interact with the app

##  Quick Start

### Option A: Automatic Launch (Recommended for Linux CI)

```bash
npm run test:e2e
```

This builds the app in development mode and automatically launches Electron with the test server.

**Note**: On macOS, automatic launching has limitations due to GUI app spawning behavior. Use Manual Launch (Option B) for local development.

### Option B: Manual Launch (Recommended for macOS Development)

1. **Terminal 1** - Start the app in test mode:
   ```bash
   npm run start:test
   ```
   Wait until you see:
   ```
   [TestServer] ✓ Listening on port 9555
   [MAIN] Test server started
   ```

2. **Terminal 2** - Run the tests:
   ```bash
   SKIP_LAUNCH=true npx jest tests/e2e --testTimeout=60000
   ```

## Platform-Specific Notes

### macOS

- **GUI App Spawning**: Electron GUI apps spawned from Jest don't reliably output to stdout on macOS
- **Recommendation**: Use Manual Launch (Option B) for consistent results
- **Window Visibility**: The Electron window will appear during tests

### Linux (CI)

- **Headless Testing**: Use `xvfb-run` to provide a virtual display
- **GitHub Actions**: The `.github/workflows/e2e-tests.yml` workflow handles this automatically
- **Command**:
  ```bash
  npm run test:e2e:ci
  ```

##  Test Client API

The test client provides high-level methods for interacting with the Electron app:

```javascript
// Get an element
const element = await client.getElement('.some-selector');

// Click an element
await client.click('.button-class');

// Evaluate JavaScript in the renderer
const result = await client.eval('window.someGlobalVar');

// Wait for element
await client.waitFor('.loading-indicator', { state: 'hidden' });

// Monitor class changes (useful for loading states)
const monitor = await client.monitorClassChanges('.file-tree');
// ... perform actions ...
const changes = await monitor.getChanges();
```

## Writing Tests

### Basic Structure

```javascript
const { TestClient } = require('./client');

describe('Feature Name', () => {
  let client;

  beforeAll(async () => {
    client = new TestClient();
    await client.start();
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  it('should do something', async () => {
    await client.click('.my-button');
    const result = await client.eval('document.title');
    expect(result).toBe('Expected Title');
  });
});
```

### Best Practices

1. **Use Specific Selectors**: Prefer class names or data attributes over generic tags
2. **Wait for Readiness**: Use `waitFor` to ensure elements are ready before interacting
3. **Monitor Loading States**: Use `monitorClassChanges` to verify skeleton/loading UX
4. **Timeouts**: Set appropriate test timeouts (default: 60s for E2E tests)
5. **Cleanup**: Always stop the client in `afterAll` to ensure proper shutdown

## Debugging

### Enable Verbose Logging

The test client and launcher log to console. To see all output:

```bash
npx jest tests/e2e --testTimeout=60000 --verbose
```

### Manual App Inspection

When using Manual Launch, you can interact with the Electron window while tests are NOT running. This helps debug UI issues.

### Check Test Server

Verify the test server is running:

```bash
lsof -i :9555
```

Should show Electron listening on port 9555.

### Common Issues

1. **"Failed to connect to test server"**
   - Ensure Electron is running with `ELECTRON_TEST_MODE=true`
   - Check if port 9555 is available
   - On macOS, try Manual Launch

2. **Tests timeout**
   - Increase `--testTimeout` value
   - Check if Electron window is visible (it should be)
   - Verify app isn't stuck on a loading screen

3. **"Command timeout: eval"**
   - The renderer process might have crashed
   - Check Electron console for errors
   - Verify the test script didn't get stuck in an infinite loop

##  CI/CD Integration

### GitHub Actions

The E2E tests run automatically on CI using the workflow defined in `.github/workflows/e2e-tests.yml`.

Key points:
- Runs on Ubuntu (Linux)
- Uses `xvfb-run` for headless display
- Builds in development mode for faster iteration
- Full test output is captured

### Local CI Simulation

To simulate the CI environment locally on Linux:

```bash
xvfb-run --auto-servernum npm run test:e2e
```

## Test Suites

### `snapshot-loading.test.js`

Tests the snapshot loading UX, including:
- Initial load behavior (silent background loading)
- Version switch flow (skeleton visibility)
- Monaco editor initialization
- File tree rendering
- Loading state transitions

**Scenarios**:
- ✅ Initial load should NOT show skeleton
- ✅ Files should restore silently in background
- ✅ Monaco editor should be ready after load
- ✅ Skeleton should appear immediately when switching versions
- ✅ Skeleton should NOT flicker multiple times
- ✅ Version switch should complete quickly (< 3s)

## Development

### Modifying the Test Harness

- **Test Server**: Edit `src/ipc/test-server.js` to add new commands
- **Test Client**: Edit `tests/e2e/client.js` to add new API methods
- **Launcher**: Edit `tests/e2e/launcher.js` to change spawn behavior

### Adding New Test Commands

1. Add command handler in `test-server.js`:
   ```javascript
   case 'myNewCommand':
     result = await mainWindow.webContents.executeJavaScript(`
       (() => {
         // Your code here
       })()
     `);
     break;
   ```

2. Add client method in `client.js`:
   ```javascript
   async myNewCommand(arg) {
     return this.sendCommand('myNewCommand', { arg });
   }
   ```

3. Use in tests:
   ```javascript
   const result = await client.myNewCommand('value');
   ```

## Environment Variables

- `ELECTRON_TEST_MODE`: Must be `true` to enable test server
- `ELECTRON_ENABLE_LOGGING`: Set to `1` for verbose Electron logs
- `SKIP_LAUNCH`: Set to `true` to skip automatic app launch (for Manual Launch workflow)
- `NODE_ENV`: Set to `test` by the test runner

## Troubleshooting

### Stale Processes

If tests fail to cleanup, kill stale Electron processes:

```bash
# Find Electron processes
ps aux | grep Electron

# Kill by PID
kill -9 <PID>

# Or kill all Electron (nuclear option)
pkill -9 Electron
```

### Port Conflicts

If port 9555 is in use:

```bash
# Find what's using the port
lsof -i :9555

# Kill the process
kill -9 <PID>
```

### Reset Test State

If tests behave inconsistently, clear the test app data:

```bash
rm -rf ~/Library/Application\ Support/FDO\ \(FlexDevOPs\)/test-*
```

## Performance

E2E tests are slower than unit tests. Expected timings:
- Full test suite: ~15-20 seconds
- Single test: ~2-5 seconds
- App startup: ~5 seconds

Optimize by:
- Running only changed test files during development
- Using Manual Launch to avoid repeated app startups
- Keeping tests focused and atomic

---

For questions or issues, refer to the main project README or open an issue.
