/** @jest-environment node */
import AiProviderClient from '../../src/utils/ai/providers/aiProviderClient';
import {consume} from '../helpers/aiProviderWire';
import {listOpenRouterModels, inspectOpenRouterModel, OPENROUTER_BASE_URL} from '../../src/utils/ai/providers/openRouterProvider.cjs';
import {readLiveAiConfig, preflightLiveAi} from '../../scripts/lib/live-ai-config.cjs';
import {codingFirstResponseTimeoutMs} from '../../src/utils/ai/generation/codingRequestPolicy.cjs';
import {AI_INSTRUCTION_PROVIDERS} from '../../src/utils/ai/assistant/aiProviderInstructions';
import {estimateCost} from '../../src/utils/ai/billing/pricing';
import {usageLedger} from '../../src/utils/ai/billing/ledger';

const options = {service: 'openrouter', model: 'openrouter/free', apiKey: 'sk-or-v1-test-key'};
const keyResponse = {data: {label: 'test', usage: 0, limit: null, is_free_tier: true}};
const catalog = {
    data: [
        {id: 'openrouter/free', pricing: {prompt: '0', completion: '0'},
            architecture: {input_modalities: ['text', 'image'], output_modalities: ['text']}},
        {id: 'deepseek/deepseek-chat-v3:free', pricing: {prompt: '0', completion: '0'}},
        {id: 'some/paid-model', pricing: {prompt: '0.001', completion: '0.002'}},
        {id: 'audio/singing-free', pricing: {prompt: '0', completion: '0'},
            architecture: {output_modalities: ['audio']}},
    ],
};
// auth/key first, then the public catalog: never a chat completion.
const metadataFetch = () => jest.fn(async url => String(url).endsWith('/auth/key')
    ? Response.json(keyResponse) : Response.json(catalog));

test('OpenRouter live configuration requires explicit credentials and defaults to a 300s first answer', () => {
    const env = {FDO_TEST_AI_PROVIDER: 'openrouter', FDO_TEST_AI_MODEL: options.model, FDO_TEST_AI_API_KEY: options.apiKey};
    const config = readLiveAiConfig(env);
    expect(config).toMatchObject({
        provider: 'openrouter',
        model: options.model,
        apiKey: options.apiKey,
        defaultThinkingMode: 'off',
        firstResponseTimeoutMs: 300000,
        limit: 50,
        requestBudgetMode: 'adaptive',
    });
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_API_KEY: ''})).toThrow('API_KEY');
    expect(codingFirstResponseTimeoutMs({provider: 'openrouter'})).toBe(300000);
    expect(codingFirstResponseTimeoutMs({provider: 'openrouter', firstResponseTimeoutMs: 120000})).toBe(120000);
});

