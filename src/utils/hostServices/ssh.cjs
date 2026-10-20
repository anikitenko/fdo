const {createHash, timingSafeEqual} = require('node:crypto');
const {StringDecoder} = require('node:string_decoder');
const {failure} = require('./contracts.cjs');
const {prepareSshCredentials} = require('./sshKeys.cjs');

const fingerprint = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
function trusted(key, expected) {
    const actual = Buffer.from(fingerprint(key));
    const wanted = Buffer.from(expected || '');
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function executeSSH({Client, profile, credentials, command, timeoutMs, maxOutputBytes, signal, handshakeMs = 10000, onOutput}) {
    return new Promise((resolve, reject) => {
        const started = performance.now(), client = new Client();
        let channel, commandTimer, handshakeTimer, settled = false, verified = false, hostRejected = false;
        let stdout = '', stderr = '', captured = 0, truncated = false, exitCode = null, exitSignal = null;
        const out = new StringDecoder('utf8'), err = new StringDecoder('utf8');
        const abort = () => finish(failure(typeof signal?.reason?.code === 'string' ? signal.reason.code : 'ACCESS_DENIED'));
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(handshakeTimer); clearTimeout(commandTimer);
            signal?.removeEventListener('abort', abort);
            if (channel) {
                if(error?.code==='CANCELLED'||error?.code==='TIMEOUT')try{channel.signal?.('TERM');}catch{}

                channel.removeAllListeners(); channel.stderr?.removeAllListeners();
                channel.on('error', () => {}); channel.stderr?.on('error', () => {});
                channel.destroy();
            }
            client.removeAllListeners(); client.on('error', () => {}); client.destroy();
            // Authentication is scoped to this connection; never pool credentials.
            credentials.password = credentials.privateKey = credentials.passphrase = undefined;
            if (error) reject(failure(error.code)); else resolve(result);
        };
        let sequence = 0, retainedBytes = 0, captureClosed = false;
        const retain = (text, isError) => {
            if (!text || captureClosed) return;
            let prefix = '', bytes = 0;
            for (const character of text) {
                const size = Buffer.byteLength(character);
                if (retainedBytes + bytes + size > maxOutputBytes) {truncated = true; captureClosed = true; break;}
                prefix += character; bytes += size;
            }
            if (prefix && onOutput && onOutput({sequence, stream:isError ? 'stderr':'stdout', data:prefix}) === false) {
                truncated = true; captureClosed = true; return;
            }
            if (prefix) {sequence++; retainedBytes += bytes; if (isError) stderr += prefix; else stdout += prefix;}
        };
        const capture = (chunk, decoder, isError) => {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (captureClosed) {if (data.length) truncated = true; return;}
            // Limit raw input as well as encoded strings, including malformed UTF-8
            // replacement characters. Both streams share this single prefix.
            const remaining = Math.max(0, maxOutputBytes - captured);
            const piece = data.subarray(0, remaining); captured += piece.length;
            retain(decoder.write(piece), isError);
            if (data.length > remaining) {truncated = true; captureClosed = true;}
        };
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) {abort(); return;}
        handshakeTimer = setTimeout(() => finish(failure('TIMEOUT')), handshakeMs);
        client.on('error', () => finish(failure(hostRejected ? 'HOST_KEY_REJECTED' : 'CONNECTION_FAILED')));
        client.on('close', () => finish(failure('CONNECTION_FAILED')));
        client.on('end', () => finish(failure('CONNECTION_FAILED')));
        client.once('ready', () => {
            clearTimeout(handshakeTimer);
            if (!verified) {finish(failure('HOST_KEY_REJECTED')); return;}
            commandTimer = setTimeout(() => finish(failure('TIMEOUT')), timeoutMs);
            try {
                client.exec(command, {pty: false}, (error, stream) => {
                    if (settled) {stream?.destroy(); return;}
                    if (error || !stream) {finish(failure('CONNECTION_FAILED')); return;}
                    channel = stream;
                    stream.on('data', chunk => capture(chunk, out, false));
                    stream.stderr.on('data', chunk => capture(chunk, err, true));
                    stream.on('error', () => finish(failure('CONNECTION_FAILED')));
                    stream.stderr.on('error', () => finish(failure('CONNECTION_FAILED')));
                    stream.on('exit', (code, signalName) => {
                        exitCode = Number.isSafeInteger(code) ? code : null;
                        exitSignal = typeof signalName === 'string' ? signalName : null;
                    });
                    stream.once('close', () => {
                        // Do not emit an incomplete UTF-8 tail cut by the byte cap.
                        if (!truncated) {retain(out.end(), false); retain(err.end(), true);}
                        finish(null, {stdout, stderr, exitCode, signal: exitSignal, durationMs: Math.max(0, performance.now() - started), truncated});
                    });
                    stream.end(); // Noninteractive v1 sends stdin EOF.
                });
            } catch {finish(failure('CONNECTION_FAILED'));}
        });
        try {
            client.connect({host: profile.host, port: profile.port, username: profile.username, ...prepareSshCredentials(credentials),
                readyTimeout: handshakeMs, tryKeyboard: false, keepaliveInterval: 5000, keepaliveCountMax: 1,
                hostVerifier: raw => {
                    verified = trusted(raw, profile.trustedHostKey); hostRejected = !verified;
                    return verified;
                }});
        } catch {finish(failure('CONNECTION_FAILED'));}
    });
}
// Authenticated reachability probe: never requests a session or shell.
function observeSSH({Client, profile, credentials, signal, handshakeMs = 10000}) {
    return new Promise((resolve,reject) => {
        const client = new Client(); let settled=false, rejected=false, verified=false;
        const done = error => {
            if(settled)return; settled=true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
            client.removeAllListeners();client.on('error',()=>{});client.destroy();
            credentials.password=credentials.privateKey=credentials.passphrase=undefined;
            error?reject(failure(error.code)):resolve();
        };
        const abort=()=>done(failure(typeof signal?.reason?.code === 'string' ? signal.reason.code : 'ACCESS_DENIED'));
        const timer=setTimeout(()=>done(failure('TIMEOUT')),handshakeMs);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        client.once('ready',()=>done(verified?null:failure('HOST_KEY_REJECTED')));
        client.on('error',()=>done(failure(rejected?'HOST_KEY_REJECTED':'CONNECTION_FAILED')));
        client.once('close',()=>done(failure('CONNECTION_FAILED')));
        try {client.connect({host:profile.host,port:profile.port,username:profile.username,...prepareSshCredentials(credentials),
            readyTimeout:handshakeMs,keepaliveInterval:5000,keepaliveCountMax:1,tryKeyboard:false,
            hostVerifier:raw=>{verified=trusted(raw,profile.trustedHostKey);rejected=!verified;return verified;}});}
        catch {done(failure('CONNECTION_FAILED'));}
    });
}
module.exports = {executeSSH, observeSSH, fingerprint, trusted, prepareSshCredentials};
