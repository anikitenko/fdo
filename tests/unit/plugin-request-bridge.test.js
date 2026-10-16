import {createPluginRequestBridge} from '../../src/components/plugin/utils/pluginRequestBridge';

function fixture() {
    const listeners = new Set();
    const parent = {postMessage: jest.fn()};
    const target = {
        parent,
        addEventListener: jest.fn((_type, listener) => listeners.add(listener)),
        removeEventListener: jest.fn((_type, listener) => listeners.delete(listener)),
    };
    const reply = (requestId, content, extra = {}) => {
        for (const listener of listeners) listener({source: parent, origin: 'https://host.test',
            data: {type: 'UI_MESSAGE_RESPONSE', requestId, content}, ...extra});
    };
    return {bridge: createPluginRequestBridge(target), target, parent, reply};
}

test('routes 1,000 concurrent replies out of order through one listener', async () => {
    const {bridge, target, parent, reply} = fixture();
    const requests = Array.from({length: 1000}, (_, i) => bridge.request('echo', i));
    const messages = parent.postMessage.mock.calls.map(([message]) => message);
    expect(new Set(messages.map(message => message.requestId)).size).toBe(1000);
    for (const message of [...messages].reverse()) reply(message.requestId, message.message.content);
    expect(await Promise.all(requests)).toEqual(Array.from({length: 1000}, (_, i) => i));
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    bridge.dispose();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
});

test('ignores untrusted, malformed and duplicate replies; preserves backend errors', async () => {
    const {bridge, parent, reply} = fixture();
    const resolved = jest.fn();
    const result = bridge.request('echo', {}).then(resolved);
    const requestId = parent.postMessage.mock.calls[0][0].requestId;
    reply(requestId, 'untrusted', {source: {}, origin: 'https://attacker.test'});
    reply(requestId, 'wrong type', {data: {type: 'PLUGIN_RENDER', requestId}});
    reply('unknown', 'wrong request');
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    reply(requestId, null, {data: {type: 'UI_MESSAGE_RESPONSE', requestId, error: 'Permission denied'}});
    reply(requestId, 'duplicate');
    await result;
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledWith({success: false, error: 'Permission denied'});
    bridge.dispose();
});

test('registers a pending request before posting, even for synchronous replies', async () => {
    const {bridge, parent, reply} = fixture();
    parent.postMessage.mockImplementation(({requestId}) => reply(requestId, 'immediate'));
    await expect(bridge.request('echo', null)).resolves.toBe('immediate');
    bridge.dispose();
});

test('preserves SDK envelopes, handler normalization and legacy calls', async () => {
    const {bridge, parent} = fixture();
    const requests = [bridge.request('UI_MESSAGE', {handler: ' echo ', content: null}),
        bridge.request('UI_MESSAGE', {action: 'read'}), bridge.request('echo', [1, 2])];
    expect(parent.postMessage.mock.calls.map(([message]) => message.message)).toEqual([
        {handler: 'echo', content: null},
        {handler: 'requestPrivilegedAction', content: {action: 'read'}},
        {handler: 'echo', content: [1, 2]},
    ]);
    bridge.dispose();
    await Promise.all(requests);
});

test('cancels requests on view replacement, ignores old replies, and keeps the new view usable', async () => {
    const {bridge, parent, reply} = fixture();
    const old = bridge.request('echo', 'old');
    const oldId = parent.postMessage.mock.calls[0][0].requestId;
    bridge.reset();
    await expect(old).resolves.toMatchObject({success: false, error: expect.stringContaining('disposed')});
    const current = bridge.request('echo', 'new');
    const newId = parent.postMessage.mock.calls[1][0].requestId;
    reply(oldId, 'stale');
    reply(newId, 'fresh');
    await expect(current).resolves.toBe('fresh');
    const unfinished = bridge.request('echo', 'unfinished');
    bridge.dispose(); bridge.dispose();
    await expect(unfinished).resolves.toMatchObject({success: false});
    await expect(bridge.request('echo', 'after disposal')).resolves.toMatchObject({success: false});
    expect(parent.postMessage).toHaveBeenCalledTimes(3);
});

test('rejects transport failures without keeping pending requests', async () => {
    const {bridge, parent, reply} = fixture();
    parent.postMessage.mockImplementationOnce(() => {throw new Error('Cannot clone data');});
    await expect(bridge.request('echo', () => {})).rejects.toThrow('Cannot clone data');
    const request = bridge.request('echo', 'next');
    reply(parent.postMessage.mock.calls[1][0].requestId, 'okay');
    await expect(request).resolves.toBe('okay');
    bridge.dispose();
});
