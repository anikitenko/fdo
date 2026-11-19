/** @jest-environment node */
import {postPluginRender, consumePluginRenderRequest} from '../../src/utils/plugins/runtime/pluginRenderRequests';

afterEach(() => jest.useRealTimers());

test('an earlier automatic reply cannot consume a later navigation replacement intent', () => {
    const child = {postMessage: jest.fn()};
    postPluginRender(child);
    postPluginRender(child, {replace: true});
    const automatic = consumePluginRenderRequest(child);
    const navigation = consumePluginRenderRequest(child);
    expect(automatic.replace).toBe(false);
    expect(navigation.replace).toBe(true);
    expect(automatic.id).not.toBe(navigation.id);
    expect(consumePluginRenderRequest(child)).toEqual({replace: false});
});

test('requests are isolated by worker, expire conservatively, and stay bounded', () => {
    jest.useFakeTimers();
    const child = {postMessage: jest.fn()};
    const sibling = {postMessage: jest.fn()};
    postPluginRender(child, {replace: true});
    expect(consumePluginRenderRequest(sibling)).toEqual({replace: false});
    jest.advanceTimersByTime(10001);
    expect(consumePluginRenderRequest(child).replace).toBe(false);
    for (let i = 0; i < 32; i++) postPluginRender(child);
    expect(() => postPluginRender(child)).toThrow('queue is full');
});

test('dispatch failures remove only their own intent', () => {
    const child = {postMessage: jest.fn()};
    postPluginRender(child);
    child.postMessage.mockImplementationOnce(() => {throw new Error('Worker disconnected');});
    expect(() => postPluginRender(child, {replace: true})).toThrow('Worker disconnected');
    expect(consumePluginRenderRequest(child).replace).toBe(false);
    expect(consumePluginRenderRequest(child)).toEqual({replace: false});
});