test('OpenRouter preflight, listing and vision checks are metadata-only', async () => {
    const fetchImpl = metadataFetch();
    const config = readLiveAiConfig({
        FDO_TEST_AI_PROVIDER: 'openrouter',
        FDO_TEST_AI_MODEL: options.model,
        FDO_TEST_AI_API_KEY: options.apiKey,
    });
    await preflightLiveAi(config, 'Web Tools Workbench', {fetchImpl});
    // Two GET metadata calls; the free tier's request budget is untouched.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [keyUrl, keyInit] = fetchImpl.mock.calls[0];
    const [catalogUrl, catalogInit] = fetchImpl.mock.calls[1];
    expect(String(keyUrl)).toBe(`${OPENROUTER_BASE_URL}/auth/key`);
    expect(new Headers(keyInit.headers).get('authorization')).toBe(`Bearer ${options.apiKey}`);
    expect(String(catalogUrl)).toBe(`${OPENROUTER_BASE_URL}/models`);
    expect(!catalogInit.method || catalogInit.method === 'GET').toBe(true);

    // Free, chat-usable models only: paid entries and audio-output ids are out.
    const models = await listOpenRouterModels(options.apiKey, {fetchImpl});
    expect(models).toEqual([
        {label: 'deepseek/deepseek-chat-v3:free', value: 'deepseek/deepseek-chat-v3:free', provider: 'openrouter', inputModalities: null},
        {label: 'openrouter/free', value: 'openrouter/free', provider: 'openrouter', inputModalities: ['text', 'image']},
    ]);
    // The public catalog needs no key, so Settings can populate before key entry.
    await expect(listOpenRouterModels('', {fetchImpl})).resolves.toHaveLength(2);
    await expect(listOpenRouterModels(options.apiKey, {fetchImpl: async () => Response.json({data: [{id: 'a/paid'}]})}))
        .rejects.toThrow('no free chat-capable models');

    await expect(inspectOpenRouterModel({...options}, {fetchImpl})).resolves.toMatchObject({id: options.model, free: true});
    await expect(inspectOpenRouterModel({...options, model: 'not-in-catalog'}, {fetchImpl}))
        .rejects.toThrow('does not offer "not-in-catalog"');
    // Inspection without a key fails before any request is sent.
    await expect(inspectOpenRouterModel({...options, apiKey: ''}, {fetchImpl}))
        .rejects.toThrow('API key is required');

    // requireVision rejects models whose metadata declares text-only input...
    const textOnly = {data: [{id: options.model, pricing: {prompt: '0', completion: '0'},
        architecture: {input_modalities: ['text'], output_modalities: ['text']}}]};
    await expect(inspectOpenRouterModel({...options}, {requireVision: true, fetchImpl: async url => String(url).endsWith('/auth/key')
        ? Response.json(keyResponse) : Response.json(textOnly)}))
        .rejects.toThrow('accepts text only');
    // ...and tolerates entries that publish no modality metadata at all.
    await expect(inspectOpenRouterModel({...options, model: 'deepseek/deepseek-chat-v3:free'}, {requireVision: true, fetchImpl}))
        .resolves.toMatchObject({modalities: null});

    await expect(listOpenRouterModels('sk-bad', {fetchImpl: async () => Response.json({}, {status: 401})}))
        .rejects.toThrow('rejected the API key');
    await expect(listOpenRouterModels(options.apiKey, {fetchImpl: async () => Response.json({nope: true})}))
        .rejects.toThrow('unexpected model catalog shape');
});

test('missing live models report the CLI variable and only catalog-confirmed free vision alternatives', async () => {
    const vision = {input_modalities: ['text', 'image'], output_modalities: ['text']};
    const data = [
        {id: 'current/vision:free', architecture: vision},
        {id: 'current/text:free', architecture: {input_modalities: ['text']}},
        {id: 'current/unknown:free'},
        {id: 'current/paid', architecture: vision, pricing: {prompt: '1', completion: '1'}},
        {id: 'current/content-safety:free', architecture: vision},
    ];
    const fetchImpl = jest.fn(async url => Response.json(String(url).endsWith('/auth/key') ? keyResponse : {data}));
    const config = {provider: 'openrouter', model: 'retired/model:free', apiKey: options.apiKey};
    const error = await preflightLiveAi(config, 'Web Tools Workbench', {fetchImpl}).catch(error => error);
    expect(error.code).toBe('AI_MODEL_UNAVAILABLE');
    expect(error.message).toContain('Current free image-capable chat models include: current/vision:free');
    expect(error.message).toContain('FDO_TEST_AI_MODEL');
    expect(error.message).toContain('independently of FDO Settings');
    for (const id of ['current/text', 'current/unknown', 'current/paid', 'current/content-safety']) {
        expect(error.message).not.toContain(id);
    }
    expect(config.model).toBe('retired/model:free');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
        `${OPENROUTER_BASE_URL}/auth/key`, `${OPENROUTER_BASE_URL}/models`,
    ]);
});

test('missing models with no compatible alternatives do not suggest unverified vision support', async () => {
    const fetchImpl = jest.fn(async url => Response.json(String(url).endsWith('/auth/key') ? keyResponse
        : {data: [{id: 'text/model:free', architecture: {input_modalities: ['text']}}]}));
    await expect(inspectOpenRouterModel({...options, model: 'retired/model'}, {requireVision: true, fetchImpl}))
        .rejects.toThrow('No free image-capable chat alternatives were confirmed');
});

test('OpenRouter adapter forces Chat Completions on the OpenRouter endpoint with the official OpenAI client', async () => {
    const content = 'export const answer = 42;';
    const sse = [{choices: [{index: 0, delta: {role: 'assistant', content}}]},
        {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]},
        {choices: [], usage: {prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100}}]
        .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetchImpl = jest.fn(async () => new Response(sse, {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl});
    expect(client.describeTransport()).toContain('OpenRouter');
    client.system('Workspace only');
    const result = await consume(await client.chat('Build', {stream: true}));
    expect(result.complete.content).toBe(content);
    expect(result.complete.usage).toMatchObject({input_tokens: 1000, output_tokens: 100});

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${options.apiKey}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({model: options.model, stream: true});
    expect(body.stream_options).toEqual({include_usage: true});
    // This adapter's selected route must not change with model names.
    expect(String(url)).not.toContain('/responses');
    expect(String(url)).not.toContain('/messages');
});

