/** @jest-environment node */
import fs from 'node:fs/promises';
import {Agent, Cursor} from '@cursor/sdk';
import {listCursorModels, inspectCursorModel} from '../../src/utils/ai/providers/cursorProvider';
import AiProviderClient from '../../src/utils/ai/providers/aiProviderClient';
import {configureUsageLedger, usageLedger} from '../../src/utils/ai/billing/ledger';
import {rateKey} from '../../src/utils/ai/billing/pricing';

jest.mock('@cursor/sdk', () => ({Agent: {create: jest.fn()}, Cursor: {models: {list: jest.fn()}}, JsonlLocalAgentStore: jest.fn()}));
const catalog = [{id: 'composer-fixture', displayName: 'Composer fixture'},
    {id: 'auto-smart', displayName: 'Router', parameters: [{id: 'optimize_for', values: [{value: 'cost'}, {value: 'balanced'}]}]}];
let agent, run;
beforeEach(() => {
    jest.clearAllMocks();
    configureUsageLedger({});
    Cursor.models.list.mockResolvedValue(catalog);
    run = {status: 'finished', stream: async function* () {
        yield {type: 'thinking', text: 'Reasoning fixture'};
        yield {type: 'assistant', message: {content: [{type: 'text', text: 'export const answer = 42;'}]}};
    }, wait: jest.fn().mockResolvedValue({status: 'finished', result: 'export const answer = 42;',
        usage: {inputTokens: 10, outputTokens: 5, totalTokens: 20, cacheReadTokens: 2, cacheWriteTokens: 3}}), cancel: jest.fn().mockResolvedValue()};
    agent = {send: jest.fn().mockResolvedValue(run), close: jest.fn(), [Symbol.asyncDispose]: jest.fn().mockResolvedValue()};
    Agent.create.mockResolvedValue(agent);
});
const client = () => new AiProviderClient({service: 'cursor', model: 'composer-fixture', apiKey: 'cursor-secret', stream: true});
async function consume(response) {const events = []; for await (const event of response.stream) events.push(event); return {events, result: await response.complete()};}

test('model discovery validates the account without generating tokens and selects a supported router parameter', async () => {
    const models = await listCursorModels('cursor-secret');
    expect(models[0]).toMatchObject({label: 'Composer fixture', value: 'composer-fixture', provider: 'cursor'});
    expect(models[1].modelMetadata.selection).toEqual({id: 'auto-smart', params: [{id: 'optimize_for', value: 'balanced'}]});
    await expect(inspectCursorModel({apiKey: 'cursor-secret', model: 'unavailable'})).rejects.toThrow('not available');
    expect(Agent.create).not.toHaveBeenCalled();
});
test('catalog errors do not expose credentials', async () => {
    Cursor.models.list.mockRejectedValue(new Error('Rejected cursor-secret'));
    await expect(listCursorModels('cursor-secret')).rejects.toThrow('Rejected [REDACTED]');
});
test('API-key streaming preserves context, schema, reasoning and usage while disabling tools and deleting temporary state', async () => {
    const llm = client(); llm.system('Public plugin instructions only.'); llm.assistant('Previous answer.');
    const {events, result} = await consume(await llm.chat('Build the plugin.', {responseSchema: {type: 'object'}}));
    const config = Agent.create.mock.calls[0][0];
    expect(config).toMatchObject({apiKey: 'cursor-secret', model: {id: 'composer-fixture'}, tools: [], disallowedTools: ['mcp', 'task'], mcpServers: {}, agents: {},
        local: {settingSources: [], enableAgentRetries: false}});
    expect(config.local.cwd).toContain('fdo-cursor-');
    expect(agent.send.mock.calls[0][0]).toContain('Public plugin instructions only.');
    expect(agent.send.mock.calls[0][0]).toContain('ASSISTANT:\nPrevious answer.');
    expect(agent.send.mock.calls[0][0]).toContain('FDO validates the result locally');
    expect(events).toContainEqual({type: 'thinking', content: 'Reasoning fixture'});
    expect(result).toMatchObject({content: 'export const answer = 42;', tool_calls: [], usage: {input_tokens: 15, output_tokens: 5, total_tokens: 20}});
    expect(llm.describeTransport()).toContain('response from Cursor');
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    await expect(fs.access(config.local.cwd)).rejects.toMatchObject({code: 'ENOENT'});
});
test('unexpected tool execution fails closed and cleans temporary state', async () => {
    run.stream = async function* () {yield {type: 'tool_call', name: 'shell', status: 'running'};};
    await expect(consume(await client().chat('Build'))).rejects.toThrow('despite the disabled toolset');
    await expect(fs.access(Agent.create.mock.calls[0][0].local.cwd)).rejects.toMatchObject({code: 'ENOENT'});
});
test('Stop cancels the SDK run, releases the stream and removes its temporary state', async () => {
    let release, started;
    const ready = new Promise(resolve => {started = resolve;});
    run.status = 'running';
    run.stream = async function* () {started(); await new Promise(resolve => {release = resolve;});};
    run.cancel.mockImplementation(async () => {run.status = 'cancelled'; release?.();});
    run.wait.mockResolvedValue({status: 'cancelled'});
    const llm = client(); const response = await llm.chat('Build');
    const pending = consume(response); const failure = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    await ready; llm.abort(); await failure;
    expect(run.cancel).toHaveBeenCalled(); expect(agent.close).toHaveBeenCalled();
    await expect(fs.access(Agent.create.mock.calls[0][0].local.cwd)).rejects.toMatchObject({code: 'ENOENT'});
});
test('SDK failure remains an error even if it emitted plausible source', async () => {
    run.wait.mockResolvedValue({status: 'error', error: {message: 'Upstream cursor-secret failed', code: 'upstream_error'}});
    await expect(consume(await client().chat('Build'))).rejects.toMatchObject({code: 'upstream_error', message: 'Upstream [REDACTED] failed'});
});

