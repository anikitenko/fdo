/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {sendCodingLlmRequest} from '../../src/utils/codingLlmRequest';
import {ollamaEvents, responseFor, consume, text} from '../helpers/aiProviderWire';

test('Ollama SDK preserves native context/output limits and image messages without cloud keys', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-leak';
    try {
        const fetchImpl = jest.fn(async () => responseFor(ollamaEvents(), 'ollama', true));
        const client = new AiProviderClient({service: 'ollama', model: 'local-test', baseUrl: 'http://localhost:11434', max_tokens: 4096, options: {num_ctx: 16384}, fetchImpl});
        client.system('Plugin workspace only.');
        expect((await consume(await sendCodingLlmRequest(client, 'Build', 'data:image/png;base64,aGVsbG8='))).complete.content).toBe(text);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/chat');
        expect(JSON.parse(init.body)).toMatchObject({options: {num_ctx: 16384, num_predict: 4096}});
        expect(JSON.parse(init.body).messages.some(message => message.images?.includes('aGVsbG8='))).toBe(true);
        expect(JSON.stringify(init)).not.toContain('must-not-leak');
        expect(JSON.stringify(init.headers).toLowerCase()).not.toContain('authorization');
    } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});
test.each(['truncated', 'length', 'error'])('Ollama %s never becomes completed source', async kind => {
    let events = ollamaEvents(text, kind);
    if (kind === 'truncated') events = events.slice(0, 1);
    if (kind === 'error') events = [{error: 'model unloaded'}];
    const client = new AiProviderClient({service: 'ollama', model: 'local-test', fetchImpl: async () => responseFor(events, 'ollama')});
    await expect(consume(await sendCodingLlmRequest(client, 'Build'))).rejects.toThrow();
});
