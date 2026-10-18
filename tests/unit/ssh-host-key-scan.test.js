/** @jest-environment node */
const {test, expect, jest: mock} = require('@jest/globals');
const {EventEmitter} = require('node:events');
const {createHostKeyScanner} = require('../../src/utils/hostServices/hostKeyScan.cjs');
const {fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
const type = Buffer.from('ssh-ed25519'), length = Buffer.alloc(4); length.writeUInt32BE(type.length);
const raw = Buffer.concat([length, type, Buffer.alloc(32, 7)]);
class Client extends EventEmitter {
    static instances = [];
    constructor() {super(); Client.instances.push(this); this.destroy = mock.fn();}
    connect(options) {this.options = options;}
}
const endpoint = {host: 'example.com', port: 2222};
test('retrieves a candidate while rejecting the key before authentication and auditing only safe metadata', async () => {
    Client.instances = []; const audit = mock.fn(), scanner = createHostKeyScanner({Client, audit});
    const pending = scanner.scan('owner', endpoint); const client = Client.instances[0];
    expect(client.options.hostVerifier(raw)).toBe(false);
    expect(client.options).not.toHaveProperty('password'); expect(client.options).not.toHaveProperty('privateKey'); expect(client.options).not.toHaveProperty('agent');
    expect(await pending).toEqual({...endpoint, keyType: 'ssh-ed25519', fingerprint: fingerprint(raw)});
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls.map(call => call.slice(0, 3))).toEqual([['owner', 'ssh.hostKey.fetch', 'STARTED'], ['owner', 'ssh.hostKey.fetch', 'OK']]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('SHA256:'); scanner.close();
});
test('bounds pending scans and cleans up on cancellation, timeout and shutdown', async () => {
    Client.instances = []; mock.useFakeTimers(); const scanner = createHostKeyScanner({Client, timeoutMs: 20});
    try {
        const pending = Array.from({length: 4}, () => scanner.scan('owner', endpoint));
        const settled = Promise.allSettled(pending);
        await expect(scanner.scan('other', endpoint)).rejects.toMatchObject({code: 'UNAVAILABLE'});
        mock.advanceTimersByTime(20);
        expect((await settled).every(item => item.reason.code === 'TIMEOUT')).toBe(true);
        expect(Client.instances.every(client => client.destroy.mock.calls.length === 1)).toBe(true);
        const cancelled = scanner.scan('owner', endpoint); const rejected = expect(cancelled).rejects.toMatchObject({code: 'ACCESS_DENIED'});
        scanner.cancel('owner'); await rejected;
        const shutdown = scanner.scan('owner', endpoint); const stopped = expect(shutdown).rejects.toMatchObject({code: 'UNAVAILABLE'});
        scanner.close(); await stopped;
        await expect(scanner.scan('owner', endpoint)).rejects.toMatchObject({code: 'UNAVAILABLE'});
    } finally {scanner.close(); mock.useRealTimers();}
});
test('sanitizes failures, rejects malformed keys and honors disconnected callers', async () => {
    Client.instances = []; const scanner = createHostKeyScanner({Client});
    const pending = scanner.scan('owner', endpoint);
    Client.instances[0].emit('error', new Error('PRIVATE PROVIDER DETAIL'));
    await expect(pending).rejects.toMatchObject({code: 'CONNECTION_FAILED', message: 'Host service request failed.'});
    const malformed = scanner.scan('owner', endpoint); Client.instances.at(-1).options.hostVerifier(Buffer.from('bad'));
    await expect(malformed).rejects.toMatchObject({code: 'CONNECTION_FAILED'});
    const controller = new AbortController(); const aborted = scanner.scan('owner', endpoint, controller.signal);
    controller.abort(); await expect(aborted).rejects.toMatchObject({code: 'ACCESS_DENIED'}); scanner.close();
});
