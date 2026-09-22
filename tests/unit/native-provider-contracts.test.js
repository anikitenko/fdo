/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {openaiEvents, anthropicEvents, responseFor, consume} from '../helpers/aiProviderWire';
import {fetchOpenAICapabilities} from '../../src/ipc/ai/model_capabilities/fetchers/openai_fetcher';

const tool = {name: 'lookup', description: 'Look up a value', input_schema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}};
const accountId = 'a'.repeat(32);
const options = service => ({service, model: 'test-model', modelMetadata: {}, apiKey: 'test-secret', accountId});

test('OpenAI discovery uses the native catalog and keeps modern reasoning on Responses', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({object: 'list', data:
        ['gpt-5.4', 'o3-mini', 'o1-preview', 'gpt-4.1'].map(id => ({id, object: 'model'}))}));
    try {
        const models = await fetchOpenAICapabilities('catalog-test-key');
        expect(models[0]).toMatchObject({id: 'gpt-5.4', api: 'responses', supportsThinking: true, deterministic: false, supportsTemperature: false, maxOutputTokens: 8192});
        expect(models[1]).toMatchObject({id: 'o3-mini', api: 'responses', supportsThinking: true});
        expect(models[2]).toMatchObject({id: 'o1-preview', api: 'chat.completions', supportsThinking: false, maxField: 'max_completion_tokens'});
        expect(models[3]).toMatchObject({id: 'gpt-4.1', supportsThinking: false, supportsTemperature: true});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    } finally { fetchMock.mockRestore(); }
});

