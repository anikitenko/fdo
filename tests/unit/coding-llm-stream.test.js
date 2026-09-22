/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {sendCodingLlmRequest} from '../../src/utils/codingLlmRequest';
import {openaiEvents, anthropicEvents, responseFor, consume, text} from '../helpers/aiProviderWire';
import {withCodingTransientRecovery} from '../../src/utils/aiCodingTransientRecovery';

const providers = [['openai', openaiEvents], ['anthropic', anthropicEvents]];
test.each(providers)('%s SDK preserves fragmented UTF8 and SSE framing', async (service, events) => {
    const client = new AiProviderClient({service, model: 'test-model', modelMetadata: {}, apiKey: 'test-key', fetchImpl: async () => responseFor(events(), service, true)});
    expect((await consume(await sendCodingLlmRequest(client, 'Build'))).complete.content).toBe(text);
});
test.each(providers)('%s SDK never accepts partial content without terminal completion', async (service, events) => {
    const client = new AiProviderClient({service, model: 'test-model', modelMetadata: {}, apiKey: 'test-key', fetchImpl: async () => responseFor(events().slice(0, 3), service)});
    const response = await sendCodingLlmRequest(client, 'Build');
    await expect(consume(response)).rejects.toThrow(/without successful completion/);
    await expect(response.complete()).rejects.toThrow('not completed');
});
test.each(providers)('%s output token limit remains a recoverable incomplete response', async (service, events) => {
    const client = new AiProviderClient({service, model: 'test-model', modelMetadata: {}, apiKey: 'test-key', fetchImpl: async () => responseFor(events(text, 'max_tokens'), service)});
    await expect(consume(await sendCodingLlmRequest(client, 'Build'))).rejects.toThrow('max_tokens');
});
test.each(providers)('%s HTTP overload preserves FDO retry budget and accepts only the replacement', async (service, events) => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({error: {type: 'overloaded_error', message: 'Temporarily unavailable'}}), {status: 503}))
        .mockImplementation(async () => responseFor(events('complete replacement'), service));
    const run = async () => consume(await sendCodingLlmRequest(new AiProviderClient({service, model: 'test-model', modelMetadata: {}, apiKey: 'test-key', fetchImpl}), 'Build'));
    const result = await withCodingTransientRecovery({run, onRetry: jest.fn(), wait: async () => {}});
    expect(result.complete.content).toBe('complete replacement');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});
