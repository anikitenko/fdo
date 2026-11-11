import {EventEmitter} from 'node:events';
import {enqueuePluginUiBridge, cancelPluginUiBridge} from '../../src/utils/plugins/runtime/pluginUiMessageQueue';
import {requestPluginUiMessage, postPluginMessage} from '../../src/utils/plugins/runtime/pluginUiRequest';
import {watchPluginWorker, createPluginRestartLimiter} from '../../src/utils/plugins/runtime/pluginWatchdog';

const worker = () => Object.assign(new EventEmitter(), {postMessage: jest.fn()});
afterEach(() => {jest.useRealTimers();});

test('bounds the queue, expires waiting calls from enqueue time and cancels every entry on unload', async () => {
    jest.useFakeTimers();
    let signal;
    const first = enqueuePluginUiBridge('bounded', 'one', context => {signal = context.signal; return new Promise(() => {});}, {timeoutMs: 1000});
    await Promise.resolve();
    const skipped = jest.fn();
    const waiting = enqueuePluginUiBridge('bounded', 'one', skipped, {timeoutMs: 10});
    const rest = Array.from({length: 30}, () => enqueuePluginUiBridge('bounded', 'one', skipped));
    await expect(enqueuePluginUiBridge('bounded', 'one', skipped)).resolves.toMatchObject({code: 'PLUGIN_BACKEND_BUSY'});
    await jest.advanceTimersByTimeAsync(10);
    await expect(waiting).resolves.toMatchObject({code: 'PLUGIN_BACKEND_QUEUE_TIMEOUT'});
    expect(skipped).not.toHaveBeenCalled();
    cancelPluginUiBridge('bounded', 'one');
    await expect(first).resolves.toMatchObject({code: 'PLUGIN_BACKEND_CANCELLED'});
    expect(signal.aborted).toBe(true);
    await Promise.all(rest);
    expect(jest.getTimerCount()).toBe(0);
});

test('a timed-out legacy reply cannot satisfy another request in the same worker session', async () => {
    jest.useFakeTimers();
    const child = worker();
    const first = requestPluginUiMessage(child, 'late', 'old', {}, {timeoutMs: 10});
    const second = requestPluginUiMessage(child, 'late', 'old', {}, {timeoutMs: 100});
    await jest.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toMatchObject({code: 'PLUGIN_BACKEND_TIMEOUT'});
    await expect(second).resolves.toMatchObject({code: 'PLUGIN_BACKEND_SESSION_EXPIRED'});
    child.emit('message', {type: 'UI_MESSAGE', response: 'late reply'});
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
    await expect(requestPluginUiMessage(child, 'late', 'old', {})).resolves.toMatchObject({code: 'PLUGIN_BACKEND_SESSION_EXPIRED'});
    const fresh = requestPluginUiMessage(child, 'late', 'new', {});
    await jest.advanceTimersByTimeAsync(0);
    child.emit('message', {type: 'UI_MESSAGE', response: 'fresh reply'});
    await expect(fresh).resolves.toBe('fresh reply');
    cancelPluginUiBridge('late', 'old');
    expect(jest.getTimerCount()).toBe(0);
});

test('worker exit and dispatch failure settle requests and remove listeners', async () => {
    const child = worker();
    const pending = requestPluginUiMessage(child, 'exit', 'one', {});
    await Promise.resolve();
    child.emit('exit', 1);
    await expect(pending).resolves.toMatchObject({code: 'PLUGIN_BACKEND_UNAVAILABLE'});
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    child.postMessage.mockImplementation(() => {throw new Error('closed');});
    await expect(requestPluginUiMessage(child, 'dispatch', 'one', {})).resolves.toMatchObject({code: 'PLUGIN_BACKEND_UNAVAILABLE'});
});

test('heartbeats detect an unresponsive worker once, ignore forged replies, recover and clean up', async () => {
    jest.useFakeTimers();
    const child = worker();
    const change = jest.fn();
    const stop = watchPluginWorker(child, change, {intervalMs: 20, timeoutMs: 10, missedLimit: 3});
    child.emit('message', {type: 'HOST_PLUGIN_HEARTBEAT_REPLY_V1', requestId: 'forged'});
    await jest.advanceTimersByTimeAsync(50);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({status: 'unresponsive'}));
    await jest.advanceTimersByTimeAsync(10);
    const requestId = child.postMessage.mock.calls.at(-1)[0].content.requestId;
    child.emit('message', {type: 'HOST_PLUGIN_HEARTBEAT_REPLY_V1', requestId});
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({status: 'responsive'}));
    stop(); stop();
    expect(child.listenerCount('message')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
});

test('responsive heartbeats do not report async background work as a hang; exit clears timers', async () => {
    jest.useFakeTimers();
    const child = worker();
    child.postMessage.mockImplementation(message => queueMicrotask(() => child.emit('message', {
        type: 'HOST_PLUGIN_HEARTBEAT_REPLY_V1', requestId: message.content.requestId,
    })));
    const change = jest.fn();
    watchPluginWorker(child, change, {intervalMs: 20, timeoutMs: 10});
    await jest.advanceTimersByTimeAsync(200);
    expect(change).not.toHaveBeenCalled();
    child.emit('exit');
    expect(jest.getTimerCount()).toBe(0);
});

test('restart budget blocks crash loops and recovers after its time window', () => {
    jest.useFakeTimers();
    const allow = createPluginRestartLimiter();
    expect([allow('one'), allow('one'), allow('one'), allow('one')]).toEqual([true, true, true, false]);
    expect(allow('two')).toBe(true);
    jest.advanceTimersByTime(600000);
    expect(allow('one')).toBe(true);
});


test('safe worker replies contain a disconnected port error', () => {
    expect(postPluginMessage({postMessage() {throw new Error('closed');}}, {})).toBe(false);
});
