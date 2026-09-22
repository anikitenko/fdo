import {buildAiProviderInstructionBlock, getAiProviderInstructions, normalizeAiProviderInstructionMap} from '../../src/utils/aiProviderInstructions';
const {cloudflareConnection, listCloudflareModels, inspectCloudflareModel} = require('../../src/utils/cloudflareProvider.cjs');
const {readLiveAiConfig, preflightLiveAi, findLiveCodingAssistant} = require('../../scripts/lib/live-ai-config.cjs');
const {createReliabilityPlan} = require('../../scripts/lib/live-ai-reliability.cjs');
const config = {provider: 'cloudflare', accountId: 'a'.repeat(32), apiKey: 'test-secret', model: '@cf/test/vision'};
const json = result => ({ok: true, status: 200, json: async () => ({success: true, result})});
const catalog = [{name: config.model, task: {name: 'Text Generation'}}];

test('uses a fixed account endpoint and rejects missing credentials or injected account paths', () => {
    expect(cloudflareConnection(config)).toEqual({baseUrl: `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai`, apiKey: config.apiKey});
    expect(() => cloudflareConnection({...config, accountId: '../evil'})).toThrow('account ID');
    expect(() => cloudflareConnection({...config, apiKey: ''})).toThrow('API token');
});

test('discovers paginated text models, deduplicates and excludes other tasks', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce({...json([...catalog, {name: '@cf/image', task: {name: 'Text-to-Image'}}]),
        json: async () => ({result: [...catalog, {name: '@cf/image', task: {name: 'Text-to-Image'}}], result_info: {total_pages: 2}})})
        .mockResolvedValueOnce(json(catalog));
    expect(await listCloudflareModels(config, {fetchImpl})).toEqual([{label: config.model, value: config.model, provider: 'cloudflare'}]);
    expect(fetchImpl.mock.calls[1][0]).toContain('page=2');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({redirect: 'error', headers: {Authorization: 'Bearer test-secret'}});
});

test('preflight requires image input support and does not dispatch generation', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(catalog)).mockResolvedValueOnce(json({input: {
        oneOf: [{properties: {messages: {items: {properties: {content: {items: {properties: {image_url: {type: 'object'}}}}}}}}}],
    }}));
    await preflightLiveAi(config, 'Web Tools Workbench', {fetchImpl});
    expect(fetchImpl.mock.calls[1][0]).toContain('models/schema?model=%40cf%2Ftest%2Fvision');
    expect(fetchImpl.mock.calls.every(([url]) => !url.includes('/chat/'))).toBe(true);
    fetchImpl.mockResolvedValueOnce(json(catalog)).mockResolvedValueOnce(json({input: {}, output: {properties: {image_url: {}}}}));
    await expect(inspectCloudflareModel(config, {fetchImpl, requireVision: true})).rejects.toThrow('vision model');
});

test('rejects missing models and propagates redacted auth errors', async () => {
    await expect(inspectCloudflareModel(config, {fetchImpl: async () => json([])})).rejects.toThrow('unavailable');
    await expect(listCloudflareModels(config, {fetchImpl: async () => ({ok: false, status: 403,
        json: async () => ({errors: [{code: 10000, message: 'Invalid test-secret'}]})})})).rejects.toMatchObject({status: 403, code: 10000, message: expect.stringContaining('[REDACTED]')});
});

test('metadata requests honor cancellation', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn((url, {signal}) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const request = listCloudflareModels(config, {fetchImpl, signal: controller.signal});
    controller.abort();
    await expect(request).rejects.toThrow('aborted');
});

test('live config and reliability matrix require explicit account/token and keep tokens out of plans', () => {
    const env = {FDO_TEST_AI_PROVIDER: 'cloudflare', FDO_TEST_AI_MODEL: config.model, FDO_TEST_AI_API_KEY: config.apiKey, FDO_TEST_AI_ACCOUNT_ID: config.accountId};
    expect(readLiveAiConfig(env)).toMatchObject(config);
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_ACCOUNT_ID: ''})).toThrow('account ID');
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_API_KEY: ''})).toThrow('API_KEY');
    const plan = createReliabilityPlan([{provider: 'cloudflare', model: config.model, accountIdEnv: 'CF_ACCOUNT'}], {repeat: 1, env: {...env, CF_ACCOUNT: config.accountId}});
    expect(plan[0]).toMatchObject({provider: 'cloudflare', accountId: config.accountId});
    expect(JSON.stringify(plan)).not.toContain(config.apiKey);
});

