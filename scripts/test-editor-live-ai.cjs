const {spawnSync} = require('node:child_process');
const key = process.env.FDO_TEST_AI_API_KEY;
const model = process.env.FDO_TEST_AI_MODEL;
const provider = process.env.FDO_TEST_AI_PROVIDER || 'openai';
const limit = Number(process.env.FDO_TEST_AI_MAX_REQUESTS || 20);
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
if (!key || !model || !['openai', 'anthropic'].includes(provider) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    console.error('Set FDO_TEST_AI_API_KEY and FDO_TEST_AI_MODEL. Optional: FDO_TEST_AI_PROVIDER=openai|anthropic and FDO_TEST_AI_MAX_REQUESTS=1..50 (default 20). No personal credential fallback.');
    process.exit(1);
}
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') continue;
    if (args[i] === '--grep' && args[i + 1]) {i++; continue;}
    console.error('Only --list and --grep <pattern> are supported; live-run safety settings cannot be overridden.');
    process.exit(1);
}
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
const result = spawnSync(process.execPath, [
    require.resolve('@playwright/test/cli'),
    'test',
    '--config=playwright.live-ai.config.js',
    `--timeout=${liveTimeout}`,
    ...args,
], {
    stdio: 'inherit', env: {...process.env, FDO_E2E_LIVE_AI: '1', FDO_E2E_KEEP_USER_DATA: '0', FDO_TEST_AI_PROVIDER: provider, FDO_TEST_AI_MAX_REQUESTS: String(limit)},
});
if (result.error) console.error(result.error.message);
console.log(`Live AI report: ${require('node:path').resolve('artifacts/live-ai/report/index.html')}`);
console.log(`Latest JSON Inspector screenshot: ${require('node:path').resolve('artifacts/live-ai/json-inspector-latest.png')}`);
console.log(`JSON Inspector screenshot status: ${require('node:path').resolve('artifacts/live-ai/json-inspector-latest.status.json')}`);
console.log(`Latest reference-inspired screenshot: ${require('node:path').resolve('artifacts/live-ai/json-inspector-reference-latest.png')}`);
process.exit(result.status ?? 1);
