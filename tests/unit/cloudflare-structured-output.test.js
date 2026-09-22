/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {WORKSPACE_MANIFEST_SCHEMA, parseWorkspaceManifest} from '../../src/utils/codingWorkspaceGeneration';
import {consume} from '../helpers/aiProviderWire';

const plan = {files: [{path: '/render.ts', contract: 'Export render(): string'}]};
const usage = {prompt_tokens: 11, completion_tokens: 7};
const options = {service: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token'};
const request = {stream: true, responseSchema: WORKSPACE_MANIFEST_SCHEMA, max_tokens: 2048, think: false};

test.each(['native object', 'native string', 'chat'])('Cloudflare structured planning uses native JSON mode for %s responses', async shape => {
    const result = shape === 'chat' ? {choices: [{message: {content: JSON.stringify(plan)}, finish_reason: 'stop'}], usage}
        : {response: shape === 'native object' ? plan : JSON.stringify(plan), usage};
    const fetchImpl = jest.fn(async () => Response.json({success: true, result}));
    const client = new AiProviderClient({...options, fetchImpl});
    const observed = await consume(await client.chat('Plan files', request));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${options.model}`);
    expect(JSON.parse(init.body)).toMatchObject({stream: false, max_tokens: 2048,
        response_format: {type: 'json_schema', json_schema: WORKSPACE_MANIFEST_SCHEMA}, chat_template_kwargs: {enable_thinking: false}});
    expect(JSON.parse(init.body).stream_options).toBeUndefined();
    expect(observed.chunks).toEqual([{type: 'content', content: JSON.stringify(plan)}]);
    expect(parseWorkspaceManifest(observed.complete.content)).toEqual(plan.files);
    expect(observed.complete.usage).toMatchObject({input_tokens: 11, output_tokens: 7});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['length', null, 'content_filter'])('structured planning rejects finish reason %s before exposing text', async reason => {
    const client = new AiProviderClient({...options, fetchImpl: async () => Response.json({result: {
        choices: [{message: {content: JSON.stringify(plan)}, finish_reason: reason}], usage,
    }})});
    const response = await client.chat('Plan', request);
    const chunks = [];
    await expect((async () => { for await (const chunk of response.stream) chunks.push(chunk); })()).rejects.toThrow();
    expect(chunks).toEqual([]);
    await expect(response.complete()).rejects.toThrow('not completed');
});

test('structured planning rejects an interrupted JSON body without retry or partial output', async () => {
    const fetchImpl = jest.fn(async () => new Response('{"result":{"response":', {headers: {'content-type': 'application/json'}}));
    const response = await new AiProviderClient({...options, fetchImpl}).chat('Plan', request);
    await expect(consume(response)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('structured planning keeps cancellation connected to the native HTTP request', async () => {
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
        ready();
    }));
    const client = new AiProviderClient({...options, fetchImpl});
    const response = await client.chat('Plan', request);
    const pending = consume(response);
    await started;
    client.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('a model rejecting JSON mode is not retried with unconstrained text', async () => {
    const fetchImpl = jest.fn(async () => Response.json({success: false, errors: [{message: 'JSON mode unsupported'}]}, {status: 400}));
    const response = await new AiProviderClient({...options, fetchImpl}).chat('Plan', request);
    await expect(consume(response)).rejects.toThrow('JSON mode unsupported');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['native', 'chat'])('explicit buffered file recovery returns raw source using %s envelope', async shape => {
    const source = '```ts\nexport const pattern = /\\s+/;\nexport const label = "category";\n```';
    const result = shape === 'native' ? {response: source, usage}
        : {choices: [{message: {content: source}, finish_reason: 'stop'}], usage};
    const fetchImpl = jest.fn(async () => Response.json({success: true, result}));
    const observed = await consume(await new AiProviderClient({...options, fetchImpl}).chat('Correct file', {
        stream: true, bufferedResponse: true, max_tokens: 3072, think: false,
    }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.response_format).toBeUndefined();
    expect(body.bufferedResponse).toBeUndefined();
    expect(body.max_tokens).toBe(3072);
    expect(observed.chunks).toEqual([{type: 'content', content: source}]);
    expect(observed.complete.content).toBe(source);
    expect(observed.complete.usage).toMatchObject({input_tokens: 11, output_tokens: 7});
});

test.each(['length', null, 'content_filter'])('buffered file recovery rejects completion %s before exposing source', async reason => {
    const client = new AiProviderClient({...options, fetchImpl: async () => Response.json({result: {
        choices: [{message: {content: '```ts\nexport {};\n```'}, finish_reason: reason}], usage,
    }})});
    const response = await client.chat('Correct file', {stream: true, bufferedResponse: true});
    const chunks = [];
    await expect((async () => { for await (const chunk of response.stream) chunks.push(chunk); })()).rejects.toThrow();
    expect(chunks).toEqual([]);
    await expect(response.complete()).rejects.toThrow('not completed');
});
