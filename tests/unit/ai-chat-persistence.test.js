/** @jest-environment node */
import {prepareSessionMessage, persistClarificationResponse, withSessionLock} from '../../src/ipc/ai/ai_chat_core';
import {chatStorage} from '../../src/utils/persistence/chatStorage';
import {settings} from '../../src/utils/persistence/store';

jest.mock('../../src/utils/persistence/chatStorage', () => ({chatStorage: {get: jest.fn(), put: jest.fn()}}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(), set: jest.fn()}}));
const now = '2026-10-16T10:00:00Z';
const original = () => ({id: 'first', name: 'Existing conversation', createdAt: now, messages: [
    {id: 'one', role: 'user', content: 'Original question', createdAt: now},
    {id: 'two', role: 'assistant', content: 'Original reply', createdAt: now},
]});
beforeEach(() => { jest.clearAllMocks(); settings.get.mockReturnValue(undefined); chatStorage.put.mockResolvedValue(true); });

test('loads only the requested conversation and waits for its user message to commit', async () => {
    chatStorage.get.mockResolvedValue(original());
    let finish;
    chatStorage.put.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let settled = false;
    const request = prepareSessionMessage('first', 'Follow-up', undefined, {id: 'one'}).then(result => { settled = true; return result; });
    await new Promise(setImmediate);
    expect(chatStorage.get).toHaveBeenCalledWith('first');
    expect(chatStorage.put).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finish(true);
    const result = await request;
    expect(result.sessions).toHaveLength(1);
    expect(result.session.messages.at(-1)).toMatchObject({content: 'Follow-up', replyTo: {id: 'one'}});
    expect(settings.set).not.toHaveBeenCalled();
});

test('clarification responses persist only the changed session', async () => {
    const first = original();
    const second = {...original(), id: 'second'};
    const result = await persistClarificationResponse(first, [first, second], 0, 'Which scope?', {route: 'general', scope: 'general'});
    expect(result.messages.at(-1)).toMatchObject({content: 'Which scope?', clarification: true});
    expect(chatStorage.put).toHaveBeenCalledWith(result);
    expect(settings.set).not.toHaveBeenCalled();
});

test('three operations on the same session remain serialized', async () => {
    let release;
    const order = [];
    const first = withSessionLock('queue', async () => { order.push('first'); await new Promise(resolve => { release = resolve; }); });
    const second = withSessionLock('queue', async () => { order.push('second'); });
    const third = withSessionLock('queue', async () => { order.push('third'); });
    expect(order).toEqual(['first']);
    release();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
});
