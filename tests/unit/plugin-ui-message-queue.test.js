import {enqueuePluginUiBridge} from '../../src/utils/plugins/runtime/pluginUiMessageQueue';

test('diagnostics and application calls cannot consume each other’s uncorrelated replies', async () => {
    const order = [];
    let release;
    const diagnostics = enqueuePluginUiBridge('plugin', 'session', () => {
        order.push('diagnostics');
        return new Promise(resolve => {release = resolve;});
    });
    const handler = enqueuePluginUiBridge('plugin', 'session', () => {order.push('handler'); return 'handler result';});
    await Promise.resolve();
    expect(order).toEqual(['diagnostics']);
    release('diagnostics result');
    await expect(diagnostics).resolves.toBe('diagnostics result');
    await expect(handler).resolves.toBe('handler result');
    expect(order).toEqual(['diagnostics', 'handler']);
});

test('restarted workers and other plugins do not wait for an old worker’s pending reply', async () => {
    let release;
    const old = enqueuePluginUiBridge('plugin', 'old', () => new Promise(resolve => {release = resolve;}));
    await Promise.resolve();
    await expect(enqueuePluginUiBridge('plugin', 'new', () => 'new')).resolves.toBe('new');
    await expect(enqueuePluginUiBridge('other', 'old', () => 'other')).resolves.toBe('other');
    release();
    await old;
});

test('a failed dispatch does not poison subsequent requests', async () => {
    const first = enqueuePluginUiBridge('failure', 'session', () => {throw new Error('dispatch failed');});
    const failure = expect(first).rejects.toThrow('dispatch failed');
    const second = enqueuePluginUiBridge('failure', 'session', () => 'recovered');
    await failure;
    await expect(second).resolves.toBe('recovered');
});
