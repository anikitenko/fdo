// Shared by native Settings, inference and CI preflight. No ambient credentials.
async function createGeminiClient({apiKey, fetch: fetchImpl = globalThis.fetch, signal} = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('An API key is required for Gemini.');
    const {GoogleGenAI} = require('@google/genai');
    return new GoogleGenAI({apiKey: key, vertexai: false, enterprise: false,
        httpOptions: {baseUrl: 'https://generativelanguage.googleapis.com', apiVersion: 'v1beta', retryOptions: {attempts: 1},
            fetch: async (input, init = {}) => {
                if (input instanceof Request) {
                    init = {method: input.method, headers: input.headers, signal: input.signal,
                        ...(!['GET', 'HEAD'].includes(input.method) ? {body: await input.clone().text()} : {}), ...init};
                    input = input.url;
                }
                return fetchImpl(input, {...init, redirect: 'error', signal: signal && init.signal ? AbortSignal.any([signal, init.signal]) : signal || init.signal});
            }}});
}
async function withGeminiMetadata(config, run, {fetchImpl = globalThis.fetch, signal} = {}) {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const client = await createGeminiClient({apiKey: config.apiKey, fetch: fetchImpl, signal: combined});
        return await run(client, combined);
    } catch (error) {
        const safe = new Error(String(error?.message || error).split(config.apiKey || '[unused-secret]').join('[REDACTED]'));
        safe.status = error?.status;
        safe.name = combined.aborted ? 'AbortError' : error?.name || 'Error';
        throw safe;
    } finally { clearTimeout(timer); }
}
const supportsGeneration = model => !model.supportedActions?.length || model.supportedActions.some(action => /generateContent|interaction/i.test(action));
async function listGeminiModels(apiKey, options) {
    return withGeminiMetadata({apiKey}, async client => {
        const models = [];
        const pager = await client.models.list({config: {pageSize: 100}});
        for await (const model of pager) {
            const name = String(model.name || '').replace(/^models\//, '');
            if (name && supportsGeneration(model)) models.push({label: model.displayName || name, value: name, provider: 'gemini'});
        }
        return models;
    }, options);
}
async function inspectGeminiModel(config, options) {
    return withGeminiMetadata(config, async (client, signal) => {
        const model = await client.models.get({model: config.model, config: {abortSignal: signal}});
        if (!model.name || !supportsGeneration(model)) throw new Error('Selected Gemini model does not support generation. Refresh the model list in Settings.');
        return model;
    }, options);
}
module.exports = {createGeminiClient, listGeminiModels, inspectGeminiModel};
