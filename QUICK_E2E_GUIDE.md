# Quick E2E Testing Guide

## macOS/Windows (Manual Launch)

**Terminal 1 - Start the app:**
```bash
npm run start:test
```
Wait for: `[TestServer] ✓ Listening on port 9555`

**Terminal 2 - Run tests:**
```bash
npm run test:e2e
```

## Linux/CI (Automatic with xvfb)

```bash
npm run test:e2e:ci
```

That's it!