test('OpenRouter forwards the saved thinking preference as an explicit reasoning block', async () => {
    const sse = data => [{choices: [{index: 0, delta: {role: 'assistant', content: data}}]},
        {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]},
        {choices: [], usage: {prompt_tokens: 10, completion_tokens: 5}}]
        .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const wire = async (think, reasoningEffort, reasoningMaxTokens) => {
        const fetchImpl = jest.fn(async () => new Response(sse('OK'), {headers: {'content-type': 'text/event-stream'}}));
        const client = new AiProviderClient({...options, fetchImpl, ...(think === undefined ? {} : {think}), ...(reasoningEffort ? {reasoningEffort} : {}), ...(reasoningMaxTokens ? {reasoningMaxTokens} : {})});
        await consume(await client.chat('Build', {stream: true}));
        return JSON.parse(fetchImpl.mock.calls[0][1].body);
    };
    // on/off are explicit; auto keeps the model's own default untouched.
    expect(await wire(false)).toMatchObject({reasoning: {enabled: false}});
    expect(await wire(true)).toMatchObject({reasoning: {enabled: true}});
    expect(await wire(undefined)).not.toHaveProperty('reasoning');
    // The gateway rejects effort + max_tokens. Budget wins when both are
    // supplied, while explicit Off omits both controls.
    expect((await wire(true, 'low', 2048)).reasoning).toEqual({enabled: true, max_tokens: 2048});
    expect((await wire(true, 'low')).reasoning).toEqual({enabled: true, effort: 'low'});
    expect((await wire(false, 'low', 2048)).reasoning).toEqual({enabled: false});
});

test.each([0, -1, 1.5, 8192, '2048'])('rejects invalid reasoning budget %s before sending HTTP', async reasoningMaxTokens => {
    const fetchImpl = jest.fn();
    const client = new AiProviderClient({...options, fetchImpl, think: true, reasoningMaxTokens});
    await expect(client.chat('Build', {stream: true}).then(consume)).rejects.toThrow('positive integer smaller');
    expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([true, false])('uses a response schema only with catalog support (%s)', async supported => {
    const fetchImpl = jest.fn(async () => Response.json({choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}]}));
    const responseSchema = {type: 'object', properties: {ok: {type: 'boolean'}}, required: ['ok'], additionalProperties: false};
    const client = new AiProviderClient({...options, fetchImpl,
        modelMetadata: {supportedParameters: supported ? ['structured_outputs'] : ['temperature']}});
    await client.chat('Return ok', {responseSchema});
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format).toEqual(supported
        ? {type: 'json_schema', json_schema: {name: 'response', strict: true, schema: responseSchema}} : undefined);
    expect(body.provider).toEqual(supported ? {require_parameters: true} : undefined);
    if (!supported) expect(body.messages[0].content).toContain(JSON.stringify(responseSchema));
});

