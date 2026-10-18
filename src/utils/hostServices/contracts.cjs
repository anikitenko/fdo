const CODES = new Set(['ACCESS_DENIED', 'UNAVAILABLE', 'LOCKED', 'TIMEOUT', 'CANCELLED', 'HOST_KEY_REJECTED', 'CONNECTION_FAILED', 'INVALID_REQUEST', 'BACKPRESSURE', 'SESSION_CLOSED', 'IDLE_TIMEOUT', 'SESSION_LIMIT', 'X11_UNSUPPORTED', 'X11_UNAVAILABLE', 'X11_AUTH_UNAVAILABLE', 'X11_FORWARDING_DENIED']);
const CAPABILITIES = require('./capabilities.json');
const {isIP} = require('node:net');
function failure(code = 'UNAVAILABLE') {return Object.assign(new Error('Host service request failed.'), {code: CODES.has(code) ? code : 'UNAVAILABLE'});}
function ensure(condition,code='INVALID_REQUEST') {if(!condition)throw failure(code);}
function record(value, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw failure('INVALID_REQUEST');
}
function key(value) {if (typeof value !== 'string' || /[\r\n]/.test(value) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw failure('INVALID_REQUEST'); return value;}
function text(value, max = 256) {if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > max) throw failure('INVALID_REQUEST'); return value;}
function integer(value, min, max) {if (!Number.isSafeInteger(value) || value < min || value > max) throw failure('INVALID_REQUEST'); return value;}
function request(value) {
    record(value, ['action', 'payload']);
    const {action, payload} = value;
    switch (action) {
        case 'secrets.set': record(payload, ['key', 'value']); key(payload.key); if (typeof payload.value !== 'string' || Buffer.byteLength(payload.value) > 1048576) throw failure('INVALID_REQUEST'); break;
        case 'secrets.get': case 'secrets.delete': record(payload, ['key']); key(payload.key); break;
        case 'secrets.list': case 'ssh.profiles.list': record(payload, []); break;
        case 'ssh.exec': record(payload, ['profileId', 'command', 'timeoutMs', 'maxOutputBytes']); key(payload.profileId); text(payload.command, 16384); integer(payload.timeoutMs, 1, Number.MAX_SAFE_INTEGER); integer(payload.maxOutputBytes, 1, Number.MAX_SAFE_INTEGER); break;
        default: throw failure('INVALID_REQUEST');
    }
    return value;
}
function required(action) {
    return action === 'ssh.exec' || action === 'ssh.status.watch' || action === 'ssh.terminal.open' ? ['ssh.use', action, 'secrets.use', 'secrets.consume']
        : action === 'ssh.profiles.list' ? ['ssh.use', action] : ['secrets.use', action];
}
function profile(value) {
    record(value, ['id', 'label', 'host', 'port', 'username', 'authentication', 'trustedHostKey', 'policy']);
    key(value.id); text(value.label, 160); text(value.username, 128); text(value.host, 253);
    if(/[\r\n]/.test(value.host)||/[\r\n]/.test(value.username))throw failure('INVALID_REQUEST');
    if (!isIP(value.host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value.host)) throw failure('INVALID_REQUEST');
    if (!/^[a-zA-Z0-9_.@\\-]+$/.test(value.username)) throw failure('INVALID_REQUEST');
    integer(value.port, 1, 65535);
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.trustedHostKey) || Buffer.from(value.trustedHostKey.slice(7), 'base64').toString('base64').replace(/=+$/, '') !== value.trustedHostKey.slice(7)) throw failure('INVALID_REQUEST');
    const auth = value.authentication;
    if (auth?.type === 'password') record(auth, ['type', 'passwordRef']);
    else if (auth?.type === 'privateKey') record(auth, ['type', 'privateKeyRef', 'passphraseRef'], ['type', 'privateKeyRef']);
    else throw failure('INVALID_REQUEST');
    for (const name of ['passwordRef', 'privateKeyRef', 'passphraseRef']) if (Object.hasOwn(auth, name)) {record(auth[name], ['kind', 'key']); if (auth[name].kind !== 'secret') throw failure('INVALID_REQUEST'); key(auth[name].key);}
    record(value.policy, ['consumers', 'commands', 'repositories', 'allowAllCommands', 'lfsHttpsOrigins', 'x11Modes', 'terminalLimits'], ['consumers', 'commands']);
    if(value.policy.terminalLimits!==undefined){record(value.policy.terminalLimits,['idleTimeoutMs','sessionTimeoutMs']);integer(value.policy.terminalLimits.idleTimeoutMs,1000,300000);integer(value.policy.terminalLimits.sessionTimeoutMs,1000,3600000);}
    if(value.policy.x11Modes!==undefined && (!Array.isArray(value.policy.x11Modes)||new Set(value.policy.x11Modes).size!==value.policy.x11Modes.length||value.policy.x11Modes.some(mode=>!['trusted','untrusted'].includes(mode))||value.policy.x11Modes.length&&!value.policy.consumers.includes('ssh.terminal.open')))throw failure('INVALID_REQUEST');
    if(value.policy.lfsHttpsOrigins!==undefined) {
        if(!Array.isArray(value.policy.lfsHttpsOrigins)||value.policy.lfsHttpsOrigins.length>16)throw failure('INVALID_REQUEST');
        value.policy.lfsHttpsOrigins.forEach(value=>require('./gitLfsProxy.cjs').origin(value));
    }
    if (value.policy.allowAllCommands !== undefined && typeof value.policy.allowAllCommands !== 'boolean') throw failure('INVALID_REQUEST');
    if (value.policy.repositories !== undefined) {
        if (!Array.isArray(value.policy.repositories) || value.policy.repositories.length > 64) throw failure('INVALID_REQUEST');
        for (const rule of value.policy.repositories) {record(rule, ['path', 'operations']); repository(rule.path); if (!Array.isArray(rule.operations) || !rule.operations.length || new Set(rule.operations).size !== rule.operations.length || rule.operations.some(op => !['ls-remote', 'clone', 'fetch', 'push'].includes(op))) throw failure('INVALID_REQUEST');}
    }
    if (!Array.isArray(value.policy.consumers) || value.policy.consumers.some(c => !['ssh.exec', 'git', 'ssh.terminal.open'].includes(c)) || new Set(value.policy.consumers).size !== value.policy.consumers.length) throw failure('INVALID_REQUEST');
    if (value.policy.allowAllCommands === true && !value.policy.consumers.includes('ssh.exec')) throw failure('INVALID_REQUEST');
    if (!Array.isArray(value.policy.commands) || value.policy.commands.length > 64) throw failure('INVALID_REQUEST');
    value.policy.commands.forEach(command => text(command, 16384));
    return value;
}
// A deliberately small repository path grammar prevents shell and option interpretation.
function repository(value) {
    text(value, 512);
    if (/[\r\n]/.test(value) || !/^\/?[a-zA-Z0-9_][a-zA-Z0-9._/-]*$/.test(value) || value.replace(/^\//, '').split('/').some(part => !part || part === '.' || part === '..')) throw failure('INVALID_REQUEST');
    return value;
}
module.exports = {CAPABILITIES, CODES, failure, ensure, record, key, text, integer, request, required, profile, repository};
