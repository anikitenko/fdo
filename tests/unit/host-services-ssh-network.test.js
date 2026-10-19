/** @jest-environment node */
const {expect, test} = require('@jest/globals');
const {Client, Server} = require('ssh2');
const {executeSSH, fingerprint} = require('../../src/utils/hostServices/ssh.cjs');
const {host, work, parsedKey} = require('./helpers/ssh2Keys.cjs');
const allowed = parsedKey(work.public);

test.each(['password', 'privateKey'])('real bundled SSH handshake and command with %s authentication, without an ssh process', async type => {
    const clients = new Set();
    const server = new Server({hostKeys: [host.private]}, connection => {
        clients.add(connection); connection.on('error', () => {}); connection.on('close', () => clients.delete(connection));
        connection.on('authentication', ctx => {
            if (ctx.username !== 'fixture') return ctx.reject();
            if (type === 'password' && ctx.method === 'password' && ctx.password === 'fixture password') return ctx.accept();
            if (type === 'privateKey' && ctx.method === 'publickey' && ctx.key.data.equals(allowed.getPublicSSH())
                && (!ctx.signature || allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) return ctx.accept();
            ctx.reject();
        });
        connection.on('ready', () => connection.on('session', accept => {
            const session = accept(); session.on('exec', (acceptCommand, reject, info) => {
                if (info.command !== 'fixture command') return reject();
                const stream = acceptCommand(); stream.write(Buffer.from('SSH 🔐 success')); stream.stderr.write('fixture stderr'); stream.exit(7); stream.end();
            });
        }));
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    try {
        const result = await executeSSH({Client, profile: {host: '127.0.0.1', port: server.address().port, username: 'fixture', trustedHostKey: fingerprint(parsedKey(host.private).getPublicSSH())},
            credentials: type === 'password' ? {password: 'fixture password'} : {privateKey: work.private, passphrase: work.passphrase},
            command: 'fixture command', timeoutMs: 3000, maxOutputBytes: 1024});
        expect(result).toMatchObject({stdout: 'SSH 🔐 success', stderr: 'fixture stderr', exitCode: 7, signal: null, truncated: false});
    } finally {
        for (const client of clients) client.end();
        await new Promise(resolve => server.close(resolve));
    }
}, 15000);