test.each([true, false])('retains billed reasoning usage on output-limit failure (stream=%s)', async stream => {
    const usage = {prompt_tokens: 100, completion_tokens: 2048,
        completion_tokens_details: {reasoning_tokens: 2048}};
    const fetchImpl = jest.fn(async () => stream
        ? new Response([
            {choices: [{delta: {reasoning: 'Thinking'}, finish_reason: null}]},
            {choices: [{delta: {}, finish_reason: 'length'}]},
            {choices: [], usage},
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
        {headers: {'content-type': 'text/event-stream'}})
        : Response.json({choices: [{message: {content: '', reasoning: 'Thinking'}, finish_reason: 'length'}], usage}));
    const client = new AiProviderClient({...options, fetchImpl});
    const response = client.chat('Build', {stream});
    await expect(stream ? response.then(consume) : response).rejects.toThrow('response.incomplete: max_tokens');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(usageLedger.snapshot().entries[0]).toMatchObject({status: 'failed',
        usage: {input_tokens: 100, output_tokens: 2048, reasoning_tokens: 2048}});
});

test('OpenRouter decodes reasoning deltas and reports a reasoning-only stream instead of an empty answer', async () => {
    const stream = [{choices: [{index: 0, delta: {role: 'assistant', reasoning: 'thinking it over'}}]},
        {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]},
        {choices: [], usage: {prompt_tokens: 10, completion_tokens: 5}}]
        .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetchImpl = jest.fn(async () => new Response(stream, {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl});
    client.system('Workspace only');
    const response = await client.chat('Build', {stream: true});
    // Reasoning is visible as activity, so the wait phase reports progress.
    await expect((async () => {
        const chunks = [];
        for await (const chunk of response.stream) chunks.push(chunk);
        return chunks;
    })()).rejects.toThrow(/reasoning only[\s\S]*thinking mode to Off/);
    expect(client.transport.reasoningCharacters).toBe('thinking it over'.length);
    expect(client.transport.answerCharacters).toBe(0);
    await expect(response.complete()).rejects.toThrow('not completed');
});

test('OpenRouter connection verification checks key and catalog without generating tokens', async () => {
    const fetchImpl = metadataFetch();
    const client = new AiProviderClient({...options, fetchImpl});
    await expect(client.verifyConnection()).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${OPENROUTER_BASE_URL}/auth/key`);
    expect(String(fetchImpl.mock.calls[1][0])).toBe(`${OPENROUTER_BASE_URL}/models`);
    // Metadata-only: every call is a plain GET, none is a completion request.
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
    expect(fetchImpl.mock.calls.every(([, init]) => !init.body)).toBe(true);
});

test('OpenRouter requires an API key and registers with instructions and billing', () => {
    expect(() => new AiProviderClient({service: 'openrouter', model: options.model})).toThrow('API key is required');
    expect(() => new AiProviderClient({service: 'unknown-gateway', apiKey: 'x'})).toThrow('Unsupported AI provider');
    expect(AI_INSTRUCTION_PROVIDERS).toContain('openrouter');
    // Saved rates (including explicit zero for free models) estimate normally.
    expect(estimateCost({provider: 'openrouter', model: options.model, usage: {input_tokens: 1000, output_tokens: 100},
        rate: {input: 2, output: 10}})).toMatchObject({status: 'estimated', totalCost: 0.003});
    expect(estimateCost({provider: 'openrouter', model: options.model, usage: {input_tokens: 1000, output_tokens: 100},
        rate: {input: 0, output: 0}})).toMatchObject({status: 'estimated', totalCost: 0});
    // Without any saved rate the cost stays unknown, never zero.
    expect(estimateCost({provider: 'openrouter', model: options.model, usage: {input_tokens: 1, output_tokens: 1}}).status)
        .toBe('unknown');
});

test.each([true, false])('routing rejection retries once, preserving request requirements (native schema=%s)', async structured => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(Response.json({error: {message: 'No endpoints found that can handle the requested parameters.', code: 404}}, {status: 404}))
        .mockResolvedValueOnce(Response.json({choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}]}));
    const responseSchema = {type: 'object', properties: {ok: {type: 'boolean'}}};
    const onProviderRetry = jest.fn();
    const client = new AiProviderClient({...options, fetchImpl, think: false,
        modelMetadata: {supportedParameters: structured ? ['structured_outputs'] : []}});
    await client.chat('Build', {responseSchema, max_tokens: 2048, image: 'data:image/png;base64,YQ==', onProviderRetry});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onProviderRetry).toHaveBeenCalledWith({reason: 'routing-parameters', nativeSchemaFallback: structured});
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(second.response_format).toBeUndefined();
    expect(second.provider).toBeUndefined();
    for (const key of ['model', 'reasoning', 'max_tokens', 'stream']) expect(second[key]).toEqual(first[key]);
    expect(second.messages.at(-1)).toEqual(first.messages.at(-1));
    if (structured) expect(second.messages[0].content).toContain(JSON.stringify(responseSchema));
});

test.each([401, 403, 404])('does not retry authentication, policy or unrelated missing-model errors (%s)', async status => {
    const fetchImpl = jest.fn(async () => Response.json({error: {message: 'Model or account unavailable', code: status}}, {status}));
    const client = new AiProviderClient({...options, fetchImpl});
    await expect(client.chat('Build')).rejects.toThrow('Model or account unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['rejected again', 'budget exhausted', 'cancelled'])('routing fallback is bounded: %s', async outcome => {
    const fetchImpl = jest.fn(async () => Response.json({error: {message: 'No endpoints found that can handle the requested parameters.', code: 404}}, {status: 404}));
    const client = new AiProviderClient({...options, fetchImpl});
    const onProviderRetry = jest.fn(() => {
        if (outcome === 'budget exhausted') throw new Error('Request budget exhausted');
        if (outcome === 'cancelled') client.abort();
    });
    await expect(client.chat('Build', {onProviderRetry})).rejects.toThrow(outcome === 'budget exhausted' ? 'Request budget exhausted'
        : outcome === 'cancelled' ? 'cancelled' : 'No endpoints found');
    expect(fetchImpl).toHaveBeenCalledTimes(outcome === 'rejected again' ? 2 : 1);
    expect(onProviderRetry).toHaveBeenCalledTimes(1);
});

test('routing fallback also recovers before a streaming response starts', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(Response.json({error: {message: 'No endpoints found that can handle the requested parameters.', code: 404}}, {status: 404}))
        .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl});
    const response = await client.chat('Build', {stream: true});
    await consume(response);
    expect((await response.complete()).content).toBe('OK');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test.each([false, true])('mandatory reasoning gets one visible fallback without changing other requirements (stream=%s)', async stream => {
    const rejection = 'Reasoning is mandatory for this endpoint and cannot be disabled.';
    const success = () => stream ? new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}})
        : Response.json({choices: [{message: {content: 'OK'}, finish_reason: 'stop'}]});
    const fetchImpl = jest.fn().mockResolvedValueOnce(Response.json({error: {message: rejection}}, {status: 400})).mockImplementation(success);
    const onProviderRetry = jest.fn();
    const client = new AiProviderClient({...options, fetchImpl, think: false,
        modelMetadata: {supportedParameters: ['structured_outputs']}});
    const response = await client.chat('Build', {stream, responseSchema: {type: 'object'}, image: 'data:image/png;base64,YQ==', onProviderRetry});
    if (stream) await consume(response);
    const [first, retry] = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(first.reasoning).toEqual({enabled: false});
    expect(retry).not.toHaveProperty('reasoning');
    const {reasoning, ...rest} = first;
    expect(retry).toEqual(rest);
    expect(onProviderRetry).toHaveBeenCalledWith({reason: 'mandatory-reasoning', nativeSchemaFallback: false});
    // The setting is not changed on the client or cached across router choices.
    const next = await client.chat('Next', {stream});
    if (stream) await consume(next);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).reasoning).toEqual({enabled: false});
});
test.each(['repeated', 'unrelated', 'already enabled', 'budget', 'cancel'])('mandatory reasoning recovery is narrow and bounded: %s', async outcome => {
    const fetchImpl = jest.fn(async () => Response.json({error: {message: outcome === 'unrelated' ? 'Invalid request parameter' : 'Reasoning is mandatory for this endpoint and cannot be disabled.'}}, {status: 400}));
    const client = new AiProviderClient({...options, fetchImpl, think: outcome === 'already enabled'});
    const onProviderRetry = jest.fn(() => {
        if (outcome === 'budget') throw new Error('Budget exhausted');
        if (outcome === 'cancel') client.abort();
    });
    await expect(client.chat('Build', {onProviderRetry})).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(outcome === 'repeated' ? 2 : 1);
});

test('routing and mandatory-reasoning recovery share one adapter retry', async () => {
    const fetchImpl = jest.fn()
        .mockResolvedValueOnce(Response.json({error: {message: 'No endpoints found that can handle the requested parameters.'}}, {status: 404}))
        .mockResolvedValueOnce(Response.json({error: {message: 'Reasoning is mandatory for this endpoint and cannot be disabled.'}}, {status: 400}));
    const client = new AiProviderClient({...options, fetchImpl, think: false});
    await expect(client.chat('Build')).rejects.toThrow('Reasoning is mandatory');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test.each([429, 502, 503, 400, 402, 403, undefined])('preserves embedded SSE status %s and never completes partial output', async code => {
    const events = [{choices: [{delta: {content: 'partial source'}, finish_reason: null}]},
        {error: {code, message: 'JSON error injected into SSE stream'}, choices: [{delta: {}, finish_reason: 'error'}]}];
    const fetchImpl = jest.fn(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
        {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl});
    const response = await client.chat('Build', {stream: true});
    const error = await consume(response).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(code);
    const {isAiCodingTransientError} = require('../../src/utils/ai/assistant/aiCodingTransientRecovery');
    expect(isAiCodingTransientError(error)).toBe([429, 502, 503].includes(code));
    await expect(response.complete()).rejects.toThrow('not completed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('embedded SSE failure replays only the failed attempt under the shared transient budget', async () => {
    const {withCodingTransientRecovery} = require('../../src/utils/ai/assistant/aiCodingTransientRecovery');
    const failed = 'data: {"error":{"code":502,"message":"JSON error injected into SSE stream"}}\n\n';
    const completed = 'data: {"choices":[{"delta":{"content":"complete source"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const fetchImpl = jest.fn().mockResolvedValueOnce(new Response(failed, {headers: {'content-type': 'text/event-stream'}}))
        .mockResolvedValueOnce(new Response(completed, {headers: {'content-type': 'text/event-stream'}}));
    const run = async () => {
        const client = new AiProviderClient({...options, fetchImpl});
        const response = await client.chat('Build', {stream: true});
        await consume(response);
        return response.complete();
    };
    const result = await withCodingTransientRecovery({run, onRetry: jest.fn(), wait: async () => {}});
    expect(result.content).toBe('complete source');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('SSE metadata retains quota classification without exposing raw provider details', () => {
    const client = new AiProviderClient(options);
    const error = client.normalizeError({message: 'JSON error injected into SSE stream ' + options.apiKey,
        error: {code: 502, metadata: {error_type: 'insufficient_quota', raw: 'private provider response'}}});
    const {isAiCodingTransientError} = require('../../src/utils/ai/assistant/aiCodingTransientRecovery');
    expect(error.status).toBe(502);
    expect(error.code).toBe('insufficient_quota');
    expect(isAiCodingTransientError(error)).toBe(false);
    expect(error.message).not.toContain(options.apiKey);
    expect(JSON.stringify(error)).not.toContain('private provider response');
});

test.each([400, '400'])('mandatory reasoning SSE rejection gets the same bounded recovery (code=%s)', async code => {
    const rejection = {error: {code, message: 'Reasoning is mandatory for this endpoint and cannot be disabled.'}};
    const fetchImpl = jest.fn()
        .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(rejection)}\n\n`, {headers: {'content-type': 'text/event-stream'}}))
        .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}}));
    const onProviderRetry = jest.fn();
    const client = new AiProviderClient({...options, fetchImpl, think: false});
    const response = await client.chat('Build', {stream: true, onProviderRetry});
    await consume(response);
    expect((await response.complete()).content).toBe('OK');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, retry] = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));
    const {reasoning, ...rest} = first;
    expect(reasoning).toEqual({enabled: false});
    expect(retry).toEqual(rest);
    expect(onProviderRetry).toHaveBeenCalledWith({reason: 'mandatory-reasoning', nativeSchemaFallback: false});
});

