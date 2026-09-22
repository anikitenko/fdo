const {liveAiBudgetPolicy} = require("./src/utils/liveAiTestPolicy.cjs");
const base = require('./playwright.config');
const path = require('node:path');
// IDE and direct Playwright launches preserve the same budget policy as the npm runner.
process.env.FDO_TEST_AI_MAX_REQUESTS = liveAiBudgetPolicy().envValue;
const artifactDir = process.env.FDO_E2E_LIVE_AI_ARTIFACT_DIR || 'artifacts/live-ai';
// This bounds the whole scenario. FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS
// separately configures the native assistant first-answer deadline (10–600s).
const configuredLiveTimeout = Number(process.env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
const configuredCodingOutputTokens = Number(process.env.FDO_E2E_CODING_MAX_OUTPUT_TOKENS || 16384);
const liveCodingOutputTokens = Number.isFinite(configuredCodingOutputTokens)
    ? Math.max(4096, Math.min(32768, Math.floor(configuredCodingOutputTokens)))
    : 16384;
// The workbench scenario needs a full multi-screen plugin response. Electron
// inherits this environment when the live suite launches it.
process.env.FDO_E2E_CODING_MAX_OUTPUT_TOKENS = String(liveCodingOutputTokens);
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
    ...(process.env.FDO_E2E_LIVE_AI_OUTPUT_DIR ? {outputDir: process.env.FDO_E2E_LIVE_AI_OUTPUT_DIR} : {}),
    testMatch: ['**/ai-coding-agent.live.spec.js'],
    workers: 1,
    // Provider latency makes long files expected here. Parallelizing live AI
    // requests increases cost and contention; retain deadlines and durations.
    reportSlowTests: null,
    retries: 0,
    maxFailures: 1,
    // Live providers can take longer than the normal local E2E budget.
    timeout: liveTimeout,
    // Listing tests is read-only; do not erase the previous visual report.
    reporter: isListingTests
        ? [['list']]
        : [
            ['list'],
            ['html', {outputFolder: path.join(artifactDir, 'report'), open: 'never'}],
            ...(process.env.FDO_E2E_LIVE_AI_SUMMARY_FILE
                ? [[require.resolve('./tests/e2e/helpers/liveAiSummaryReporter.cjs'), {outputFile: process.env.FDO_E2E_LIVE_AI_SUMMARY_FILE}]]
                : []),
        ],
    preserveOutput: 'always',
    use: {...base.use, trace: 'off', screenshot: 'off', video: 'off'},
};
