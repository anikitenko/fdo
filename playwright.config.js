const isCI = !!process.env.CI;
const configuredWorkers = Number(process.env.PW_WORKERS || process.env.PLAYWRIGHT_WORKERS || (isCI ? 2 : 2));

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests/e2e',
  workers: Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 2,
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
