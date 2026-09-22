const {readLiveAiConfig} = require('./lib/live-ai-config.cjs');
const {ollamaLlmOptions} = require('../src/utils/ollamaProvider.cjs');

async function probeProvider(config, Client, {timeoutMs = 60000} = {}) {
    const started = Date.now();
    const client = new Client({...config, ...ollamaLlmOptions(config), service: config.provider, max_tokens: 256});
    const report = {provider: config.provider, model: config.model, thinking: config.defaultThinkingMode,
        ok: false, answerCharacters: 0, reasoningCharacters: 0};
    let timer;
    try {
        const run = async () => {
            const response = await client.chat('Reply with exactly OK.', {stream: true,
                ...(['on', 'off'].includes(config.defaultThinkingMode) ? {think: config.defaultThinkingMode === 'on'} : {})});
            for await (const chunk of response.stream) {
                if (chunk.type === 'content') report.answerCharacters += chunk.content.length;
                if (chunk.type === 'thinking') report.reasoningCharacters += chunk.content.length;
            }
            const completed = await response.complete();
            if (!completed.content?.trim()) throw new Error('Provider completed without answer text.');
            report.ok = true;
        };
        await Promise.race([run(), new Promise((_, reject) => {
            timer = setTimeout(() => { reject(new Error(`Provider probe stopped after ${timeoutMs / 1000} seconds.`)); client.abort(); }, timeoutMs);
        })]);
    } catch (error) {
        report.error = String(error.message || error).split(config.apiKey || '[unused-secret]').join('[REDACTED]');
    } finally { clearTimeout(timer); client.abort(); }
    return {...report, durationMs: Date.now() - started, transport: client.describeTransport()};
}

async function main() {
    // Explicit test credentials only. One tiny request, no retries, no workspace
    // or screenshot and a 60-second deadline independent of the live scenario.
    const config = readLiveAiConfig();
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const dir = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'fdo-ai-probe-'));
    try {
        const outfile = path.join(dir, 'provider.cjs');
        await require('esbuild').build({entryPoints: [path.resolve(__dirname, '../src/utils/aiProviderClient.js')], outfile,
            bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{name: 'native-clients', setup(build) {
                build.onResolve({filter: /^(openai|cloudflare|ollama|@anthropic-ai\/sdk|@google\/genai)$/}, args =>
                    ({path: require.resolve(args.path), external: true}));
            }}]});
        console.log('Testing one native provider request (maximum 256 output tokens, 60 seconds). API usage may be billed.');
        const report = await probeProvider(config, require(outfile).default);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 1;
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
}
module.exports = {probeProvider};
if (require.main === module) main().catch(error => {
    console.error(String(error.message || error).split(process.env.FDO_TEST_AI_API_KEY || '[unused-secret]').join('[REDACTED]'));
    process.exitCode = 1;
});
