/** @jest-environment node */
const {test, expect} = require('@jest/globals');
const crypto = require('node:crypto');
const {Client, Server, utils} = require('ssh2');
const {generateEd25519, toSsh2PrivateKey} = require('../../src/utils/hostServices/sshKeys.cjs');
const {executeSSH, fingerprint} = require('../../src/utils/hostServices/ssh.cjs');

function parsed(material, passphrase) {
    const value = utils.parseKey(material, passphrase);
    if (value instanceof Error) throw value;
    return Array.isArray(value) ? value[0] : value;
}

test('generated Ed25519 host keys stay parseable by ssh2', () => {
    for (let index = 0; index < 64; index += 1) {
        const key = generateEd25519();
        expect(parsed(key.private).getPublicSSH()).toEqual(key.publicSSH);
    }
});

test('OpenSSL PKCS8 Ed25519 keys are rewritten into OpenSSH for ssh2', () => {
    const node = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {type: 'spki', format: 'pem'},
        privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    });
    expect(utils.parseKey(node.privateKey)).toBeInstanceOf(Error);
    expect(parsed(toSsh2PrivateKey(node.privateKey)).type).toBe('ssh-ed25519');
});

test('executeSSH authenticates with a PKCS8 private key from OpenSSL', async () => {
    const host = generateEd25519();
    const node = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {type: 'spki', format: 'pem'},
        privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    });
    const allowed = parsed(toSsh2PrivateKey(node.privateKey));
    const clients = new Set();
    const server = new Server({hostKeys: [host.private]}, connection => {
        clients.add(connection); connection.on('error', () => {}); connection.on('close', () => clients.delete(connection));
        connection.on('authentication', ctx => {
            if (ctx.method === 'publickey' && ctx.key.data.equals(allowed.getPublicSSH())
                && (!ctx.signature || allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) return ctx.accept();
            ctx.reject();
        });
        connection.on('ready', () => connection.on('session', accept => accept().on('exec', (acceptCommand, reject, info) => {
            if (info.command !== 'whoami') return reject();
            const stream = acceptCommand(); stream.write('ok'); stream.exit(0); stream.end();
        })));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    try {
        const result = await executeSSH({Client, profile: {host: '127.0.0.1', port: server.address().port, username: 'fixture', trustedHostKey: fingerprint(host.publicSSH)},
            credentials: {privateKey: node.privateKey}, command: 'whoami', timeoutMs: 3000, maxOutputBytes: 1024});
        expect(result).toMatchObject({stdout: 'ok', exitCode: 0});
    } finally {
        for (const client of clients) client.end();
        await new Promise(resolve => server.close(resolve));
    }
}, 15000);
