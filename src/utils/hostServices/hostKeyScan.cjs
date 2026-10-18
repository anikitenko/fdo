const {randomUUID} = require('node:crypto');
const {ensure,failure} = require('./contracts.cjs');
const {fingerprint} = require('./ssh.cjs');

// Discovery only: the verifier always rejects the offered key, before any user
// authentication. Returned fingerprints are candidates, never enrolled trust.
function createHostKeyScanner({Client, audit = () => {}, timeoutMs = 8000}) {
    const active = new Set(); let closed = false;
    return {
        scan(owner, endpoint, signal) {
            if (closed || active.size >= 4) return Promise.reject(failure('UNAVAILABLE'));
            return new Promise((resolve, reject) => {
                const requestId = randomUUID(); let client, timer, candidate, settled = false;
                const entry = {owner, finish};
                const abort = () => finish(failure('ACCESS_DENIED'));
                function finish(error, result) {
                    if (settled) return;
                    settled = true; clearTimeout(timer); active.delete(entry);
                    signal?.removeEventListener('abort', abort);
                    if (client) {client.removeAllListeners(); client.on('error', () => {}); client.destroy();}
                    try {audit(owner, 'ssh.hostKey.fetch', error ? failure(error.code).code : 'OK', requestId);}
                    catch {error = failure('UNAVAILABLE');}
                    if (error) reject(failure(error.code)); else resolve(result);
                }
                active.add(entry);
                try {
                    audit(owner, 'ssh.hostKey.fetch', 'STARTED', requestId);
                    if (signal?.aborted) {abort(); return;}
                    signal?.addEventListener('abort', abort, {once: true});
                    timer = setTimeout(() => finish(failure('TIMEOUT')), timeoutMs);
                    client = new Client();
                    client.on('error', error => {
                        if (candidate) finish(null, candidate);
                        else finish(failure(error?.level === 'client-timeout' ? 'TIMEOUT' : 'CONNECTION_FAILED'));
                    });
                    client.on('close', () => {if (!settled) finish(candidate ? null : failure('CONNECTION_FAILED'), candidate);});
                    client.on('ready', () => finish(failure('CONNECTION_FAILED')));
                    client.connect({host: endpoint.host, port: endpoint.port, username: 'fdo-host-key-discovery', readyTimeout: timeoutMs,
                        hostVerifier(raw) {
                            if (settled) return false;
                            try {
                                ensure(Buffer.isBuffer(raw) && raw.length >= 5 && raw.length <= 65536, 'CONNECTION_FAILED');
                                const length = raw.readUInt32BE(0);
                                ensure(length > 0 && length <= 128 && length + 4 < raw.length, 'CONNECTION_FAILED');
                                const keyType = raw.subarray(4, length + 4).toString('ascii');
                                ensure(/^[a-zA-Z0-9@._+-]+$/.test(keyType), 'CONNECTION_FAILED');
                                candidate = {...endpoint, keyType, fingerprint: fingerprint(raw)};
                                queueMicrotask(() => finish(null, candidate));
                            } catch {queueMicrotask(() => finish(failure('CONNECTION_FAILED')));}
                            return false;
                        },
                    });
                } catch {finish(failure('CONNECTION_FAILED'));}
            });
        },
        cancel(owner) {for (const entry of [...active]) if (entry.owner === owner) entry.finish(failure('ACCESS_DENIED'));},
        close() {closed = true; for (const entry of [...active]) entry.finish(failure('UNAVAILABLE'));},
    };
}
module.exports = {createHostKeyScanner};
