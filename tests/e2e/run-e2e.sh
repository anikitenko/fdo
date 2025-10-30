#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JEST_BIN="$PROJECT_ROOT/node_modules/.bin/jest"
JEST_ARGS=("${@:-tests/e2e/snapshot-loading.test.js}" --runInBand --testTimeout=60000 --forceExit --detectOpenHandles)
ELECTRON_LOG_FILE_PATH="${E2E_ELECTRON_LOG:-/tmp/e2e-electron.log}"

rm -f "$ELECTRON_LOG_FILE_PATH"
export ELECTRON_LOG_FILE="$ELECTRON_LOG_FILE_PATH"

cd "$PROJECT_ROOT"

echo "[Runner] Run Jest (Electron launched from tests)..."

# Default command runs jest directly; wrap with xvfb on headless Linux
if [[ "$(uname -s)" == "Linux" ]] && [[ -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null 2>&1; then
  echo "[Runner] Using xvfb-run for headless Jest"
  ELECTRON_TEST_MODE=true ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_SECURITY_WARNINGS=1 \
    xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' \
    "$JEST_BIN" "${JEST_ARGS[@]}"
else
  ELECTRON_TEST_MODE=true ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_SECURITY_WARNINGS=1 \
    "$JEST_BIN" "${JEST_ARGS[@]}"
fi

