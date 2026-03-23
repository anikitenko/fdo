const isCI = !!process.env.CI;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests/e2e',
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  testMatch: ['**/*.spec.js'],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
};

module.exports = config;
