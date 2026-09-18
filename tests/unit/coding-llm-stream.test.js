import LLM from '@themaximalist/llm.js';
import {ReadableStream} from 'node:stream/web';
import {TextEncoder} from 'node:util';
import {sendCodingLlmRequest} from '../../src/utils/codingLlmRequest';

const frame = event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const text = 'Quasar Quill — привіт 👋';
const delta = {type: 'response.output_text.delta', delta: text};
const done = {type: 'response.completed', response: {}};
const bytes = value => new TextEncoder().encode(value);
function body(parts) {
    return new ReadableStream({start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
    }});
}
async function consume(parts, patched = true, service = 'openai') {
    global.fetch = jest.fn(async () => ({ok: true, body: body(parts)}));
    const llm = new LLM({service, apiKey: 'test-only', stream: true, extended: true});
    const response = patched ? await sendCodingLlmRequest(llm, 'Rename plugin') : await llm.chat('Rename plugin');
    let content = '';
    for await (const chunk of response.stream) if (chunk.type === 'content') content += chunk.content;
    await response.complete();
    return content;
}
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test('reproduces content loss in the installed decoder on split JSON', async () => {
    const encoded = bytes(frame(delta));
    expect(await consume([encoded.slice(0, 75), encoded.slice(75), bytes(frame(done))], false)).toBe('');
});

test('preserves content at every byte split, including UTF-8 and CRLF boundaries', async () => {
    const encoded = bytes(frame(delta) + frame(done));
    for (let split = 1; split < encoded.length; split++) {
        expect(await consume([encoded.slice(0, split), encoded.slice(split)])).toBe(text);
    }
});

test.each([
    [{type: 'response.failed', response: {error: {message: 'Model access denied'}}}, 'Model access denied'],
    [{type: 'response.incomplete', response: {incomplete_details: {reason: 'max_output_tokens'}}}, 'max_output_tokens'],
    [{type: 'error', error: {message: 'Quota exceeded'}}, 'Quota exceeded'],
])('surfaces terminal failure even after partial content: %j', async (event, message) => {
    await expect(consume([bytes(frame(delta) + frame(event))])).rejects.toThrow(message);
});

test('rejects a disconnected stream instead of applying partial code', async () => {
    await expect(consume([bytes(frame(delta))])).rejects.toThrow('before response.completed');
});

test('keeps Anthropic content decoding with fragmented events', async () => {
    const events = frame({type: 'content_block_delta', delta: {type: 'text_delta', text}}) + frame({type: 'message_stop'});
    const encoded = bytes(events);
    expect(await consume(Array.from(encoded, byte => Uint8Array.of(byte)), true, 'anthropic')).toBe(text);
});
