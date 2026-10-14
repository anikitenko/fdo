/** @jest-environment node */
import AiProviderClient from '../../src/utils/ai/providers/aiProviderClient';
import {consume} from '../helpers/aiProviderWire';
import {listOpenCodeModels, inspectOpenCodeModel, OPENCODE_ZEN_BASE_URL} from '../../src/utils/ai/providers/opencodeProvider.cjs';
import {readLiveAiConfig, preflightLiveAi} from '../../scripts/lib/live-ai-config.cjs';
import {codingFirstResponseTimeoutMs} from '../../src/utils/ai/generation/codingRequestPolicy.cjs';
import {AI_INSTRUCTION_PROVIDERS} from '../../src/utils/ai/assistant/aiProviderInstructions';
import {estimateCost} from '../../src/utils/ai/billing/pricing';

const options = {service: 'opencode', model: 'mimo-v2.6-flash-free', apiKey: 'sk-test-key'};
const catalog = {
    data: [
        {id: 'kimi-k3'},
        {id: 'mimo-v2.6-flash-free', modalities: {input: ['text', 'image']}},
    ],
};

test('OpenCode Zen live configuration requires explicit credentials and defaults to a 300s first answer', () => {
    const env = {FDO_TEST_AI_PROVIDER: 'opencode', FDO_TEST_AI_MODEL: options.model, FDO_TEST_AI_API_KEY: options.apiKey};
    const config = readLiveAiConfig(env);
    expect(config).toMatchObject({
        provider: 'opencode',
        model: options.model,
        apiKey: options.apiKey,
        defaultThinkingMode: 'auto',
        firstResponseTimeoutMs: 300000,
        limit: 50,
        requestBudgetMode: 'adaptive',
    });
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_API_KEY: ''})).toThrow('API_KEY');
    expect(codingFirstResponseTimeoutMs({provider: 'opencode'})).toBe(300000);
    expect(codingFirstResponseTimeoutMs({provider: 'opencode', firstResponseTimeoutMs: 120000})).toBe(120000);
});

test('OpenCode Zen discovery, listing and vision preflight use catalog metadata only', async () => {
    const fetchImpl = jest.fn(async () => Response.json(catalog));
    const config = readLiveAiConfig({
        FDO_TEST_AI_PROVIDER: 'opencode',
        FDO_TEST_AI_MODEL: options.model,
        FDO_TEST_AI_API_KEY: options.apiKey,
    });
    await preflightLiveAi(config, 'Web Tools Workbench', {fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${OPENCODE_ZEN_BASE_URL}/models`);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${options.apiKey}`);
    expect(!init.method || init.method === 'GET').toBe(true);

    const models = await listOpenCodeModels(options.apiKey, {fetchImpl});
    // Free models sort first and are labelled; the provider field drives Settings.
    expect(models).toEqual([
        {label: 'mimo-v2.6-flash-free (free)', value: 'mimo-v2.6-flash-free', provider: 'opencode', inputModalities: ['text', 'image']},
        {label: 'kimi-k3', value: 'kimi-k3', provider: 'opencode', inputModalities: null},
    ]);

    await expect(inspectOpenCodeModel({...options}, {fetchImpl})).resolves.toMatchObject({id: options.model, free: true});
    // OpenCode config style ids (opencode/<id>) normalize to the gateway id.
    await expect(inspectOpenCodeModel({...options, model: `opencode/${options.model}`}, {fetchImpl}))
        .resolves.toMatchObject({id: options.model});
    await expect(inspectOpenCodeModel({...options, model: 'not-in-catalog'}, {fetchImpl}))
        .rejects.toThrow('does not offer "not-in-catalog"');

    // requireVision rejects models whose metadata declares text-only input...
    const textOnly = {data: [{id: options.model, modalities: {input: ['text']}}]};
    await expect(inspectOpenCodeModel({...options}, {requireVision: true, fetchImpl: async () => Response.json(textOnly)}))
        .rejects.toThrow('accepts text only');
    // ...and tolerates gateways that publish no modality metadata at all.
    await expect(inspectOpenCodeModel({...options}, {requireVision: true, fetchImpl: async () => Response.json({data: [{id: options.model}]})}))
        .resolves.toMatchObject({modalities: null});

    await expect(listOpenCodeModels('sk-bad', {fetchImpl: async () => Response.json({}, {status: 401})}))
        .rejects.toThrow('rejected the API key');
    await expect(listOpenCodeModels(options.apiKey, {fetchImpl: async () => Response.json({nope: true})}))
        .rejects.toThrow('unexpected model catalog shape');
    await expect(listOpenCodeModels('', {fetchImpl})).rejects.toThrow('API key is required');
});

test('OpenCode Zen adapter forces Chat Completions on the Zen endpoint with the official OpenAI client', async () => {
    const content = 'export const answer = 42;';
    const sse = [{choices: [{index: 0, delta: {role: 'assistant', content}}]},
        {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]},
        {choices: [], usage: {prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100}}]
        .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetchImpl = jest.fn(async () => new Response(sse, {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl});
    expect(client.describeTransport()).toContain('OpenCode Zen');
    client.system('Workspace only');
    const result = await consume(await client.chat('Build', {stream: true}));
    expect(result.complete.content).toBe(content);
    expect(result.complete.usage).toMatchObject({input_tokens: 1000, output_tokens: 100});

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${OPENCODE_ZEN_BASE_URL}/chat/completions`);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${options.apiKey}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({model: options.model, stream: true});
    expect(body.stream_options).toEqual({include_usage: true});
    // The Responses API and Anthropic Messages routes are different Zen
    // endpoints; this adapter must never fall onto them.
    expect(String(url)).not.toContain('/responses');
    expect(String(url)).not.toContain('/messages');
});

test('OpenCode Zen connection verification checks the catalog without generating tokens', async () => {
    const fetchImpl = jest.fn(async () => Response.json(catalog));
    const client = new AiProviderClient({...options, fetchImpl});
    await expect(client.verifyConnection()).resolves.toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${OPENCODE_ZEN_BASE_URL}/models`);
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
});

test('OpenCode Zen requires an API key and registers with instructions and billing', () => {
    expect(() => new AiProviderClient({service: 'opencode', model: options.model})).toThrow('API key is required');
    expect(() => new AiProviderClient({service: 'unknown-gateway', apiKey: 'x'})).toThrow('Unsupported AI provider');
    expect(AI_INSTRUCTION_PROVIDERS).toContain('opencode');
    // Saved rates (including explicit zero for free models) estimate normally.
    expect(estimateCost({provider: 'opencode', model: options.model, usage: {input_tokens: 1000, output_tokens: 100},
        rate: {input: 2, output: 10}})).toMatchObject({status: 'estimated', totalCost: 0.003});
    expect(estimateCost({provider: 'opencode', model: options.model, usage: {input_tokens: 1000, output_tokens: 100},
        rate: {input: 0, output: 0}})).toMatchObject({status: 'estimated', totalCost: 0});
    // Without any saved rate or catalog price the cost stays unknown, never zero.
    expect(estimateCost({provider: 'opencode', model: options.model, usage: {input_tokens: 1, output_tokens: 1}}).status)
        .toBe('unknown');
});
