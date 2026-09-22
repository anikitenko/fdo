/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {sendCodingLlmRequest} from '../../src/utils/codingLlmRequest';
import {probeProvider} from '../../scripts/diagnose-ai-provider.cjs';
import {isAiCodingTransientError, isAiCodingProviderTimeoutError} from '../../src/utils/aiCodingTransientRecovery';

const sse = (events, ending = '') => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + ending, {headers: {'content-type': 'text/event-stream'}});
const cfOptions = {service: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-secret'};

test.each([[3008, false, false, undefined], [3046, true, true, undefined], [3046, false, false, 'false']])(
    'native error normalization preserves retry control metadata for code %s', async (code, transient, timeout, shouldRetry) => {
        const fetchImpl = jest.fn(async () => Response.json({errors: [{code, message: 'Request failed test-secret'}]},
            {status: 408, headers: shouldRetry ? {'x-should-retry': shouldRetry, 'private-header': 'test-secret'} : {}}));
        const client = new AiProviderClient({...cfOptions, fetchImpl});
        let failure;
        try { await consume(await sendCodingLlmRequest(client, 'Build')); } catch (error) { failure = error; }
        expect(failure).toMatchObject({status: 408, errors: [{code: String(code)}]});
        expect(isAiCodingTransientError(failure)).toBe(transient);
        expect(isAiCodingProviderTimeoutError(failure)).toBe(timeout);
        expect(failure.message).toContain('[REDACTED]');
        expect(failure.headers).toBeUndefined();
        expect(JSON.stringify(failure)).not.toContain('test-secret');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
async function consume(response) {
    const chunks = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    return {chunks, complete: await response.complete()};
}
const delta = content => ({choices: [{index: 0, delta: {content}}]});
const finish = reason => ({choices: [{index: 0, delta: {}, finish_reason: reason}]});

test.each([true, false])('Cloudflare progress reflects buffered=%s while headers and body are pending', async (buffered) => {
    let releaseHeaders, body;
    let notifyFetch;
    const dispatched = new Promise(resolve => { notifyFetch = resolve; });
    const headers = new Promise(resolve => { releaseHeaders = resolve; });
    const client = new AiProviderClient({...cfOptions, fetchImpl: () => { notifyFetch(); return headers; }});
    expect(client.describeTransport()).toBe('Preparing the Cloudflare request.');
    const response = await client.chat('Generate', {stream: true,
        ...(buffered ? {responseSchema: {type: 'object'}} : {})});
    const pending = consume(response);
    await dispatched;
    expect(client.describeTransport()).toBe(buffered
        ? 'Waiting for the complete response from Cloudflare. This request returns its answer all at once.'
        : 'Waiting for a response from Cloudflare.');
    const nativeResponse = new Response(new ReadableStream({start(controller) { body = controller; }}),
        {headers: {'content-type': buffered ? 'application/json' : 'text/event-stream'}});
    releaseHeaders(nativeResponse);
    // Wait for fetch's continuation, while the body remains deliberately open.
    await headers;
    await Promise.resolve();
    expect(client.transport.headersReceived).toBe(true);
    expect(client.describeTransport()).toBe(buffered
        ? 'Waiting for the complete response from Cloudflare. This request returns its answer all at once.'
        : 'Receiving the response from Cloudflare; 0 response events received.');
    body.enqueue(new TextEncoder().encode(buffered
        ? JSON.stringify({result: {response: {ok: true}}})
        : `data: ${JSON.stringify(delta('OK'))}\n\ndata: ${JSON.stringify(finish('stop'))}\n\n`));
    body.close();
    const result = await pending;
    expect(result.complete.content).toBe(buffered ? '{"ok":true}' : 'OK');
    expect(result.chunks.every(chunk => chunk.type === 'content')).toBe(true);
    // A reused client must not show the previous file's headers or counts.
    await client.chat('Next file', {stream: true});
    expect(client.describeTransport()).toBe('Preparing the Cloudflare request.');
    expect(client.transport.events).toBe(0);
});

test('Cloudflare diagnostics describe event structure without exposing text, reasoning or arbitrary keys', async () => {
    const client = new AiProviderClient({...cfOptions, fetchImpl: async () => sse([
        {choices: [{delta: {reasoning: 'private reasoning'}, finish_reason: null}]},
        {choices: [{message: {content: 'private snapshot'}, 'secret-field-name': 'secret-value'}]},
        {choices: [], usage: {prompt_tokens: 10, completion_tokens: 5}},
    ])});
    let failure;
    try { await consume(await client.chat('Sensitive prompt', {stream: true})); } catch (error) { failure = error.message; }
    expect(failure).toContain('3 JSON events, 3 choice events');
    expect(failure).toContain('0 answer characters, 17 reasoning characters');
    expect(failure).toContain('message:object');
    expect(failure).toContain('usage received: true; finish reason received: false; [DONE] received: false');
    expect(failure).not.toMatch(/private|Sensitive|secret-field-name|secret-value/);
});

test('Cloudflare result envelopes preserve content, usage and explicit completion', async () => {
    const client = new AiProviderClient({...cfOptions, fetchImpl: async () => sse([
        {success: true, result: delta('Hello')}, {success: true, result: finish('stop')},
    ])});
    expect((await consume(await client.chat('Build', {stream: true}))).complete.content).toBe('Hello');
});

test.each([undefined, true, false])('reasoning-only EOF reports the actual requested thinking setting %s and never completes', async think => {
    const fetchImpl = jest.fn(async () => sse([
        {choices: [{delta: {content: ''}, finish_reason: null}], usage: {}},
        {choices: [{delta: {reasoning: 'reasoning without an answer'}, finish_reason: null}], usage: {completion_tokens: 10}},
    ]));
    const client = new AiProviderClient({...cfOptions, think, fetchImpl});
    const response = await client.chat('Build', {stream: true});
    await expect(consume(response)).rejects.toThrow(`requested thinking: ${think === undefined ? 'auto' : think ? 'on' : 'off'}`);
    await expect(response.complete()).rejects.toThrow('not completed');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    if (think === undefined) expect(body).not.toHaveProperty('chat_template_kwargs');
    else expect(body.chat_template_kwargs.enable_thinking).toBe(think);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('wrapped Cloudflare errors and usage-only EOF never count as completion', async () => {
    for (const events of [[{result: {error: {message: 'provider failed'}}}], [{result: {usage: {prompt_tokens: 10, completion_tokens: 0}}}]]) {
        const client = new AiProviderClient({...cfOptions, fetchImpl: async () => sse(events)});
        await expect(consume(await client.chat('Build', {stream: true}))).rejects.toThrow(/provider failed|completion event/);
    }
});

test('the bounded probe uses the production client, honors thinking off and records counts only', async () => {
    const fetchImpl = jest.fn(async () => sse([delta('OK'), finish('stop')]));
    const report = await probeProvider({...cfOptions, provider: 'cloudflare', defaultThinkingMode: 'off', fetchImpl}, AiProviderClient);
    expect(report).toMatchObject({ok: true, answerCharacters: 2, reasoningCharacters: 0});
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({max_tokens: 256, chat_template_kwargs: {enable_thinking: false}});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toContain('test-secret');
});

test('the bounded probe stops a silent provider instead of waiting for the live-scenario deadline', async () => {
    const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
    }));
    const report = await probeProvider({...cfOptions, provider: 'cloudflare', fetchImpl}, AiProviderClient, {timeoutMs: 50});
    expect(report).toMatchObject({ok: false, error: 'Provider probe stopped after 0.05 seconds.'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
});

test('Cloudflare SDK uses the native model endpoint with instructions, screenshot and reasoning', async () => {
    const fetchImpl = jest.fn(async () => sse([{choices: [{delta: {reasoning: 'Thinking'}}]}, delta('Привіт 👋'), finish('stop')]));
    const client = new AiProviderClient({...cfOptions, fetchImpl, max_tokens: 4096});
    client.system('Plugin workspace only.');
    const result = await consume(await sendCodingLlmRequest(client, 'Build tools', 'data:image/png;base64,YQ=='));
    expect(result.chunks).toEqual([{type: 'thinking', content: 'Thinking'}, {type: 'content', content: 'Привіт 👋'}]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${cfOptions.accountId}/ai/run/${cfOptions.model}`);
    expect(request.headers.get('authorization')).toBe('Bearer test-secret');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toMatchObject({stream: true, max_tokens: 4096, stream_options: {include_usage: true}, messages: [
        {role: 'system', content: 'Plugin workspace only.'},
        {role: 'user', content: [{type: 'text', text: 'Build tools'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,YQ=='}}]},
    ]});
});

test('native Cloudflare response events complete with the native DONE terminator', async () => {
    const client = new AiProviderClient({...cfOptions, fetchImpl: async () => sse([{response: 'Hello'}], 'data: [DONE]\n\n')});
    expect((await consume(await sendCodingLlmRequest(client, 'Build'))).complete.content).toBe('Hello');
});

test.each([
    [[delta('partial')], '', /completion event/],
    [[delta('partial'), finish('length')], '', /max_tokens/],
    [[delta('partial'), finish('content_filter')], '', /without successful completion/],
    [[{choices: [{delta: {reasoning: 'reasoning only'}}]}], 'data: [DONE]\n\n', /without answer text/],
    [[{choices: [{delta: {}}]}], 'data: [DONE]\n\n', /without answer text/],
    [[delta('partial'), finish('tool_calls')], '', /without successful completion/],
])('rejects incomplete or unusable output %#', async (events, ending, message) => {
    const client = new AiProviderClient({...cfOptions, fetchImpl: async () => sse(events, ending)});
    const response = await sendCodingLlmRequest(client, 'Build');
    await expect(consume(response)).rejects.toThrow(message);
    await expect(response.complete()).rejects.toThrow('not completed');
});

test('no SDK retries multiply FDO retry budgets; provider errors preserve status and redact secrets', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({errors: [{code: 'server_error', message: 'Overloaded test-secret'}]}), {status: 503}));
    const client = new AiProviderClient({...cfOptions, fetchImpl});
    await expect(consume(await sendCodingLlmRequest(client, 'Build'))).rejects.toMatchObject({status: 503, message: expect.stringContaining('[REDACTED]')});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['@cf/qwen/qwen3.8-27b', '@hf/thebloke/model-v1.0'])('non-streaming Cloudflare preserves the model path %s and result envelope', async model => {
    const fetchImpl = jest.fn(async () => Response.json({result: {response: '{"action":"generate"}'}}));
    const client = new AiProviderClient({...cfOptions, model, fetchImpl});
    expect(await client.chat('Route', {stream: false})).toBe('{"action":"generate"}');
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${cfOptions.accountId}/ai/run/${model}`);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('account_id');
});

test.each(['', '@cf//model', '@cf/../model', '@cf/./model', '/@cf/model', '@cf/model/',
    '@cf/%2e%2e/model', '@cf%2Fqwen%2Fmodel', '@cf/model?query=1', '@cf/model#fragment', '@cf/model\\escape', '@cf/model\n'])('rejects unsafe Cloudflare model paths before HTTP: %j', async model => {
    const fetchImpl = jest.fn();
    const client = new AiProviderClient({...cfOptions, model, fetchImpl});
    await expect(client.chat('Build')).rejects.toThrow('model ID');
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('non-SSE stream replies cannot trigger a hidden non-streaming retry', async () => {
    const fetchImpl = jest.fn(async () => Response.json({result: {response: 'code'}}));
    const client = new AiProviderClient({...cfOptions, fetchImpl});
    await expect(consume(await sendCodingLlmRequest(client, 'Build'))).rejects.toThrow('non-SSE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('named SSE errors cannot be ignored as empty content', async () => {
    const client = new AiProviderClient({...cfOptions, fetchImpl: async () => new Response('event: error\ndata: {"code":"server_error","message":"Failed test-secret"}\n\n', {headers: {'content-type': 'text/event-stream'}})});
    await expect(consume(await sendCodingLlmRequest(client, 'Build'))).rejects.toMatchObject({code: 'server_error', message: expect.stringContaining('[REDACTED]')});
});

test('Stop cancels a pending request without retries', async () => {
    let dispatched;
    const started = new Promise(resolve => { dispatched = resolve; });
    const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        dispatched();
    }));
    const client = new AiProviderClient({...cfOptions, fetchImpl});
    const pending = consume(await sendCodingLlmRequest(client, 'Build'));
    await started;
    client.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