test('Stop during SDK startup returns immediately and disposes a late-created agent', async () => {
    let finish, entered;
    const ready = new Promise(resolve => {entered = resolve;});
    Agent.create.mockImplementation(() => {entered(); return new Promise(resolve => {finish = resolve;});});
    const llm = client(); const response = await llm.chat('Build');
    const pending = consume(response); const failure = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    await ready; llm.abort(); await failure;
    const root = Agent.create.mock.calls[0][0].local.cwd;
    await expect(fs.access(root)).rejects.toMatchObject({code: 'ENOENT'});
    finish(agent);
    await new Promise(resolve => setImmediate(resolve));
    expect(agent.send).not.toHaveBeenCalled();
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalled();
});

test('Cursor costs reach the shared ledger using cache-aware custom rates', async () => {
    configureUsageLedger({rates: {[rateKey('cursor', 'composer-fixture')]: {input: 2, output: 10, cached: .2, cacheWrite: 2.5}}});
    const {result} = await consume(await client().chat('Build'));
    expect(result.usage.total_cost).toBeCloseTo(.0000779, 12);
    expect(usageLedger.snapshot().entries[0]).toMatchObject({provider: 'cursor', usage: {input_tokens: 15, cached_input_tokens: 2, cache_write_tokens: 3},
        cost: {status: 'estimated', totalCost: .0000779}});
});
test('Cursor cost remains unknown without a verified rate', async () => {
    await consume(await client().chat('Build'));
    expect(usageLedger.snapshot().entries[0].cost).toMatchObject({status: 'unknown'});
    expect(usageLedger.snapshot().entries[0].cost).not.toHaveProperty('totalCost');
});

test('uploaded images reach Cursor as native SDK image parts instead of file paths or prompt text', async () => {
    const llm = client();
    await consume(await llm.chat('Review this UI mockup.', {image: 'data:image/png;base64,aGVsbG8='}));
    expect(agent.send.mock.calls[0][0]).toMatchObject({text: expect.stringContaining('Review this UI mockup.'), images: [{data: 'aGVsbG8=', mimeType: 'image/png'}]});
    expect(agent.send.mock.calls[0][0].text).not.toContain('aGVsbG8=');
    expect(Agent.create.mock.calls[0][0].tools).toEqual([]);
});
test('remote image URLs reach the SDK without reading local files', async () => {
    await consume(await client().chat('Review screenshot.', {attachments: [{url: 'https://example.com/mockup.png', mediaType: 'image/png'}]}));
    expect(agent.send.mock.calls[0][0].images).toEqual([{url: 'https://example.com/mockup.png'}]);
});
test('non-image attachments and local file URLs fail before creating an agent', async () => {
    await expect(consume(await client().chat('Review.', {attachments: [{url: 'file:///private/file.png', mediaType: 'image/png'}]}))).rejects.toThrow('Upload local images instead');
    await expect(consume(await client().chat('Review.', {attachments: [{data: 'abc', mediaType: 'application/pdf'}]}))).rejects.toThrow('require image attachments');
    expect(Agent.create).not.toHaveBeenCalled();
});
