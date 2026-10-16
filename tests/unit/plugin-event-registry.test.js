/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {createPluginEventRegistry} from '../../src/utils/plugins/runtime/pluginEventRegistry';

test('unknown cleanup cannot silence other plugin frames', () => {
    const ipc = new EventEmitter(), registry = createPluginEventRegistry(ipc);
    const first = jest.fn(), second = jest.fn();
    const offFirst = registry.add('render', 'render', first);
    registry.remove('render', 'render', () => {});
    const offSecond = registry.add('render', 'render', second);
    ipc.emit('render', {}, {id: 'first'});
    expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);
    offSecond();offSecond();
    ipc.emit('render', {}, {id: 'second'});
    expect(first).toHaveBeenCalledTimes(2);expect(second).toHaveBeenCalledTimes(1);
    offFirst();expect(ipc.listenerCount('render')).toBe(0);
});

test('a disposer removes its exact wrapper even when callback identity changes across the bridge', () => {
    const ipc = new EventEmitter(), registry = createPluginEventRegistry(ipc), callback = jest.fn();
    const firstProxy = value => callback(value), secondProxy = value => callback(value);
    const cleanup = registry.add('uiMessage', 'message', firstProxy);
    const current = registry.add('uiMessage', 'message', secondProxy);
    cleanup();
    ipc.emit('message', {}, {value: 'current'});
    expect(callback).toHaveBeenCalledTimes(1);
    current();expect(ipc.listenerCount('message')).toBe(0);
});

test('stale cleanup preserves a replacement registration for the same callback', () => {
    const ipc = new EventEmitter(), registry = createPluginEventRegistry(ipc), callback = jest.fn();
    const stale = registry.add('ready', 'ready', callback);
    const current = registry.add('ready', 'ready', callback, value => value.id);
    stale();
    expect(ipc.listenerCount('ready')).toBe(1);
    ipc.emit('ready', {}, {id: 'plugin'});
    expect(callback).toHaveBeenCalledWith('plugin');
    registry.remove('ready', 'ready', callback);
    current();expect(ipc.listenerCount('ready')).toBe(0);
});
