#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON_BINARY="$PROJECT_ROOT/node_modules/.bin/electron"
MAIN_ENTRY="$PROJECT_ROOT/dist/main/index.js"
ELECTRON_LOG="${E2E_ELECTRON_LOG:-/tmp/e2e-electron.log}"
JEST_BIN="$PROJECT_ROOT/node_modules/.bin/jest"
JEST_ARGS=("${@:-tests/e2e/snapshot-loading.test.js}" --runInBand --testTimeout=60000 --forceExit --detectOpenHandles)

cd "$PROJECT_ROOT"

echo "[Runner] Starting Electron..."
# If running on Linux without DISPLAY, attempt to use xvfb-run
LAUNCHER=("$ELECTRON_BINARY" "$MAIN_ENTRY")
if [[ "$(uname -s)" == "Linux" ]] && [[ -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null 2>&1; then
  echo "[Runner] Using xvfb-run for headless Electron"
  LAUNCHER=(xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' "$ELECTRON_BINARY" "$MAIN_ENTRY")
fi

ELECTRON_TEST_MODE=true ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_SECURITY_WARNINGS=1 ELECTRON_LOG_FILE="$ELECTRON_LOG" "${LAUNCHER[@]}" >"$ELECTRON_LOG" 2>&1 &
E2E_PID=$!
echo "[Runner] Electron PID=$E2E_PID"

cleanup() {
  if ps -p "$E2E_PID" >/dev/null 2>&1; then
    echo "[Runner] Stopping Electron (PID $E2E_PID)"
    kill "$E2E_PID" >/dev/null 2>&1 || true
    wait "$E2E_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sleep 2

echo "[Runner] Run Jest..."
if SKIP_LAUNCH=true NODE_ENV=test "$JEST_BIN" "${JEST_ARGS[@]}"; then
  EXIT=0
else
  EXIT=$?
fi

sleep 1
if ps -p "$E2E_PID" >/dev/null 2>&1; then
  echo "[Runner] Electron still running (PID $E2E_PID)"
else
  echo "[Runner] Electron not running"
fi

exit "$EXIT"

