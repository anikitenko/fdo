const path = require("node:path");
module.exports = {
  testDir: path.resolve(__dirname, "../../tests/website"),
  outputDir: path.resolve(__dirname, "../../test-results/website"),
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/website/site.cjs serve",
    cwd: path.resolve(__dirname, "../.."),
    env: { PORT: "4174" },
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
};
