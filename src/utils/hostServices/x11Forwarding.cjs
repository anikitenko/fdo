'use strict';
// HOST ONLY. Never bundle into a plugin. Install on a dedicated authenticated ssh2 Client.
const {reserve}=require('./resourceBudget.cjs');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const PROTOCOL = Buffer.from('MIT-MAGIC-COOKIE-1');
const failure = code => Object.assign(new Error(code), { code });
const pad = n => (n + 3) & ~3;

/** local is a host-owned display authorization, not plugin input.
 * connect() must open an authenticated local X socket; cookie is its authorization.
 * untrusted requires a real X SECURITY generated untrusted authorization, not a label.
 * Caller installs this before client.shell(..., {x11: gate.request}, ...).
 */
function createX11Forwarding({ client, local, mode, authorize, maxChannels = 8, setupTimeoutMs = 5000 }) {
    if (!['trusted', 'untrusted'].includes(mode)) throw failure('INVALID_REQUEST');
    authorize(mode);
    if (!local || typeof local.connect !== 'function') throw failure('X11_UNAVAILABLE');
    if (!Buffer.isBuffer(local.cookie) || local.cookie.length !== 16) throw failure('X11_AUTH_UNAVAILABLE');
    if (mode === 'untrusted' && local.securityAuthorization !== 'untrusted') throw failure('X11_UNSUPPORTED');
    if (!Number.isSafeInteger(local.screen) || local.screen < 0 || local.screen > 65535) throw failure('X11_UNAVAILABLE');
    if (!Number.isSafeInteger(maxChannels) || maxChannels < 1 || maxChannels > 32
        || !Number.isSafeInteger(setupTimeoutMs) || setupTimeoutMs < 1 || setupTimeoutMs > 30000) throw failure('INVALID_REQUEST');
    const fake = randomBytes(16), real = Buffer.from(local.cookie), active = new Set();
    let closed = false;
    const onX11 = (_info, accept, reject) => {
        try { authorize(mode); } catch { reject(); return; }
        if (closed || active.size >= maxChannels) { reject(); return; }
        const release=reserve(16*1024*1024,true);if(!release){reject();return;}
        let channel;
        try { channel = accept(); } catch { release();return; }
        let socket, header = Buffer.alloc(0), authenticated = false, finished = false;
        const timer = setTimeout(() => end(), setupTimeoutMs);
        const end = () => {
            if (finished) return;
            finished = true; release();clearTimeout(timer); active.delete(end);
            channel.removeListener('data', setup);
            channel.destroy(); socket?.destroy(); header.fill(0);
        };
        active.add(end);
        channel.on('error', end); channel.on('close', end);
        const setup = chunk => {
            if (finished || authenticated) return;
            if (!Buffer.isBuffer(chunk) || chunk.length > 65536) { end(); return; }
            // Buffer ONLY the bounded X11 setup header. Forward application bytes via pipes.
            let offset = 0;
            while (offset < chunk.length) {
                const target = header.length < 12 ? 12 : 48;
                const count = Math.min(target - header.length, chunk.length - offset);
                header = Buffer.concat([header, chunk.subarray(offset, offset + count)]); offset += count;
                if (header.length < 12) return;
                const little = header[0] === 0x6c;
                if (!little && header[0] !== 0x42) { end(); return; }
                const word = at => little ? header.readUInt16LE(at) : header.readUInt16BE(at);
                if (word(2) !== 11 || word(4) !== 0 || word(6) !== PROTOCOL.length || word(8) !== 16) { end(); return; }
                const total = 12 + pad(word(6)) + pad(word(8));
                if (header.length < total) continue;
                const cookieOffset = 12 + pad(PROTOCOL.length);
                if (!header.subarray(12, 12 + PROTOCOL.length).equals(PROTOCOL)
                    || !timingSafeEqual(header.subarray(cookieOffset, cookieOffset + 16), fake)) { end(); return; }
                try { authorize(mode); } catch { end(); return; }
                authenticated = true;
                channel.pause(); channel.removeListener('data', setup);
                // Do not connect to the local server before authenticating the spoof cookie.
                const rest = Buffer.from(chunk.subarray(offset));
                real.copy(header, cookieOffset);
                Promise.resolve().then(() => local.connect()).then(value => {
                    if (finished || closed) { value.destroy(); return; }
                    socket = value;
                    socket.on('error', end); socket.on('close', end);
                    // Keep setup/connect/write covered by the setup deadline.
                    socket.write(header, () => {
                        if (finished) return;
                        header.fill(0); header = Buffer.alloc(0);
                        const bridge = () => {
                            if (finished) return;
                            clearTimeout(timer);
                            channel.pipe(socket); socket.pipe(channel); channel.resume();
                        };
                        if (rest.length) socket.write(rest, bridge); else bridge();
                    });
                }, end).catch(end);
                return;
            }
        };
        channel.on('data', setup);
    };
    client.on('x11', onX11);
    return {
        // Only fake credentials enter the remote SSH request; this object stays in the host.
        request: { protocol: 'MIT-MAGIC-COOKIE-1', cookie: fake.toString('hex'), screen: local.screen, single: false },
        close() {
            if (closed) return;
            closed = true;
            // Keep a rejecting listener until the dedicated SSH connection is destroyed.
            for (const end of [...active]) end();
            fake.fill(0); real.fill(0); this.request.cookie = '';
            local.dispose?.();
        },
        dispose() { this.close(); client.removeListener('x11', onX11); },
    };
}
module.exports = { createX11Forwarding };