test.each(['partial', 'repeated', 'missing status'])('mandatory reasoning SSE recovery remains bounded: %s', async mode => {
    const rejection = {error: {code: mode === 'missing status' ? undefined : 400, message: 'Reasoning is mandatory for this endpoint and cannot be disabled.'}};
    const partial = mode === 'partial' ? 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n' : '';
    const fetchImpl = jest.fn(async () => new Response(partial + `data: ${JSON.stringify(rejection)}\n\n`, {headers: {'content-type': 'text/event-stream'}}));
    const client = new AiProviderClient({...options, fetchImpl, think: false});
    const response = await client.chat('Build', {stream: true});
    await expect(consume(response)).rejects.toThrow('Reasoning is mandatory');
    await expect(response.complete()).rejects.toThrow('not completed');
    expect(fetchImpl).toHaveBeenCalledTimes(mode === 'repeated' ? 2 : 1);
});

const schemaRejection = "Model 'apodex/apodex-1.1-mini' does not support 'json_schema' response format. Supported formats: json_object.";
test.each(['http', 'sse'])('explicit JSON Schema capability rejection falls back to JSON once (%s)', async transport => {
    const reject = () => transport === 'http'
        ? Response.json({error: {message: schemaRejection}}, {status: 400})
        : new Response(`data: ${JSON.stringify({error: {code: 400, message: schemaRejection}})}\n\n`, {headers: {'content-type': 'text/event-stream'}});
    const success = () => transport === 'http'
        ? Response.json({choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}]})
        : new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
    const fetchImpl = jest.fn().mockImplementationOnce(reject).mockImplementationOnce(success);
    const onProviderRetry = jest.fn();
    const responseSchema = {type: 'object', properties: {ok: {type: 'boolean'}}};
    const client = new AiProviderClient({...options, fetchImpl, think: false, modelMetadata: {supportedParameters: ['structured_outputs']}});
    const response = await client.chat('Build', {responseSchema, stream: transport === 'sse', max_tokens: 2048, onProviderRetry});
    if (transport === 'sse') await consume(response);
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(first.response_format.type).toBe('json_schema');
    expect(second.response_format).toEqual({type: 'json_object'});
    expect(second.provider).toBeUndefined();
    expect(second.messages[0].content).toContain(JSON.stringify(responseSchema));
    for (const key of ['model', 'reasoning', 'max_tokens', 'stream']) expect(second[key]).toEqual(first[key]);
    expect(second.messages.at(-1)).toEqual(first.messages.at(-1));
    expect(onProviderRetry).toHaveBeenCalledWith({reason: 'unsupported-json-schema', nativeSchemaFallback: true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test.each(['repeat', 'invalid-schema', 'budget', 'cancel'])('JSON format downgrade remains narrow and bounded: %s', async mode => {
    const message = mode === 'invalid-schema' ? 'Invalid json_schema: required properties missing' : schemaRejection;
    const fetchImpl = jest.fn(async () => Response.json({error: {message}}, {status: 400}));
    const client = new AiProviderClient({...options, fetchImpl, modelMetadata: {supportedParameters: ['structured_outputs']}});
    const onProviderRetry = jest.fn(() => {
        if (mode === 'budget') throw new Error('Request budget exhausted');
        if (mode === 'cancel') client.abort();
    });
    await expect(client.chat('Build', {responseSchema: {type: 'object'}, onProviderRetry})).rejects.toThrow(
        mode === 'budget' ? 'Request budget exhausted' : mode === 'cancel' ? 'cancelled' : message);
    expect(fetchImpl).toHaveBeenCalledTimes(mode === 'repeat' ? 2 : 1);
});

test.each([undefined, {supportedParameters: []}])('guide proposal schema reaches models without native support (%p)', async modelMetadata => {
    const {generateGuideProposal} = require('../../src/utils/plugins/authoring/pluginGuideProposal');
    const fetchImpl = jest.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        const system = body.messages.find(message => message.role === 'system').content;
        const marker = 'Return only JSON matching this response schema:\n';
        expect(system.split(marker)).toHaveLength(2);
        const schema = JSON.parse(system.split(marker)[1]);
        expect(schema.properties.modules.type).toBe('array');
        expect(schema.properties.modules.items.required).toEqual(['path', 'responsibility']);
        expect(schema.properties.conventions.type).toBe('array');
        expect(schema.properties.acceptance.items.required).toContain('requirement');
        expect(body.response_format).toBeUndefined();
        return Response.json({choices: [{message: {content: JSON.stringify({
            purpose: 'Inspect JSON locally', modules: [{path: '/index.ts', responsibility: 'Plugin entry'}],
            conventions: ['Keep processing local'], patterns: [], acceptance: [{id: 'inspect',
                description: 'Validates JSON', testFile: '/inspect.test.ts', testName: 'validates JSON',
                requirement: 'Inspect JSON locally'}],
        })}, finish_reason: 'stop'}]});
    });
    const client = new AiProviderClient({...options, model: 'cohere/north-mini-code:free', fetchImpl, modelMetadata});
    const guide = await generateGuideProposal({prompt: 'Inspect JSON locally',
        files: [{path: '/SKILL.md'}, {path: '/index.ts'}, {path: '/inspect.test.ts'}], fingerprint: 'a'.repeat(64),
        validateSection: () => [], validateFile: () => [], assertActive: () => {}, assertBudget: () => {}, onStage: () => {},
        request: async ({prompt, responseSchema, maxOutputTokens}) => {
            const response = await client.chat(prompt, {responseSchema, max_tokens: maxOutputTokens});
            return response;
        },
    });
    expect(guide).toContain('## Acceptance criteria');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
