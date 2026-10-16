import {createPluginElementWaiter} from '../../src/components/plugin/utils/pluginElementWaiter';

let target, observers;
beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<main><div id="existing"></div></main>';
    observers = [];
    target = {
        setTimeout, clearTimeout, queueMicrotask,
        console: {error: jest.fn()}, reportError: jest.fn(),
        MutationObserver: class {
            constructor(callback) {this.callback = callback;this.disconnect = jest.fn();observers.push(this);}
            observe() {}
        },
    };
});
afterEach(() => {jest.useRealTimers();jest.restoreAllMocks();});
const flush = () => jest.runAllTicks();

test('existing targets resolve asynchronously without waiting for a polling tick', () => {
    const waiter = createPluginElementWaiter(document, target), callback = jest.fn();
    waiter.wait('#existing', callback);
    expect(callback).not.toHaveBeenCalled();
    flush();
    expect(callback).toHaveBeenCalledWith(document.getElementById('existing'));
    expect(jest.getTimerCount()).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    waiter.dispose();
});

test('100 waiters for one selector share a query and observer, with no idle polling', () => {
    const waiter = createPluginElementWaiter(document, target), callback = jest.fn();
    const query = jest.spyOn(document, 'querySelector');
    for (let i = 0; i < 100; i++) waiter.wait('.later', callback);
    flush();
    expect(query).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(1);
    jest.advanceTimersByTime(350);
    expect(query).toHaveBeenCalledTimes(1);
    const node = document.createElement('div');node.className = 'later';document.body.append(node);
    observers[0].callback();observers[0].callback();flush();
    expect(query).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(100);
    expect(callback).toHaveBeenLastCalledWith(node);
    expect(jest.getTimerCount()).toBe(0);
    waiter.dispose();
});

test('attribute changes can satisfy selectors and cancellation leaves sibling waits active', () => {
    const waiter = createPluginElementWaiter(document, target), cancelled = jest.fn(), current = jest.fn();
    const cancel = waiter.wait('[data-ready]', cancelled);
    waiter.wait('[data-ready]', current);cancel();cancel();flush();
    const node = document.getElementById('existing');node.dataset.ready = 'true';
    observers[0].callback();flush();
    expect(cancelled).not.toHaveBeenCalled();expect(current).toHaveBeenCalledWith(node);
    expect(jest.getTimerCount()).toBe(0);
    waiter.dispose();
});

test('only an expired waiter is removed; longer sibling waits can still complete', () => {
    const waiter = createPluginElementWaiter(document, target), expired = jest.fn(), current = jest.fn();
    waiter.wait('#later', expired, 100);waiter.wait('#later', current, 1000);flush();
    jest.advanceTimersByTime(100);
    expect(target.console.error).toHaveBeenCalledWith('Timeout: Element not found:', '#later');
    const node = document.createElement('div');node.id = 'later';document.body.append(node);
    observers[0].callback();flush();
    expect(expired).not.toHaveBeenCalled();expect(current).toHaveBeenCalledWith(node);
    expect(jest.getTimerCount()).toBe(0);
    waiter.dispose();
});

test('view disposal clears all work and stale references cannot start new waits', () => {
    const waiter = createPluginElementWaiter(document, target), callback = jest.fn();
    waiter.wait('#later', callback);flush();
    const query = jest.spyOn(document, 'querySelector');
    waiter.dispose();waiter.dispose();
    document.body.innerHTML = '<div id="later"></div>';
    observers[0].callback();flush();jest.advanceTimersByTime(6000);
    waiter.wait('#later', callback);flush();
    expect(query).not.toHaveBeenCalled();expect(callback).not.toHaveBeenCalled();
    expect(target.console.error).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
});

test('a throwing callback does not strand other waiters, and disposal inside a callback cancels the batch', () => {
    const waiter = createPluginElementWaiter(document, target), callback = jest.fn();
    const failure = new Error('Callback failed');
    waiter.wait('#existing', () => {throw failure;});waiter.wait('#existing', callback);flush();
    expect(target.reportError).toHaveBeenCalledWith(failure);expect(callback).toHaveBeenCalledTimes(1);
    waiter.wait('#existing', () => waiter.dispose());waiter.wait('#existing', callback);flush();
    expect(callback).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});

test('invalid selectors fail once and release observers and timers', () => {
    const waiter = createPluginElementWaiter(document, target);
    waiter.wait(')', jest.fn());flush();
    expect(target.reportError).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    waiter.dispose();
});
