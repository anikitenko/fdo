# E2E Tests - Quick Start

## ✅ Recommended: Manual Launch (macOS/Linux)

This method is **100% reliable** on all platforms:

### Terminal 1: Start the app
```bash
npm run start:test
```

Wait for this output:
```
[TestServer] ✓ Listening on port 9555
[MAIN] Test server started
```

### Terminal 2: Run tests
```bash
npm run test:e2e:run
```

**✅ This method ALWAYS works!**

---

## 🔄 Alternative: Auto Launch (Less Reliable on macOS)

```bash
npm run test:e2e
```

**Note**: On macOS, Electron logs may not appear due to GUI app stdout limitations. The tests may still work, but you won't see Electron's startup logs.

---

## 🤖 CI/CD (GitHub Actions)

The E2E tests run automatically on Linux with `xvfb-run`:

```bash
npm run test:e2e:ci
```

This works perfectly on Linux CI environments!

---

## 🐛 Troubleshooting

### "Failed to connect to test server"

1. Make sure Terminal 1 shows "[TestServer] ✓ Listening on port 9555"
2. Check port 9555 is free: `lsof -i :9555`
3. Try killing stale Electron processes: `pkill -9 Electron`

### Tests timeout

- Increase timeout: Add `--testTimeout=120000` to the jest command
- Check if the Electron window is visible (it should be)
- Look for errors in the Electron window's DevTools console

### Port already in use

```bash
# Find and kill the process using port 9555
lsof -i :9555
kill -9 <PID>
```

---

## 📚 More Info

See [README.md](./README.md) for comprehensive documentation.