test('Cloudflare provider instructions survive normalization', () => {
    const map = normalizeAiProviderInstructionMap({cloudflare: 'Use accessible controls'});
    expect(buildAiProviderInstructionBlock(getAiProviderInstructions(map, 'cloudflare'))).toContain('Use accessible controls');
});

test('live runs accept an explicit thinking preference and reject typos', () => {
    const env = {FDO_TEST_AI_PROVIDER: 'cloudflare', FDO_TEST_AI_MODEL: config.model, FDO_TEST_AI_API_KEY: config.apiKey, FDO_TEST_AI_ACCOUNT_ID: config.accountId};
    expect(readLiveAiConfig(env).defaultThinkingMode).toBe('off');
    expect(readLiveAiConfig({...env, FDO_TEST_AI_THINKING_MODE: 'auto'}).defaultThinkingMode).toBe('auto');
    expect(readLiveAiConfig({...env, FDO_TEST_AI_THINKING_MODE: 'on'}).defaultThinkingMode).toBe('on');
    expect(readLiveAiConfig({...env, FDO_TEST_AI_THINKING_MODE: 'off'}).defaultThinkingMode).toBe('off');
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_THINKING_MODE: 'disabled'})).toThrow('THINKING_MODE');
});

test('live tests select only their dedicated assistant with matching effective settings', () => {
    const desired = {...config, defaultThinkingMode: 'off', firstResponseTimeoutMs: 300000};
    const assistant = {...desired, name: 'test assistant', purpose: 'coding', id: 'matching'};
    for (const patch of [{defaultThinkingMode: 'auto'}, {provider: 'openai'}, {model: 'other'}, {name: 'personal'},
        {purpose: 'chat'}, {firstResponseTimeoutMs: 90000}, {accountId: 'b'.repeat(32)}]) {
        const stale = {...assistant, ...patch, id: 'stale'};
        expect(findLiveCodingAssistant([stale], desired, assistant.name)).toBeUndefined();
        expect(findLiveCodingAssistant([stale, assistant], desired, assistant.name)).toBe(assistant);
    }
});

test('reliability plans preserve explicit thinking modes and resolve the same default as direct runs', () => {
    const entry = {provider: 'cloudflare', model: config.model};
    const env = {FDO_TEST_AI_ACCOUNT_ID: config.accountId};
    expect(createReliabilityPlan([entry], {env, repeat: 1})[0].defaultThinkingMode).toBe('off');
    expect(createReliabilityPlan([entry], {env: {...env, FDO_TEST_AI_THINKING_MODE: 'on'}, repeat: 1})[0].defaultThinkingMode).toBe('on');
    expect(createReliabilityPlan([{...entry, thinkingMode: 'auto'}], {env: {...env, FDO_TEST_AI_THINKING_MODE: 'on'}, repeat: 1})[0].defaultThinkingMode).toBe('auto');
    expect(() => createReliabilityPlan([{...entry, thinkingMode: 'typo'}], {env, repeat: 1})).toThrow('THINKING_MODE');
});

test('live and matrix timeout overrides use the native bounded policy', () => {
    const env = {FDO_TEST_AI_PROVIDER: 'cloudflare', FDO_TEST_AI_MODEL: config.model,
        FDO_TEST_AI_ACCOUNT_ID: config.accountId, FDO_TEST_AI_API_KEY: config.apiKey};
    expect(readLiveAiConfig(env).firstResponseTimeoutMs).toBe(300000);
    expect(readLiveAiConfig({...env, FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS: '420000'}).firstResponseTimeoutMs).toBe(420000);
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS: '0'})).toThrow('First response timeout');
    const plan = createReliabilityPlan([{provider: 'cloudflare', model: config.model, firstResponseTimeoutMs: 450000}],
        {env: {...env, FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS: '420000'}, repeat: 1});
    expect(plan[0].firstResponseTimeoutMs).toBe(450000);
});