// These fixtures pass through the installed native libraries, not mocked SDKs.
test.each(['openai', 'anthropic'])('%s verifies model access through metadata without generating', async service => {
    const fetchImpl = jest.fn(async () => Response.json({id: 'test-model'}));
    expect(await new AiProviderClient({...options(service), fetchImpl}).verifyConnection()).toBe(true);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.${service}.com/v1/models/test-model`);
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.redirect).toBe('error');
    expect(request.headers.get(service === 'openai' ? 'authorization' : 'x-api-key')).toBe(service === 'openai' ? 'Bearer test-secret' : 'test-secret');
});

test.each(['openai', 'anthropic', 'cloudflare', 'ollama'])('%s aborts a pending native request with no hidden retry', async service => {
    let ready;
    const dispatched = new Promise(resolve => { ready = resolve; });
    const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
        ready();
    }));
    const client = new AiProviderClient({...options(service), fetchImpl});
    const response = await client.chat('Build', {stream: true});
    const pending = consume(response);
    await dispatched;
    client.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    await expect(response.complete()).rejects.toThrow('not completed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['openai', 'anthropic'])('%s tool proposals and usage survive native streaming without executing a tool', async service => {
    const events = service === 'openai' ? [
        ...openaiEvents('').slice(0, 1),
        {type: 'response.output_item.done', item: {type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"query":"hello"}'}},
        {type: 'response.completed', response: {status: 'completed', usage: {input_tokens: 12, output_tokens: 7, total_tokens: 19}}},
    ] : [
        anthropicEvents()[0],
        {type: 'content_block_start', index: 0, content_block: {type: 'tool_use', id: 'call_1', name: 'lookup', input: {}}},
        {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '{"query":'}},
        {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '"hello"}'}},
        {type: 'message_delta', delta: {stop_reason: 'tool_use'}, usage: {input_tokens: 12, output_tokens: 7}},
        {type: 'message_stop'},
    ];
    const fetchImpl = jest.fn(async () => responseFor(events, service, true));
    const execute = jest.fn();
    const client = new AiProviderClient({...options(service), fetchImpl, tools: [{...tool, execute}]});
    const result = await consume(await client.chat('Lookup', {stream: true}));
    expect(result.complete).toEqual({content: '', tool_calls: [{id: 'call_1', name: 'lookup', input: {query: 'hello'}}], usage: {input_tokens: 12, output_tokens: 7, total_tokens: 19}});
    expect(execute).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['openai', 'anthropic'])('%s maps non-streaming answers and conversation history', async service => {
    const fetchImpl = jest.fn(async () => Response.json(service === 'openai'
        ? {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: 'final'}]}], usage: {input_tokens: 5, output_tokens: 2}}
        : {stop_reason: 'end_turn', content: [{type: 'text', text: 'final'}], usage: {input_tokens: 5, output_tokens: 2}}));
    const client = new AiProviderClient({...options(service), fetchImpl, extended: true});
    client.system('Follow the rules.');
    client.user('Previous question');
    client.assistant('Previous answer');
    expect(await client.chat('Next question')).toMatchObject({content: 'final', usage: {input_tokens: 5, output_tokens: 2, total_tokens: 7}});
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request.instructions || request.system[0].text).toBe('Follow the rules.');
    expect(request.input || request.messages).toEqual([{role: 'user', content: 'Previous question'}, {role: 'assistant', content: 'Previous answer'}, {role: 'user', content: 'Next question'}]);
});

test('Anthropic image and PDF attachments use native source blocks', async () => {
    const fetchImpl = jest.fn(async () => responseFor(anthropicEvents(), 'anthropic'));
    const client = new AiProviderClient({...options('anthropic'), fetchImpl});
    await consume(await client.chat('Read attachments', {stream: true, attachments: [AiProviderClient.Attachment.fromPNG('YQ=='), AiProviderClient.Attachment.fromPDF('Yg==')]}));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content.slice(1)).toEqual([
        {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'YQ=='}},
        {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: 'Yg=='}},
    ]);
});

test('legacy OpenAI Chat Completions preserves tool fragments and finish reasons', async () => {
    const fetchImpl = jest.fn(async () => responseFor([
        {choices: [{delta: {tool_calls: [{index: 0, id: 'c1', function: {name: 'lookup', arguments: '{"query":'}}]}}]},
        {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: '"hello"}'}}]}, finish_reason: 'tool_calls'}]},
        {choices: [], usage: {prompt_tokens: 5, completion_tokens: 2}},
    ]));
    const client = new AiProviderClient({...options('openai'), api: 'chat.completions', fetchImpl, tools: [tool]});
    const result = await consume(await client.chat('Read', {stream: true}));
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(result.complete.tool_calls).toEqual([{id: 'c1', name: 'lookup', input: {query: 'hello'}}]);
    expect(result.complete.usage.total_tokens).toBe(7);
});

test('Cloudflare handles byte-fragmented native SSE and malformed frames fail closed', async () => {
    const client = new AiProviderClient({...options('cloudflare'), fetchImpl: async () => responseFor([
        {choices: [{delta: {content: 'Привіт 👋'}}]}, {choices: [{delta: {}, finish_reason: 'stop'}]},
    ], 'cloudflare', true)});
    expect((await consume(await client.chat('Read', {stream: true}))).complete.content).toBe('Привіт 👋');
    const malformed = new AiProviderClient({...options('cloudflare'), fetchImpl: async () => new Response('data: {bad\n\n', {headers: {'content-type': 'text/event-stream'}})});
    await expect(consume(await malformed.chat('Read', {stream: true}))).rejects.toThrow('malformed');
});

test('breaking off a stream prevents completion and aborts the native request', async () => {
    const client = new AiProviderClient({...options('openai'), fetchImpl: async () => responseFor(openaiEvents())});
    const response = await client.chat('Build', {stream: true});
    for await (const _chunk of response.stream) break;
    expect(client.controller.signal.aborted).toBe(true);
    await expect(response.complete()).rejects.toThrow('not completed');
});

test('undeclared tool proposals cannot reach the application execution path', async () => {
    const client = new AiProviderClient({...options('anthropic'), fetchImpl: async () => Response.json({stop_reason: 'tool_use', content: [{type: 'tool_use', id: 'bad', name: 'unapproved', input: {}}]})});
    await expect(client.chat('Build')).rejects.toThrow('undeclared tool');
});
