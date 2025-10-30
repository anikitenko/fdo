#!/bin/bash
# Start FDO in test mode for E2E testing

echo "Starting FDO in test mode..."
echo "Test server will be available on localhost:9555"
echo "Press Ctrl+C to stop"
echo ""

ELECTRON_TEST_MODE=true ./node_modules/.bin/electron dist/main/index.js


