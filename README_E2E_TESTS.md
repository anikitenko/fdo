# E2E Testing Guide

## Running E2E Tests Locally (macOS/Windows)

Due to Electron GUI limitations when spawned from Jest, you need to manually start the app in test mode:

### Step 1: Start the app in test mode
```bash
npm run start:test
```

Keep this terminal running. You should see the FDO app window appear with the message:
```
[TestServer] ✓ Listening on port 9555
```

### Step 2: Run the E2E tests (in a separate terminal)
```bash
npm run test:e2e
```

The tests will connect to the running app via WebSocket and execute the test scenarios.

### Step 3: Close the app
After tests complete, press `Ctrl+C` in the first terminal to stop the app.

---

## Running E2E Tests in CI (GitHub Actions)

On Linux CI environments, we use `xvfb` (X Virtual Framebuffer) to provide a virtual display:

```bash
npm run test:e2e:ci
```

This automatically:
1. Builds the app in development mode
2. Starts a virtual display (xvfb)
3. Launches Electron with the test server
4. Runs the E2E tests
5. Cleans up

### GitHub Actions Example

``yaml
- name: Install dependencies
  run: npm ci

- name: Run E2E tests
  run: npm run test:e2e:ci
  env:
    CI: true
``

---

## What the E2E Tests Cover

1. **Initial Load UX**
   - App launches and loads home screen
   - Create plugin flow
   - Editor opens without skeleton flicker
   - Files restore silently in background
   - Monaco editor initializes correctly

2. **Version Switch UX**
   - Skeleton appears immediately when switching versions
   - No multiple skeleton flickers
   - Version switch completes smoothly
   - Progress indicators work correctly

3. **Alert Dialogs**
   - BlueprintJS Alert dialogs auto-handle OK clicks
   - Editor close confirmation
   - Editor reload confirmation

---

## Troubleshooting

### "WebSocket connection failed"
- Make sure the app is running (`npm run start:test`)
- Check that port 9555 is not in use by another process
- Verify the test server message appears in the app console

### "Tests timeout"
- Increase the timeout in `package.json` if needed
- Check for JavaScript errors in the app console
- Ensure all bundles are built (`npm run build:all:dev:once`)

### "App doesn't start"
- Run `npm run build:all:dev:once` first
- Check that `dist/` directory exists with all bundles
- Try running the app normally first: `npm start`


