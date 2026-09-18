const base = require('./playwright.config');
const configuredLiveTimeout = Number(process.env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
// A provider-backed workspace scenario can make an initial generation request
// and one validation-repair request before compile/deploy begins. Never let a
// low inherited timeout close Electron while that flow is still active.
const liveTimeout = Math.max(
    Number.isFinite(configuredLiveTimeout) && configuredLiveTimeout >= 60000
        ? configuredLiveTimeout
        : 180000,
    600000,
);
const isListingTests = process.argv.includes("--list");

module.exports = {
    ...base,
    testMatch: ['**/ai-coding-agent.live.spec.js'],
    workers: 1,
    retries: 0,
    maxFailures: 1,
    // Live providers can take longer than the normal local E2E budget.
    timeout: liveTimeout,
    // Listing tests is read-only; do not erase the previous visual report.
    reporter: isListingTests
        ? [['list']]
        : [
            ['list'],
            ['html', {outputFolder: 'artifacts/live-ai/report', open: 'never'}],
        ],
    preserveOutput: 'always',
    use: {...base.use, trace: 'off', screenshot: 'off', video: 'off'},
};
