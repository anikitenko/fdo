# Quickstart: Fix UI Test Launches & Failing UI Tests

## Local

1. Build dev artifacts once:
```bash
npm run build:all:dev:once
```

2. Run E2E tests (will start Electron with retries):
```bash
npm run test:e2e
```

3. If you see a port conflict on 9555, kill stale Electron:
```bash
pkill -9 Electron || true
```

## Expectations
- Electron launch success rate ≥ 95%
- Initial content appears in Monaco within 2s
- Version switch completes < 3s; no skeleton flicker (2 transitions only)

## CI (GitHub Actions)
- Use JUnit XML reports
- Run headless with Xvfb on Ubuntu
- Fail fast on port conflicts

## Troubleshooting
- If Electron exits immediately, re-run; intermittent resource contention is mitigated by 2s retry spacing (max 3 attempts)
- On Monaco timeout, test will fail with diagnostics (models, active path)
