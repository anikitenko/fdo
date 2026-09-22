/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {consume} from '../helpers/aiProviderWire';
import {listGeminiModels, inspectGeminiModel} from '../../src/utils/geminiProvider.cjs';
import {readLiveAiConfig, preflightLiveAi} from '../../scripts/lib/live-ai-config.cjs';
import {createReliabilityPlan} from '../../scripts/lib/live-ai-reliability.cjs';
const options = {service: 'gemini', model: 'gemini-3.8-flash', apiKey: 'test-token'};
const textEvents = [
    {event_type: 'interaction.created', interaction: {id: 'i1', status: 'in_progress'}},
    {event_type: 'step.start', index: 0, step: {type: 'model_output', content: []}},
    {event_type: 'step.delta', index: 0, delta: {type: 'text', text: 'Привіт 👋'}},
    {event_type: 'step.stop', index: 0},
    {event_type: 'interaction.completed', interaction: {id: 'i1', status: 'completed', usage: {total_input_tokens: 10, total_output_tokens: 3, total_tokens: 13}}},
];
const sse = events => new Response(events.map(event => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});

test('Gemini live configuration and matrix require explicit credentials and preflight only metadata', async () => {
    const env = {FDO_TEST_AI_PROVIDER: 'gemini', FDO_TEST_AI_MODEL: options.model, FDO_TEST_AI_API_KEY: options.apiKey};
    const config = readLiveAiConfig(env);
    expect(config).toMatchObject({provider: 'gemini', model: options.model, apiKey: options.apiKey});
    expect(() => readLiveAiConfig({...env, FDO_TEST_AI_API_KEY: ''})).toThrow('API_KEY');
    const fetchImpl = jest.fn(async () => Response.json({name: `models/${options.model}`, supportedGenerationMethods: ['generateContent']}));
    await preflightLiveAi(config, 'Web Tools Workbench', {fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(createReliabilityPlan([{provider: 'gemini', modelEnv: 'FDO_TEST_AI_MODEL', apiKeyEnv: 'FDO_TEST_AI_API_KEY'}], {env, repeat: 1})[0])
        .toMatchObject({provider: 'gemini', model: options.model});
});

test('Gemini uses native Interactions, explicit key, image parts and no remote storage', async () => {
    const fetchImpl = jest.fn(async () => sse(textEvents));
    const client = new AiProviderClient({...options, fetchImpl});
    client.system('Workspace only');
    const result = await consume(await client.chat('Build', {stream: true, image: 'data:image/png;base64,YQ=='}));
    expect(result.complete.content).toBe('Привіт 👋');
    expect(result.complete.usage.total_tokens).toBe(13);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-token');
    expect(JSON.parse(init.body)).toMatchObject({model: options.model, store: false, stream: true, system_instruction: 'Workspace only',
        input: [{type: 'user_input', content: [{type: 'text', text: 'Build'}, {type: 'image', mime_type: 'image/png', data: 'YQ=='}]}]});
});

test.each(['incomplete', 'failed', 'cancelled', 'budget_exceeded', 'in_progress'])('Gemini %s is never applied as completed output', async status => {
    const events = [...textEvents.slice(0, 4), {event_type: 'interaction.completed', interaction: {id: 'i1', status}}];
    const response = await new AiProviderClient({...options, fetchImpl: async () => sse(events)}).chat('Build', {stream: true});
    await expect(consume(response)).rejects.toThrow();
    await expect(response.complete()).rejects.toThrow('not completed');
});

test('Gemini bare EOF cannot complete partial source', async () => {
    const response = await new AiProviderClient({...options, fetchImpl: async () => sse(textEvents.slice(0, 3))}).chat('Build', {stream: true});
    await expect(consume(response)).rejects.toThrow('without successful completion');
});

test('Gemini discovery and access checks use model metadata', async () => {
    const fetchImpl = jest.fn(async url => Response.json(String(url).endsWith('/gemini-3.8-flash')
        ? {name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent']}
        : {models: [{name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent']}, {name: 'models/embedding', supportedGenerationMethods: ['embedContent']}]}));
    expect(await listGeminiModels(options.apiKey, {fetchImpl})).toEqual([{label: options.model, value: options.model, provider: 'gemini'}]);
    expect((await inspectGeminiModel(options, {fetchImpl})).name).toContain(options.model);
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
});

test('Gemini HTTP overload is redacted and not retried by the SDK', async () => {
    const fetchImpl = jest.fn(async () => Response.json({error: {code: 503, status: 'UNAVAILABLE', message: 'test-token busy'}}, {status: 503}));
    await expect(consume(await new AiProviderClient({...options, fetchImpl}).chat('Build', {stream: true}))).rejects.toMatchObject({status: 503, message: expect.stringContaining('[REDACTED]')});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('Gemini retains thought signatures and function arguments as proposals for an authorized follow-up', async () => {
    const events = [
        {event_type: 'step.start', index: 0, step: {type: 'thought', summary: []}},
        {event_type: 'step.delta', index: 0, delta: {type: 'thought_summary', content: {type: 'text', text: 'Checking the workspace'}}},
        {event_type: 'step.delta', index: 0, delta: {type: 'thought_signature', signature: 'opaque-signature'}},
        {event_type: 'step.stop', index: 0},
        {event_type: 'step.start', index: 1, step: {type: 'function_call', id: 'call-1', name: 'read_file', arguments: {}}},
        {event_type: 'step.delta', index: 1, delta: {type: 'arguments_delta', arguments: '{"path":'}},
        {event_type: 'step.delta', index: 1, delta: {type: 'arguments_delta', arguments: '"index.ts"}'}},
        {event_type: 'step.stop', index: 1},
        {event_type: 'interaction.completed', interaction: {id: 'i1', status: 'requires_action'}},
    ];
    const fetchImpl = jest.fn(async () => sse(events));
    const client = new AiProviderClient({...options, fetchImpl, think: true, tools: [{name: 'read_file', input_schema: {type: 'object'}}]});
    const result = await consume(await client.chat('Build', {stream: true}));
    expect(result.chunks).toEqual([{type: 'thinking', content: 'Checking the workspace'}]);
    expect(result.complete.tool_calls).toEqual([{id: 'call-1', name: 'read_file', input: {path: 'index.ts'}}]);
    expect(result.complete.native.gemini[0].signature).toBe('opaque-signature');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    client.addMessage('assistant', '', result.complete.native);
    fetchImpl.mockImplementation(async () => sse(textEvents));
    await consume(await client.chat('Continue', {stream: true}));
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).input.slice(0, 2)).toEqual(result.complete.native.gemini);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({generation_config: {thinking_summaries: 'auto'}});
});

test('Gemini non-streaming returns text, usage and native steps', async () => {
    const steps = [{type: 'model_output', content: [{type: 'text', text: 'Complete'}]}];
    const client = new AiProviderClient({...options, fetchImpl: async () => Response.json({status: 'completed', steps,
        usage: {total_input_tokens: 20, total_output_tokens: 4, total_cached_tokens: 10, total_thought_tokens: 2, total_tokens: 24}})});
    expect(await client.chat('Build', {extended: true})).toMatchObject({content: 'Complete', native: {gemini: steps},
        usage: {cached_input_tokens: 10, reasoning_tokens: 2, total_tokens: 24}});
});

test('Gemini cancellation reaches native HTTP and cannot yield a successful completion', async () => {
    let dispatched;
    const started = new Promise(resolve => { dispatched = resolve; });
    const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        dispatched();
    }));
    const client = new AiProviderClient({...options, fetchImpl});
    const pending = consume(await client.chat('Build', {stream: true}));
    await started;
    client.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
