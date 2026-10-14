/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {ipcMain} from 'electron';
import {settings} from '../../src/utils/persistence/store';
import LLM from '../../src/utils/ai/providers/aiProviderClient';
import {registerAiCodingAgentHandlers} from '../../src/ipc/ai_coding_agent';
import {AiCodingAgentChannels} from '../../src/ipc/channels';

jest.mock('electron', () => ({app: {getPath: () => '/tmp', getAppPath: () => '/fdo', isPackaged: true}, ipcMain: {handle: jest.fn()}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(), set: jest.fn()}}));
jest.mock('../../src/utils/ai/providers/aiProviderClient', () => jest.fn());
beforeEach(() => {jest.useFakeTimers(); settings.get.mockImplementation((key, fallback) => key === 'ai.coding'
    ? [{id: 'reasoning-test', provider: 'openai', model: 'fixture-model', apiKey: 'fixture', firstResponseTimeoutMs: 90000}] : fallback);});
afterEach(() => {jest.clearAllTimers(); jest.useRealTimers();});

test.each(['reasoning-before-answer', 'reasoning-after-prefix', 'empty-reasoning', 'buffered'])('backend completes delayed large-file generation during %s without an idle or first-answer abort', async mode => {
    const source = `export const payload = "${'x'.repeat(12000)}";`;
    const client = {system: jest.fn(), messages: [], abort: jest.fn(), describeTransport: () => 'Fixture provider running.'};
    client.chat = jest.fn(async (_prompt, options) => {
        if (mode === 'buffered') options.onResponseMode('buffered');
        return {stream: (async function* () {
            if (mode === 'reasoning-after-prefix') yield {type: 'content', content: 'Preparing the file.\n'};
            if (mode !== 'buffered') yield {type: 'thinking', content: mode === 'empty-reasoning' ? '' : 'PRIVATE_REASONING_CANARY'};
            jest.advanceTimersByTime(mode === 'reasoning-after-prefix' ? 60000 : 180000);
            expect(client.abort).not.toHaveBeenCalled();
            yield {type: 'content', content: source};
        })(), complete: async () => ({content: source, usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}})};
    });
    LLM.mockImplementation(() => client);
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.SMART_MODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    const result = await handler(event, {requestId: mode, assistantId: 'reasoning-test', prompt: 'Explain this supplied example.'});
    expect(result.success).toBe(true);
    expect(result.content).toContain(source);
    expect(client.abort).not.toHaveBeenCalled();
    expect(JSON.stringify(event.senderFrame.send.mock.calls)).not.toContain('PRIVATE_REASONING_CANARY');
    expect(jest.getTimerCount()).toBe(0);
});

test('API answer prefixes survive hidden generation beyond 100 seconds and keep the editor informed', async () => {
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding'
        ? [{id: 'reasoning-test', provider: 'openai', model: 'fixture-model', apiKey: 'fixture', firstResponseTimeoutMs: 300000}] : fallback);
    const client = {system: jest.fn(), messages: [], abort: jest.fn()};
    client.chat = jest.fn(async () => ({
        stream: (async function* () {
            yield {type: 'content', content: 'Preparing the answer.\n'};
            jest.advanceTimersByTime(200000);
            expect(client.abort).not.toHaveBeenCalled();
            yield {type: 'content', content: 'Completed answer.'};
        })(), complete: async () => ({content: 'Preparing the answer.\nCompleted answer.'}),
    }));
    LLM.mockImplementation(() => client);
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.SMART_MODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    const result = await handler(event, {requestId: 'silent-continuation', assistantId: 'reasoning-test', prompt: 'Explain this supplied example.'});
    expect(result.success).toBe(true);
    expect(result.content).toContain('Completed answer.');
    expect(client.abort).not.toHaveBeenCalled();
    expect(JSON.stringify(event.senderFrame.send.mock.calls)).toContain('waiting-for-continuation');
    expect(jest.getTimerCount()).toBe(0);
});

test('an old saved API text-only label cannot block a new image request in the backend', async () => {
    settings.get.mockImplementation((key, fallback) => key === 'ai.coding'
        ? [{id: 'reasoning-test', provider: 'openai', model: 'fixture-model', apiKey: 'fixture', firstResponseTimeoutMs: 300000,
            inputCapabilities: {provider: 'openai', model: 'fixture-model', imageSupport: 'unsupported', source: 'provider-metadata', reason: 'Stale metadata'}}] : fallback);
    const client = {system: jest.fn(), messages: [], abort: jest.fn()};
    client.chat = jest.fn(async () => ({stream: (async function* () {yield {type: 'content', content: 'Image received.'};})(), complete: async () => ({content: 'Image received.'})}));
    LLM.mockImplementation(() => client);
    registerAiCodingAgentHandlers();
    const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.PLAN_CODE)[1];
    const event = {sender: Object.assign(new EventEmitter(), {isDestroyed: () => false}), senderFrame: {send: jest.fn(), isDestroyed: () => false, detached: false}};
    // Exercise the actual IPC capability guard and provider dispatch.
    const result = await handler(event, {requestId: 'fresh-image-request', assistantId: 'reasoning-test', prompt: 'Describe this mockup.', image: 'data:image/png;base64,YQ=='});
    expect(result.success).toBe(true);
    expect(client.chat.mock.calls[0][1].image).toBe('data:image/png;base64,YQ==');
});
