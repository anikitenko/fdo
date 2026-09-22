/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {consume, responseFor, openaiEvents, anthropicEvents, ollamaEvents} from '../helpers/aiProviderWire';

const schema = {type: 'object', additionalProperties: false, required: ['title'], properties: {title: {type: 'string'}}};
const answer = JSON.stringify({title: 'Workbench'});
const routes = ['openai', 'openai-chat', 'anthropic', 'gemini', 'ollama', 'cloudflare'];
const settings = route => ({service: route === 'openai-chat' ? 'openai' : route, model: 'test-model',
    apiKey: 'test-key', accountId: 'a'.repeat(32), modelMetadata: {},
    ...(route === 'openai-chat' ? {api: 'chat.completions'} : {})});
const usage = {input_tokens: 10, output_tokens: 3};

// Complete HTTP responses pass through the actual installed provider SDKs.
function wire(route, stream, failed = false) {
    const reason = failed ? 'length' : 'stop';
    if (route === 'openai') {
        const result = {status: failed ? 'incomplete' : 'completed', usage,
            ...(failed ? {incomplete_details: {reason: 'max_output_tokens'}} : {}),
            output: [{type: 'message', content: [{type: 'output_text', text: answer}]}]};
        return stream ? responseFor([...openaiEvents(answer).slice(0, -1),
            {type: failed ? 'response.incomplete' : 'response.completed', response: result}]) : Response.json(result);
    }
    if (route === 'anthropic') {
        const reason = failed ? 'max_tokens' : 'end_turn';
        return stream ? responseFor(anthropicEvents(answer, reason), route)
            : Response.json({content: [{type: 'text', text: answer}], stop_reason: reason, usage});
    }
    if (route === 'gemini') {
        const result = {id: 'i1', status: failed ? 'incomplete' : 'completed',
            usage: {total_input_tokens: 10, total_output_tokens: 3, total_tokens: 13},
            steps: [{type: 'model_output', content: [{type: 'text', text: answer}]}]};
        const events = [
            {event_type: 'step.start', index: 0, step: {type: 'model_output', content: []}},
            {event_type: 'step.delta', index: 0, delta: {type: 'text', text: answer}},
            {event_type: 'step.stop', index: 0},
            {event_type: 'interaction.completed', interaction: result},
        ];
        return stream ? new Response(events.map(event => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
            {headers: {'content-type': 'text/event-stream'}}) : Response.json(result);
    }
    if (route === 'ollama') {
        const events = ollamaEvents(answer, reason);
        Object.assign(events[1], {prompt_eval_count: 10, eval_count: 3});
        return stream ? responseFor(events, route) : Response.json({...events[1], message: {role: 'assistant', content: answer}});
    }
    const result = {choices: [{message: {content: answer}, finish_reason: reason}], usage};
    if (route === 'cloudflare') return Response.json({success: true, result}); // JSON mode is non-streaming on the wire.
    return stream ? responseFor([{choices: [{delta: {content: answer}}]},
        {choices: [{delta: {}, finish_reason: reason}], usage}]) : Response.json(result);
}

function assertFormat(route, body, requested = true) {
    if (route === 'openai') expect(body.text?.format).toEqual(requested ? {type: 'json_schema', name: 'response', strict: true, schema} : undefined);
    if (route === 'openai-chat') expect(body.response_format).toEqual(requested ? {type: 'json_schema', json_schema: {name: 'response', strict: true, schema}} : undefined);
    if (route === 'anthropic') expect(body.output_config?.format).toEqual(requested ? {type: 'json_schema', schema} : undefined);
    if (route === 'gemini') expect(body.response_format).toEqual(requested ? {type: 'text', mime_type: 'application/json', schema} : undefined);
    if (route === 'ollama') expect(body.format).toEqual(requested ? schema : undefined);
    if (route === 'cloudflare') expect(body.response_format).toEqual(requested ? {type: 'json_schema', json_schema: schema} : undefined);
}

describe.each(routes)('%s native structured output', route => {
    test.each([false, true])('maps the schema with application streaming=%s and does not leak it into subsequent requests', async stream => {
        const fetchImpl = jest.fn(async () => wire(route, stream));
        const client = new AiProviderClient({...settings(route), fetchImpl});
        const response = await client.chat('Return a JSON title', {stream, extended: true, responseSchema: schema});
        const result = stream ? (await consume(response)).complete : response;
        expect(result.content).toBe(answer);
        expect(result.usage).toMatchObject({input_tokens: 10});
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        assertFormat(route, body);
        expect(body.stream).toBe(route === 'cloudflare' ? false : stream);
        // A request-level schema must never become a conversation default.
        fetchImpl.mockImplementation(async () => wire(route, false));
        await client.chat('Ordinary text', {stream: false});
        assertFormat(route, JSON.parse(fetchImpl.mock.calls[1][1].body), false);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test.each([false, true])('rejects truncation even when the JSON looks complete, streaming=%s', async stream => {
        const client = new AiProviderClient({...settings(route), fetchImpl: async () => wire(route, stream, true)});
        if (stream) {
            const response = await client.chat('Return JSON', {stream, responseSchema: schema});
            await expect(consume(response)).rejects.toThrow();
            await expect(response.complete()).rejects.toThrow('not completed');
        } else await expect(client.chat('Return JSON', {responseSchema: schema})).rejects.toThrow();
    });

    test('does not retry an unsupported schema or model without the schema', async () => {
        const fetchImpl = jest.fn(async () => Response.json({error: {message: 'Schema unsupported', code: 400, type: 'invalid_request_error'},
            success: false, errors: [{message: 'Schema unsupported'}]}, {status: 400}));
        const response = await new AiProviderClient({...settings(route), fetchImpl}).chat('Return JSON', {stream: true, responseSchema: schema});
        await expect(consume(response)).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        assertFormat(route, JSON.parse(fetchImpl.mock.calls[0][1].body));
    });

    test('cancels the native schema request', async () => {
        let ready;
        const started = new Promise(resolve => { ready = resolve; });
        const fetchImpl = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
            ready();
        }));
        const client = new AiProviderClient({...settings(route), fetchImpl});
        const pending = consume(await client.chat('Return JSON', {stream: true, responseSchema: schema}));
        await started;
        client.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

test('Anthropic structured output preserves adaptive reasoning effort', async () => {
    const fetchImpl = jest.fn(async () => wire('anthropic', false));
    const client = new AiProviderClient({...settings('anthropic'), fetchImpl, think: true, reasoning: {effort: 'high'},
        modelMetadata: {capabilities: {thinking: {supported: true, types: {adaptive: {supported: true}}}, effort: {high: {supported: true}}}}});
    await client.chat('Return JSON', {responseSchema: schema});
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).output_config).toEqual({effort: 'high', format: {type: 'json_schema', schema}});
});
