/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {sendCodingLlmRequest} from '../../src/utils/codingLlmRequest';
import {openaiEvents, responseFor, consume, text} from '../helpers/aiProviderWire';

test.each([null, 'data:image/png;base64,aGVsbG8='])('OpenAI SDK sends Responses input, instructions and screenshot: %s', async image => {
    const fetchImpl = jest.fn(async () => responseFor(openaiEvents()));
    const client = new AiProviderClient({service: 'openai', model: 'gpt-5', apiKey: 'test-key', fetchImpl, max_tokens: 4096});
    client.system('Plugin workspace only.');
    const result = await consume(await sendCodingLlmRequest(client, 'Rename plugin', image));
    expect(result.complete.content).toBe(text);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const payload = JSON.parse(init.body);
    expect(payload.max_output_tokens).toBe(4096);
    expect(payload.store).toBe(false);
    expect(JSON.stringify(payload)).toContain('Plugin workspace only.');
    expect(JSON.stringify(payload)).toContain('Rename plugin');
    if (image) expect(JSON.stringify(payload)).toContain(image);
});
