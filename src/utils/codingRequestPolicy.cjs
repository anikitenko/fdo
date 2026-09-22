// This policy is shared by Settings, the native Coding Agent and live runners.
// A whole-scenario Playwright timeout does not override a provider request.
function codingFirstResponseTimeoutMs({provider = '', firstResponseTimeoutMs} = {}) {
    if (firstResponseTimeoutMs === undefined || firstResponseTimeoutMs === null || firstResponseTimeoutMs === '') {
        return ['cloudflare', 'ollama'].includes(provider) ? 300000 : 90000;
    }
    const value = Number(firstResponseTimeoutMs);
    if (!Number.isInteger(value) || value < 10000 || value > 600000) {
        throw new Error('First response timeout must be an integer from 10000 to 600000 milliseconds.');
    }
    return value;
}
module.exports = {codingFirstResponseTimeoutMs};
