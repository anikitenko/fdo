/** @jest-environment node */
const {test, expect} = require('@jest/globals');
const {Client, Server, utils} = require('ssh2');
const {createHostKeyScanner} = require('../../src/utils/hostServices/hostKeyScan.cjs');
const {fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
test('real SSH discovery returns the offered key with zero authentication attempts', async () => {
    const key = utils.generateKeyPairSync('ed25519');
    const connections = new Set(); let authenticationAttempts = 0;
    const server = new Server({hostKeys: [key.private]}, connection => {
        connections.add(connection); connection.on('error', () => {}); connection.on('close', () => connections.delete(connection));
        connection.on('authentication', ctx => {authenticationAttempts++; ctx.reject();});
    });
    const scanner = createHostKeyScanner({Client, timeoutMs: 3000});
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    try {
        expect(await scanner.scan('owner', {host: '127.0.0.1', port: server.address().port})).toEqual({
            host: '127.0.0.1', port: server.address().port, keyType: 'ssh-ed25519', fingerprint: fingerprint(utils.parseKey(key.private).getPublicSSH()),
        });
        expect(authenticationAttempts).toBe(0);
    } finally {
        scanner.close();
        await Promise.all([...connections].map(connection => new Promise(resolve => {connection.once('close', resolve); connection.end();})));
        await new Promise(resolve => server.close(resolve));
    }
}, 10000);
