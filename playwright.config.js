// Playwright configuration to only run e2e tests in tests/e2e/
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests/e2e',
  workers: 1, // Run tests sequentially
  testMatch: ['tests/e2e/snapshots.e2e.spec.js'],
};

module.exports = config;
