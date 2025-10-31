// Playwright configuration to only run e2e tests in tests/e2e/
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests/e2e',
  workers: 1, // Run tests sequentially
  // Remove invalid reporter config
};

module.exports = config;
