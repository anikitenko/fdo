const {readLiveAiConfig, preflightLiveAi} = require("./lib/live-ai-config.cjs");
const {spawnSync} = require('node:child_process');
const {runLivePlaywright} = require('./lib/run-live-playwright.cjs');
const {parseLiveAiCli} = require('./lib/live-ai-cli.cjs');

async function main() {
const cli = parseLiveAiCli(process.argv.slice(2));
const config = readLiveAiConfig(cli.env);
const args = cli.args;
const {provider, limit} = config;
console.log(config.requestBudgetMode === 'adaptive'
    ? `Live AI request budget: adaptive to pending work (absolute ceiling ${limit}; scenario deadline and bounded retries apply).`
    : `Live AI request budget: fixed ${limit} (--max-requests).`);
if (cli.ignoredInheritedLimit) console.log('Automatic budgeting replaces the inherited FDO_TEST_AI_MAX_REQUESTS value for this run. Use --max-requests to select a fixed cap.');
const configuredLiveTimeout = Number(process.env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
// Keep the command-line runner aligned with playwright.live-ai.config.js.
// Passing this explicitly prevents an inherited 60-second base-config timeout
// from closing Electron during compile, deploy, or a validation repair pass.
const liveTimeout = Math.max(
    Number.isFinite(configuredLiveTimeout) && configuredLiveTimeout >= 60000
        ? configuredLiveTimeout
        : 180000,
    600000,
);
if (!args.includes("--list")) await preflightLiveAi(config, cli.grep);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCommand, ['run', 'build'], {
    stdio: 'inherit',
    env: process.env,
});
if (build.error) {
    console.error(`Unable to build FDO before the live run: ${build.error.message}`);
    process.exit(1);
}
if (build.status !== 0) {
    process.exit(build.status || 1);
}
const result = await runLivePlaywright([
    require.resolve('@playwright/test/cli'),
    'test',
    '--config=playwright.live-ai.config.js',
    `--timeout=${liveTimeout}`,
    ...args,
], {
    artifactDir: process.env.FDO_E2E_LIVE_AI_ARTIFACT_DIR || 'artifacts/live-ai',
    env: {...process.env, FDO_E2E_LIVE_AI: '1', FDO_E2E_KEEP_USER_DATA: '0', FDO_TEST_AI_PROVIDER: provider, FDO_TEST_AI_API_KEY: config.apiKey, FDO_TEST_AI_MAX_REQUESTS: config.requestBudgetMode === 'adaptive' ? 'auto' : String(limit)},
});
if (result.error) console.error(result.error.message);
console.log(`Live AI report: ${require('node:path').resolve('artifacts/live-ai/report/index.html')}`);
console.log(`Latest JSON Inspector screenshot: ${require('node:path').resolve('artifacts/live-ai/json-inspector-latest.png')}`);
console.log(`JSON Inspector screenshot status: ${require('node:path').resolve('artifacts/live-ai/json-inspector-latest.status.json')}`);
console.log(`Latest reference-inspired screenshot: ${require('node:path').resolve('artifacts/live-ai/json-inspector-reference-latest.png')}`);
console.log(`Latest Rose Calculator screenshot: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-latest.png')}`);
console.log(`Rose Calculator screenshot status: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-latest.status.json')}`);
console.log(`Rose Calculator quick-action screenshot: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-quick-double-latest.png')}`);
console.log(`Rose Calculator equals screenshot: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-equals-latest.png')}`);
console.log(`Rose Calculator sidebar screenshot: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-sidebar-latest.png')}`);
console.log(`Rose Calculator interactions: ${require('node:path').resolve('artifacts/live-ai/rose-calculator-interactions-latest.json')}`);
console.log(`Latest Web Tools Workbench screenshot: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-latest.png')}`);
console.log(`Web Tools Workbench screenshot status: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-latest.status.json')}`);
console.log(`Web Tools Workbench library screenshot: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-library-latest.png')}`);
console.log(`Web Tools Workbench formatter screenshot: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-formatter-latest.png')}`);
console.log(`Web Tools Workbench personal-space screenshot: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-personal-space-latest.png')}`);
console.log(`Web Tools Workbench interactions: ${require('node:path').resolve('artifacts/live-ai/web-tools-workbench-interactions-latest.json')}`);
process.exitCode = result.signal ? 1 : (result.status ?? 1);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
