/** @jest-environment node */
let fs, getModelCapabilities, inspectGeminiModel, fetchOpenAICapabilities, fetchAnthropicCapabilities;
beforeEach(() => {
    jest.resetModules();
    fs = require('fs/promises');
    ({getModelCapabilities} = require('../../src/ipc/ai/model_capabilities'));
    ({inspectGeminiModel} = require('../../src/utils/ai/providers/geminiProvider.cjs'));
    ({fetchOpenAICapabilities} = require('../../src/ipc/ai/model_capabilities/fetchers/openai_fetcher'));
    ({fetchAnthropicCapabilities} = require('../../src/ipc/ai/model_capabilities/fetchers/anthropic_fetcher'));
});

jest.mock('fs/promises', () => ({readFile: jest.fn(), writeFile: jest.fn().mockResolvedValue(undefined)}));
jest.mock('electron', () => ({app: {getPath: jest.fn(() => '/tmp/fdo-capabilities-test')}}));
jest.mock('../../src/utils/ai/providers/geminiProvider.cjs', () => ({inspectGeminiModel: jest.fn()}));
jest.mock('../../src/ipc/ai/model_capabilities/fetchers/openai_fetcher', () => ({fetchOpenAICapabilities: jest.fn()}));
jest.mock('../../src/ipc/ai/model_capabilities/fetchers/anthropic_fetcher', () => ({fetchAnthropicCapabilities: jest.fn()}));

test('a fresh cache for another provider does not hide an uncached Gemini model', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {other: {provider: 'openai'}}}));
    inspectGeminiModel.mockResolvedValue({inputTokenLimit: 1000000, outputTokenLimit: 64000});
    const assistant = {provider: 'gemini', model: 'gemini-test', apiKey: 'test-only'};
    expect(await getModelCapabilities(assistant.model, assistant)).toMatchObject({provider: 'gemini', api: 'interactions', streaming: true, tools: true,
        maxTokens: 1000000, maxOutputTokens: 64000});
    expect(inspectGeminiModel).toHaveBeenCalledWith(assistant);
    expect(fs.writeFile.mock.calls[0][1]).not.toContain('test-only');
});

test('model lookup selects the most specific name within the requested provider', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {
        'model': {provider: 'openai', maxTokens: 100},
        'model-pro': {provider: 'openai', maxTokens: 200},
        'model-pro-other': {provider: 'anthropic', maxTokens: 300},
    }}));
    expect(await getModelCapabilities('model-pro-20260920', {provider: 'openai'})).toMatchObject({maxTokens: 200});
    expect(await getModelCapabilities('unrelated-model-pro', {provider: 'openai'})).toMatchObject({provider: 'unknown'});
});


test('one disk read serves concurrent and subsequent capability lookups', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {'cached-model': {provider: 'openai', maxTokens: 12345}}}));
    const concurrent = await Promise.all(Array.from({length: 100}, () => getModelCapabilities('cached-model')));
    expect(concurrent.every(item => item.maxTokens === 12345)).toBe(true);
    await getModelCapabilities('cached-model');
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
});

test('concurrent missing-model lookups share one provider inspection', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {}}));
    inspectGeminiModel.mockResolvedValue({inputTokenLimit: 1000000, outputTokenLimit: 64000});
    const assistant = {provider: 'gemini', model: 'shared-gemini', apiKey: 'test-only'};
    const results = await Promise.all(Array.from({length: 100}, () => getModelCapabilities(assistant.model, assistant)));
    expect(results.every(item => item.maxTokens === 1000000)).toBe(true);
    expect(inspectGeminiModel).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
});

