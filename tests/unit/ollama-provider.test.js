const {normalizeOllamaBaseUrl, listOllamaModels, inspectOllamaModel, ollamaLlmOptions} = require('../../src/utils/ollamaProvider.cjs');
const {readLiveAiConfig, preflightLiveAi} = require('../../scripts/lib/live-ai-config.cjs');
const {createReliabilityPlan} = require('../../scripts/lib/live-ai-reliability.cjs');

const reply = data => jest.fn(async () => ({ok: true, json: async () => data}));

test('discovers downloaded models through the native endpoint without credentials', async () => {
    const fetchImpl = reply({models: [{name: 'local-model:8b'}]});
    expect(await listOllamaModels(undefined, {fetchImpl})).toEqual([{label: 'local-model:8b', value: 'local-model:8b', provider: 'ollama'}]);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.objectContaining({method: 'GET', headers: {'Content-Type': 'application/json'}}));
});

test('validates screenshot capability without generating tokens', async () => {
    const fetchImpl = reply({capabilities: ['completion', 'vision']});
    await preflightLiveAi({provider: 'ollama', model: 'local-model'}, 'Web Tools Workbench', {fetchImpl});
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.objectContaining({body: JSON.stringify({model: 'local-model'})}));
    await expect(preflightLiveAi({provider: 'ollama', model: 'text-model'}, 'Web Tools Workbench', {fetchImpl: reply({capabilities: ['completion']})})).rejects.toThrow('does not support images');
    await expect(preflightLiveAi({provider: 'ollama', model: 'text-model'}, 'renames a plugin', {fetchImpl: reply({capabilities: ['completion']})})).resolves.toBeUndefined();
});

test.each([{remote_model: 'x'}, {remote_host: 'https://ollama.com'}, {capabilities: ['embedding']}])('rejects cloud and non-generation models: %j', async metadata => {
    await expect(inspectOllamaModel(undefined, 'model', {fetchImpl: reply({capabilities: ['completion'], ...metadata})})).rejects.toThrow(/locally downloaded|text-generation/);
});

test('reports missing models and connection failure clearly', async () => {
    await expect(inspectOllamaModel(undefined, 'missing', {fetchImpl: reply({error: 'model not found'})})).rejects.toThrow('model not found');
    await expect(listOllamaModels(undefined, {fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))})).rejects.toThrow('Check that Ollama is running');
});

test('aborts stalled model discovery and releases its timer', async () => {
    jest.useFakeTimers();
    try {
        const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        }));
        const result = listOllamaModels(undefined, {fetchImpl});
        const assertion = expect(result).rejects.toThrow('aborted');
        jest.advanceTimersByTime(15000);
        await assertion;
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});

test.each(['ftp://localhost', 'http://user:password@localhost', 'http://localhost?key=x', 'http://localhost#x'])('rejects invalid endpoint %s', url => {
    expect(() => normalizeOllamaBaseUrl(url)).toThrow('Ollama URL');
});

test('keyless config ignores inherited hosted credentials and preserves local settings', () => {
    const config = readLiveAiConfig({FDO_TEST_AI_PROVIDER: 'ollama', FDO_TEST_AI_MODEL: 'local:8b', FDO_TEST_AI_API_KEY: 'secret', FDO_TEST_AI_BASE_URL: 'http://localhost:11434/', FDO_TEST_AI_CONTEXT_LENGTH: '16384'});
    expect(config).toEqual({provider: 'ollama', model: 'local:8b', apiKey: '', limit: 20, defaultThinkingMode: 'auto', firstResponseTimeoutMs: 300000, baseUrl: 'http://localhost:11434', contextLength: 16384});
    expect(ollamaLlmOptions(config)).toEqual({baseUrl: config.baseUrl, apiKey: '', options: {num_ctx: 16384}});
    const plan = createReliabilityPlan([{provider: 'ollama', model: config.model, contextLength: 16384}], {repeat: 1, env: {}});
    expect(plan[0]).toMatchObject({apiKeyEnv: null, contextLength: 16384});
    expect(JSON.stringify(plan)).not.toContain('secret');
});

test('hosted providers still require explicit credentials; all providers keep bounded requests', () => {
    expect(() => readLiveAiConfig({FDO_TEST_AI_MODEL: 'hosted'})).toThrow('require FDO_TEST_AI_API_KEY');
    expect(() => readLiveAiConfig({FDO_TEST_AI_PROVIDER: 'ollama', FDO_TEST_AI_MODEL: 'local', FDO_TEST_AI_MAX_REQUESTS: '0'})).toThrow('integer from 1 to 50');
    expect(() => ollamaLlmOptions({provider: 'ollama', contextLength: 0})).toThrow('context length');
    expect(ollamaLlmOptions({provider: 'openai'})).toEqual({});
});
