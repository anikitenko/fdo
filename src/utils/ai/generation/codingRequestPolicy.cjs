// This policy is shared by Settings, the native Coding Agent and live runners.
// A whole-scenario Playwright timeout does not override a provider request.
function codingFirstResponseTimeoutMs({provider = '', firstResponseTimeoutMs} = {}) {
    if (firstResponseTimeoutMs === undefined || firstResponseTimeoutMs === null || firstResponseTimeoutMs === '') {
        return ['cloudflare', 'ollama', 'opencode', 'openrouter', 'codex-cli', 'gemini-cli', 'cursor'].includes(provider) ? 300000 : 240000;
    }
    const value = Number(firstResponseTimeoutMs);
    if (!Number.isInteger(value) || value < 10000 || value > 600000) {
        throw new Error('First response timeout must be an integer from 10000 to 600000 milliseconds.');
    }
    return value;
}
// Models can emit a short answer prefix before silently reasoning or building
// a large continuation. Give that gap the full configured initial allowance.
function codingAnswerIdleTimeoutMs(assistant) {
    return Math.max(30000, codingFirstResponseTimeoutMs(assistant));
}
// Shared with live-run budgeting: successful file progress can earn at most
// one workspace's worth of additional requests, never an unbounded extension.
const MAX_WORKSPACE_FILES = 36;
// Long reset windows surface to the user instead of blocking indefinitely or
// retrying earlier than the provider requested.
const MAX_PROVIDER_RETRY_WAIT_MS = 120000;
module.exports = {codingFirstResponseTimeoutMs, codingAnswerIdleTimeoutMs, MAX_WORKSPACE_FILES, MAX_PROVIDER_RETRY_WAIT_MS};

// Old Settings persisted the former 90s default as a concrete value. Upgrade it
// once so subsequent user-selected short overrides remain intentional.
function migrateCodingTimeoutDefaults(settings) {
    if (settings.get('ai.codingTimeoutDefaultsVersion', 0) >= 1) return;
    const assistants = settings.get('ai.coding', []);
    const upgraded = assistants.map(assistant => assistant.firstResponseTimeoutMs === 90000
        ? {...assistant, firstResponseTimeoutMs: codingFirstResponseTimeoutMs({provider: assistant.provider})} : assistant);
    if (upgraded.some((assistant, index) => assistant !== assistants[index])) settings.set('ai.coding', upgraded);
    settings.set('ai.codingTimeoutDefaultsVersion', 1);
}
module.exports.migrateCodingTimeoutDefaults = migrateCodingTimeoutDefaults;