test('overlapping provider refreshes merge their models and never overlap disk writes', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: 0, data: {}}));
    let releaseOpenAI, releaseAnthropic;
    fetchOpenAICapabilities.mockReturnValue(new Promise(resolve => {releaseOpenAI = resolve;}));
    fetchAnthropicCapabilities.mockReturnValue(new Promise(resolve => {releaseAnthropic = resolve;}));
    let writes = 0, maximumWrites = 0, releaseFirstWrite;
    const firstWrite = new Promise(resolve => {releaseFirstWrite = resolve;});
    fs.writeFile.mockImplementation(async () => {
        writes++;maximumWrites = Math.max(maximumWrites, writes);
        if (fs.writeFile.mock.calls.length === 1) await firstWrite;
        await new Promise(setImmediate);
        writes--;
    });
    const openAI = getModelCapabilities('openai-test', {provider: 'openai', apiKey: 'openai-secret'});
    const anthropic = getModelCapabilities('anthropic-test', {provider: 'anthropic', apiKey: 'anthropic-secret'});
    await new Promise(setImmediate);
    releaseAnthropic([{id: 'anthropic-test', provider: 'anthropic', maxTokens: 200}]);
    await new Promise(setImmediate);
    releaseOpenAI([{id: 'openai-test', provider: 'openai', maxTokens: 100}]);
    await new Promise(setImmediate);
    releaseFirstWrite();
    expect(await openAI).toMatchObject({provider: 'openai', maxTokens: 100});
    expect(await anthropic).toMatchObject({provider: 'anthropic', maxTokens: 200});
    expect(await getModelCapabilities('anthropic-test')).toMatchObject({maxTokens: 200});
    const finalFile = fs.writeFile.mock.calls.at(-1)[1];
    expect(JSON.parse(finalFile).data).toMatchObject({'openai-test': {maxTokens: 100}, 'anthropic-test': {maxTokens: 200}});
    expect(finalFile).not.toMatch(/openai-secret|anthropic-secret/);
    expect(maximumWrites).toBe(1);
});

test('expired data refreshes after 24 hours without rereading disk', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
        fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: now, data: {'expiring-gemini': {provider: 'gemini', maxTokens: 100}}}));
        const assistant = {provider: 'gemini', model: 'expiring-gemini', apiKey: 'test-only'};
        expect(await getModelCapabilities(assistant.model, assistant)).toMatchObject({maxTokens: 100});
        expect(inspectGeminiModel).not.toHaveBeenCalled();
        Date.now.mockReturnValue(now + 24 * 60 * 60 * 1000 + 1);
        inspectGeminiModel.mockResolvedValue({inputTokenLimit: 200, outputTokenLimit: 50});
        expect(await getModelCapabilities(assistant.model, assistant)).toMatchObject({maxTokens: 200});
        expect(inspectGeminiModel).toHaveBeenCalledTimes(1);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
    } finally {Date.now.mockRestore();}
});


test('missing cache files use static capabilities without writes or repeated disk reads', async () => {
    fs.readFile.mockRejectedValue(Object.assign(new Error('Missing'), {code: 'ENOENT'}));
    const first = await getModelCapabilities('gpt-4o');
    expect(first.maxTokens).toBeGreaterThan(0);
    expect(await getModelCapabilities('gpt-4o')).toEqual(first);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
});

test('failed cache writes do not discard fresh results or poison later writes', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {}}));
    fs.writeFile.mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(undefined);
    inspectGeminiModel.mockResolvedValue({inputTokenLimit: 1000, outputTokenLimit: 100});
    const first = {provider: 'gemini', model: 'first-gemini', apiKey: 'test-only'};
    expect(await getModelCapabilities(first.model, first)).toMatchObject({maxTokens: 1000});
    expect(await getModelCapabilities(first.model, first)).toMatchObject({maxTokens: 1000});
    expect(inspectGeminiModel).toHaveBeenCalledTimes(1);
    await getModelCapabilities('second-gemini', {...first, model: 'second-gemini'});
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.writeFile.mock.calls.at(-1)[1]).data).toMatchObject({'first-gemini': {maxTokens: 1000}, 'second-gemini': {maxTokens: 1000}});
});

test('in-flight refreshes are scoped to credentials and are released after failures', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {}}));
    inspectGeminiModel.mockRejectedValue(new Error('Provider unavailable'));
    const first = {provider: 'gemini', model: 'unavailable-gemini', apiKey: 'first-secret'};
    await Promise.all([getModelCapabilities(first.model, first), getModelCapabilities(first.model, {...first, apiKey: 'other-secret'})]);
    expect(inspectGeminiModel).toHaveBeenCalledTimes(2);
    inspectGeminiModel.mockResolvedValue({inputTokenLimit: 2000, outputTokenLimit: 200});
    expect(await getModelCapabilities(first.model, first)).toMatchObject({maxTokens: 2000});
    expect(inspectGeminiModel).toHaveBeenCalledTimes(3);
});


test('resolves the cache path after Electron has applied its configured profile', async () => {
    require('electron').app.getPath.mockReturnValue('/tmp/fdo-selected-profile');
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {}}));
    await getModelCapabilities('gpt-4o');
    expect(fs.readFile).toHaveBeenCalledWith('/tmp/fdo-selected-profile/ai_model_cache.json', 'utf8');
});
