/** @jest-environment node */
import {estimateCost, rateKey, validateRate} from '../../src/utils/aiBilling/pricing';
import {UsageLedger, configureUsageLedger, runWithUsageContext, currentTurnUsage} from '../../src/utils/aiBilling/ledger';
import AiProviderClient from '../../src/utils/aiProviderClient';
import {consume, responseFor} from '../helpers/aiProviderWire';
import {tokenUsage} from '../../src/utils/aiProviders/messages';

const at = '2026-09-20T12:00:00.000Z';
const price = (provider, usage, extra = {}) => estimateCost({provider, model: 'test-model', at, usage,
    rate: {input: 2, output: 10, cached: .2, cacheWrite: 2.5, cacheWriteHour: 4}, ...extra});

test('OpenAI cached input is discounted and reasoning already included in output is not billed twice', () => {
    expect(price('openai', {input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100, reasoning_tokens: 40}))
        .toMatchObject({status: 'estimated', inputCost: .00164, outputCost: .001, totalCost: .00264});
});
test('OpenAI cache-write usage is part of input, while Claude reports cache usage separately', () => {
    expect(tokenUsage({input_tokens: 1000, output_tokens: 10, input_tokens_details: {cached_tokens: 100, cache_write_tokens: 200}}))
        .toMatchObject({input_tokens: 1000, cache_write_tokens: 200, total_tokens: 1010});
    expect(tokenUsage({input_tokens: 700, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 200}))
        .toMatchObject({input_tokens: 1000, cache_write_tokens: 200, total_tokens: 1010});
});
test('Claude cache read, five-minute and one-hour write charges use their own rates', () => {
    const usage = tokenUsage({input_tokens: 600, output_tokens: 100, cache_read_input_tokens: 100,
        cache_creation_input_tokens: 300, cache_creation: {ephemeral_1h_input_tokens: 100}});
    expect(price('anthropic', usage)).toMatchObject({inputCost: .00212, outputCost: .001, totalCost: .00312});
});
test('Gemini Interactions adds separately reported thought tokens to billable output', () => {
    expect(price('gemini', {input_tokens: 1000, output_tokens: 100, reasoning_tokens: 50}))
        .toMatchObject({outputCost: .0015, billableOutputTokens: 150});
});
test('Cloudflare uses its model rate before account free allocations', () => {
    expect(estimateCost({provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b', at, usage: {input_tokens: 1000000, output_tokens: 1000000}}))
        .toMatchObject({status: 'estimated', inputCost: .45, outputCost: 3.2, totalCost: 3.65});
});
test.each(['codex-cli', 'gemini-cli'])('%s billing is external, never a made-up zero', provider => {
    expect(price(provider)).toMatchObject({status: 'external'});
    expect(price(provider)).not.toHaveProperty('totalCost');
});
test('local Ollama reports zero API charges without pretending compute is free', () => {
    expect(price('ollama')).toMatchObject({status: 'local', totalCost: 0, reason: expect.stringContaining('hardware')});
});
test.each([
    {usage: undefined}, {usage: {input_tokens: 100}}, {usage: {output_tokens: 1}},
    {usage: {input_tokens: 10, output_tokens: 2, cached_input_tokens: 11}},
    {usage: {input_tokens: 10, output_tokens: -1}}, {completeUsage: false},
    {serviceTier: 'priority'}, {rate: {input: 1, output: 2, validUntil: '2026-09-19'}},
    {rate: {input: 1, output: 2, maxInputTokens: 5}},
])('unknown or incomplete billing never produces a zero cost: %#', override => {
    const result = price('openai', {input_tokens: 10, output_tokens: 2}, override);
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('totalCost');
});
test('model names are exact and cache categories need explicit rates', () => {
    expect(estimateCost({provider: 'openai', model: 'gpt-5.4-future', at, usage: {input_tokens: 1, output_tokens: 1}}).status).toBe('unknown');
    expect(price('cloudflare', {input_tokens: 10, output_tokens: 1, cached_input_tokens: 2}, {rate: {input: 1, output: 2}}).status).toBe('unknown');
    expect(price('openai', {input_tokens: 0, output_tokens: 0}).totalCost).toBe(0);
});
test.each([{input: -1, output: 1}, {input: NaN, output: 1}, {input: 1, output: Infinity}, {input: '', output: 1}, {input: 1, output: 1, cached: -1}])('rejects malformed custom rates %#', rate => {
    expect(() => validateRate(rate)).toThrow();
});
test('a request pins its prices; repeated completion cannot double count; unknown stays separate', () => {
    const key = rateKey('openai', 'test-model');
    const ledger = new UsageLedger({rates: {[key]: {input: 2, output: 10}}, now: () => at});
    const entry = ledger.begin('openai', 'test-model', {surface: 'chat', sessionId: 'one'});
    ledger.rates[key].input = 999;
    entry.finish('completed', {input_tokens: 1000, output_tokens: 100}, {completeUsage: true});
    entry.finish('completed', {input_tokens: 9999999, output_tokens: 9999999}, {completeUsage: true});
    ledger.begin('openai', 'test-model', {surface: 'chat', sessionId: 'one'}).finish('cancelled');
    expect(ledger.snapshot({sessionId: 'one'}).groups[0]).toMatchObject({requests: 2, unknown: 1, priced: 1, knownCost: .003});
    expect(ledger.snapshot({sessionId: 'two'}).requests).toBe(0);
});
test('restart preserves historical prices and marks pending requests interrupted; persistence failure is visible', () => {
    const ledger = new UsageLedger({now: () => at});
    ledger.begin('openai', 'test-model');
    const restored = new UsageLedger({entries: JSON.parse(JSON.stringify(ledger.entries)), save: () => { throw new Error('disk full'); }});
    expect(restored.snapshot().entries[0]).toMatchObject({status: 'interrupted', cost: {status: 'unknown'}});
    restored.changed();
    expect(restored.snapshot().persistenceError).toBe(true);
});
test('native truncation and retry both count, and concurrent chats keep separate scopes without saving prompts', async () => {
    const ledger = configureUsageLedger({now: () => at, rates: {[rateKey('openai', 'test-model')]: {input: 2, output: 10}}});
    await Promise.all(['one', 'two'].map(sessionId => runWithUsageContext({surface: 'chat', sessionId}, async () => {
        for (const status of ['incomplete', 'completed']) {
            const fetchImpl = async () => responseFor([{type: 'response.output_text.delta', delta: 'private prompt content'},
                {type: `response.${status}`, response: {status, usage: {input_tokens: 1000, output_tokens: 100},
                    ...(status === 'incomplete' ? {incomplete_details: {reason: 'max_output_tokens'}} : {})}}]);
            const response = await new AiProviderClient({service: 'openai', model: 'test-model', apiKey: 'secret-key', fetchImpl}).chat('sensitive prompt', {stream: true});
            if (status === 'incomplete') await expect(consume(response)).rejects.toThrow('max_tokens');
            else expect((await consume(response)).complete.usage.total_cost).toBe(.003);
        }
    })));
    for (const sessionId of ['one', 'two']) expect(ledger.snapshot({sessionId}).groups[0]).toMatchObject({requests: 2, knownCost: .006});
    expect(JSON.stringify(ledger.entries)).not.toMatch(/private prompt|sensitive prompt|secret-key/);
});

test('chat turn totals include routing and follow-ups but exclude other turns and sessions', () => {
    const ledger = configureUsageLedger({now: () => at, rates: {[rateKey('openai', 'test-model')]: {input: 2, output: 10}}});
    const scope = {surface: 'chat', sessionId: 'one', requestId: 'turn-1'};
    for (const context of [scope, scope, {...scope, requestId: 'turn-2'}, {...scope, sessionId: 'two'}]) {
        ledger.begin('openai', 'test-model', context).finish('completed', {input_tokens: 1000, output_tokens: 100, total_tokens: 1100}, {completeUsage: true});
    }
    expect(runWithUsageContext(scope, currentTurnUsage)).toMatchObject({usageScope: 'turn', usageRequests: 2,
        inputTokens: 2000, outputTokens: 200, totalTokens: 2200, totalCost: .006, costStatus: 'estimated'});
    ledger.begin('openai', 'test-model', scope).finish('failed');
    expect(runWithUsageContext(scope, currentTurnUsage)).toMatchObject({usageRequests: 3, totalCost: undefined,
        inputTokens: undefined, knownCost: .006, costStatus: 'partial'});
    expect(currentTurnUsage()).toEqual({});
});
