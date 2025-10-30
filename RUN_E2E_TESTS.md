# How to Run E2E Tests

## ⚠️ IMPORTANT: Close All FDO Instances First!

Before running E2E tests, **you MUST close all running FDO/Electron instances** to avoid single-instance lock issues.

### Step 1: Close All Instances

```bash
# Kill any running FDO instances
pkill -f "Electron.*fdo"
pkill -f "FDO.*FlexDevOPs"

# Verify no instances are running
ps aux | grep -i "electron\|fdo" | grep -v grep
```

### Step 2: Run E2E Tests

```bash
npm run test:e2e
```

## How It Works

The E2E tests:
1. Set `ELECTRON_TEST_MODE=true` environment variable
2. Launch Electron with the test flag
3. Test server starts on port 9555 (WebSocket)
4. Tests connect and control the app via IPC commands
5. Single-instance lock is disabled in test mode

## If Tests Still Fail

### Check for Output
The tests should show output like:
```
[MAIN] ========== ELECTRON STARTING ==========
[MAIN] ELECTRON_TEST_MODE: "true"
[MAIN] isTestMode: true
[MAIN] ========== TEST MODE DETECTED ==========
[MAIN] Test mode - skipping single instance lock
[TestServer] ✓ Listening on port 9555
```

### If No Output Appears
- Make sure you closed ALL Electron instances
- Check if another app is using port 9555
- Try restarting your terminal

### Manual Test
Test if Electron launches properly:
```bash
ELECTRON_TEST_MODE=true node_modules/.bin/electron dist/main/index.js
```

You should see the FDO window open and stay running.

## For CI/GitHub Actions

Add to your workflow:

```yaml
- name: Run E2E Tests
  run: |
    # Ensure no instances running
    pkill -f "Electron" || true
    sleep 2
    # Run tests
    npm run test:e2e
  env:
    CI: true
    ELECTRON_TEST_MODE: true
```

Note: CI environments may need additional setup for headless Electron testing (Xvfb on Linux).



