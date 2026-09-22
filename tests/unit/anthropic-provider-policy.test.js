/** @jest-environment node */
import AiProviderClient from '../../src/utils/aiProviderClient';
import {anthropicParameters} from '../../src/utils/aiProviders/anthropicPolicy';
import {listAnthropicModels} from '../../src/utils/aiProviders/catalog';
import {tokenUsage} from '../../src/utils/aiProviders/messages';
import {anthropicEvents, consume, responseFor} from '../helpers/aiProviderWire';

const adaptive = {max_tokens: 4096, capabilities: {thinking: {supported: true, types: {adaptive: {supported: true}}}, effort: {high: {supported: true}}}};
const manual = {max_tokens: 4096, capabilities: {thinking: {supported: true, types: {enabled: {supported: true}}}}};

test('adaptive Claude uses supported effort and summaries without a legacy budget or sampling controls', () => {
    expect(anthropicParameters({think: true, reasoning: {effort: 'high'}, max_tokens: 10000, temperature: 0.2}, adaptive))
        .toEqual({max_tokens: 4096, thinking: {type: 'adaptive', display: 'summarized'}, output_config: {effort: 'high'}});
    expect(() => anthropicParameters({think: true, reasoning: {effort: 'max'}}, adaptive)).toThrow('does not support effort');
});
test('manual thinking honors model output limits and omits temperature', () => {
    expect(anthropicParameters({think: true, max_thinking_tokens: 1024, temperature: 0.2}, manual))
        .toEqual({max_tokens: 4096, thinking: {type: 'enabled', budget_tokens: 1024}});
});
test.each([0, 1023, 4096, 9000, 1024.5])('rejects invalid manual budget %s before inference', max_thinking_tokens => {
    expect(() => anthropicParameters({think: true, max_thinking_tokens}, manual)).toThrow('budget');
});
test('unknown and unsupported thinking capabilities do not guess a mode', () => {
    expect(() => anthropicParameters({think: true}, {})).toThrow('capabilities are unavailable');
    expect(() => anthropicParameters({think: true}, {capabilities: {thinking: {supported: false}}})).toThrow('does not support thinking');
});
test.each(['image/png', 'application/pdf'])('rejects explicitly unsupported attachment %s before inference', mediaType => {
    expect(() => anthropicParameters({}, {capabilities: {image_input: {supported: false}, pdf_input: {supported: false}}}, [{mediaType}])).toThrow('does not support');
});
test('model metadata is fetched once per credential and model, then used by the native request', async () => {
    const fetchImpl = jest.fn(async (url, init) => init.method === 'GET' ? Response.json({...adaptive, id: 'metadata-test-model'}) : responseFor(anthropicEvents(), 'anthropic'));
    for (let i = 0; i < 2; i++) {
        const client = new AiProviderClient({service: 'anthropic', model: 'metadata-test-model', apiKey: 'metadata-test-key', think: true, fetchImpl});
        client.system('Stable workspace guide');
        await consume(await client.chat('Build', {stream: true}));
    }
    expect(fetchImpl.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
    const requests = fetchImpl.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0][1].body)).toMatchObject({max_tokens: 4096, thinking: {type: 'adaptive'}, system: [{type: 'text', text: 'Stable workspace guide', cache_control: {type: 'ephemeral'}}]});
});
test('metadata failure cannot silently switch to a guessed inference configuration', async () => {
    const fetchImpl = jest.fn(async () => Response.json({error: {type: 'authentication_error', message: 'bad metadata-secret'}}, {status: 401}));
    const client = new AiProviderClient({service: 'anthropic', model: 'metadata-fail', apiKey: 'metadata-secret', fetchImpl});
    await expect(consume(await client.chat('Build', {stream: true}))).rejects.toMatchObject({status: 401, message: expect.stringContaining('[REDACTED]')});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
});
test('native model discovery follows pagination and retains advertised capabilities', async () => {
    const fetchImpl = jest.fn(async url => Response.json(String(url).includes('after_id')
        ? {data: [{id: 'model-b', ...manual}], has_more: false}
        : {data: [{id: 'model-a', ...adaptive}], has_more: true, first_id: 'model-a', last_id: 'model-a'}));
    const models = await listAnthropicModels('test-key', {fetchImpl});
    expect(models.map(model => model.id)).toEqual(['model-a', 'model-b']);
    expect(models[0].modelMetadata).toMatchObject(adaptive);
});
test('token accounting includes Claude cache reads/writes without double counting OpenAI cached input', () => {
    expect(tokenUsage({input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20}))
        .toEqual({input_tokens: 130, output_tokens: 5, total_tokens: 135, cached_input_tokens: 100, cache_write_tokens: 20});
    expect(tokenUsage({input_tokens: 130, output_tokens: 5, input_tokens_details: {cached_tokens: 100}, output_tokens_details: {reasoning_tokens: 3}}))
        .toEqual({input_tokens: 130, output_tokens: 5, total_tokens: 135, cached_input_tokens: 100, reasoning_tokens: 3});
});
