const base = require('./playwright.config');

// Keep automatic CI exhaustive and provider-independent. The fixture matrix
// has its own job so it is not run twice or split across Playwright shards.
module.exports = {
  ...base,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  testIgnore: [
    '**/ai-coding-agent.live.spec.js',
    '**/sdk-fixture-runtime-matrix.spec.js',
    // Requires a packaged executable, produced by the separate release workflow.
    '**/plugin-packaged-layout-smoke.spec.js',
  ],
};
