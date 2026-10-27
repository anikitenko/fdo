const {spawn, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

// Chromium caches a denied Keychain password for the life of the process
// (key_is_cached_ is set before the empty-password check). A later certificate
// or credential action in that process never shows the prompt again. Each
// denial therefore ends the helper process; the next action starts a new one
// and macOS can ask again.
const KEYCHAIN_DENIED_MESSAGE = 'macOS denied FDO access to Keychain. Retry the operation and choose Allow in the system prompt. FDO uses Keychain to protect credentials and signing keys; plugins do not receive this access.';
const sessions = new Set();
const shared = new WeakMap();

function denied() {
    return Object.assign(new Error(KEYCHAIN_DENIED_MESSAGE), {code: 'KEYCHAIN_DENIED'});
}
function commandLineMocksKeychain() {
    try {
        return !!require('electron').app?.commandLine?.hasSwitch?.('use-mock-keychain');
    } catch {return false;}
}
function shouldIsolateKeychain(safeStorage, {platform = process.platform, argv = process.argv, mockKeychain = false} = {}) {
    if (platform !== 'darwin' || mockKeychain) return false;
    if (argv.includes('--use-mock-keychain') || argv.includes('--fdo-os-credential-helper')) return false;
    if (commandLineMocksKeychain()) return false;
    return typeof safeStorage?.encryptStringAsync === 'function';
}
function helperEnv() {
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}
function defaultLaunch() {
    const {app} = require('electron');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-keychain-'));
    fs.chmodSync(userDataDir, 0o700);
    const replyPath = path.join(userDataDir, 'reply');
    execFileSync('mkfifo', ['-m', '600', replyPath]);
    const args = [];
    // A macOS E2E parent uses Electron's mock Keychain to keep CI independent
    // of interactive prompts. The credential helper is a separate process, so
    // it must receive the switch before Electron initializes safeStorage too.
    if (process.platform === 'darwin' && process.env.FDO_E2E === '1') args.push('--use-mock-keychain');
    if (!app.isPackaged) args.push(app.getAppPath());
    args.push('--fdo-os-credential-helper', `--fdo-credential-reply=${replyPath}`, '--disable-gpu', '--user-data-dir', userDataDir);
    return {command: process.execPath, args, replyPath, userDataDir, env: helperEnv()};
}
function replyPathFromArgv(argv = process.argv) {
    const match = argv.find(argument => argument.startsWith('--fdo-credential-reply='));
    return match ? match.slice('--fdo-credential-reply='.length) : '';
}
function readMessage(state) {
    const chunk = Buffer.alloc(65536);
    while (state.buffer.indexOf(0x0a) === -1) {
        const read = fs.readSync(state.replyFd, chunk, 0, chunk.length);
        if (read <= 0) throw denied();
        state.buffer = Buffer.concat([state.buffer, chunk.subarray(0, read)]);
    }
    const end = state.buffer.indexOf(0x0a);
    const line = state.buffer.subarray(0, end).toString('utf8');
    state.buffer = state.buffer.subarray(end + 1);
    let message;
    try {message = JSON.parse(line);} catch {throw denied();}
    if (!message?.ok) throw denied();
    return message.result;
}
function createOsCredentialSession(safeStorage, options = {}) {
    let isolated;
    let current = null;
    const usesIsolatedKeychainPrompt = () => {
        if (isolated === undefined) isolated = options.isolate ?? shouldIsolateKeychain(safeStorage, options);
        return isolated;
    };
    const cleanup = launch => {if (launch?.userDataDir) fs.rmSync(launch.userDataDir, {recursive: true, force: true});};
    const close = () => {
        const attempt = current;
        current = null;
        if (!attempt) return;
        try {attempt.child.stdin.end();} catch { /* already closed */ }
        try {attempt.child.kill();} catch { /* already exited */ }
        try {fs.closeSync(attempt.replyFd);} catch { /* already closed */ }
        cleanup(attempt);
    };
    const start = () => {
        const launch = (options.launch || defaultLaunch)();
        let replyFd;
        let child;
        try {
            replyFd = fs.openSync(launch.replyPath, 'r+');
            child = (options.spawnProcess || spawn)(launch.command, launch.args, {
                env: launch.env || helperEnv(), stdio: ['pipe', 'ignore', 'ignore'],
            });
            const attempt = {child, replyFd, userDataDir: launch.userDataDir, buffer: Buffer.alloc(0)};
            if (readMessage(attempt) !== 'ready') throw denied();
            return attempt;
        } catch (error) {
            try {child?.kill();} catch { /* not started */ }
            try {if (replyFd !== undefined) fs.closeSync(replyFd);} catch { /* not opened */ }
            cleanup(launch);
            if (error?.code === 'KEYCHAIN_DENIED') throw error;
            throw denied();
        }
    };
    const request = (op, payload) => {
        if (!current || current.child.exitCode !== null || current.child.killed) current = start();
        try {
            const input = current.child.stdin._handle?.fd;
            if (typeof input !== 'number') throw denied();
            fs.writeSync(input, `${JSON.stringify({op, payload})}\n`);
            return readMessage(current);
        } catch (error) {
            close();
            if (error?.code === 'KEYCHAIN_DENIED') throw error;
            throw denied();
        }
    };
    const session = {
        usesIsolatedKeychainPrompt,
        encrypt(value) {
            if (!usesIsolatedKeychainPrompt()) return safeStorage.encryptString(value);
            return Buffer.from(request('encrypt', value), 'base64');
        },
        decrypt(data) {
            if (!usesIsolatedKeychainPrompt()) return safeStorage.decryptString(Buffer.isBuffer(data) ? data : Buffer.from(data));
            return request('decrypt', Buffer.from(data).toString('base64'));
        },
        close,
    };
    sessions.add(session);
    return session;
}
function osCredentialSession(safeStorage, options) {
    let session = shared.get(safeStorage);
    if (!session) {
        session = createOsCredentialSession(safeStorage, options);
        shared.set(safeStorage, session);
    }
    return session;
}
function closeOsCredentialSessions() {
    for (const session of sessions) session.close();
    sessions.clear();
}
function serveOsCredentialHelper({safeStorage, input = process.stdin, replyPath = replyPathFromArgv(), onDenied = () => process.exit(0), onClose = () => process.exit(0)} = {}) {
    if (!replyPath) throw new Error('Missing credential reply channel');
    const output = fs.openSync(replyPath, 'a');
    const respond = message => fs.writeSync(output, `${JSON.stringify(message)}\n`);
    respond({ok: true, result: 'ready'});
    const lines = readline.createInterface({input, crlfDelay: Infinity});
    lines.on('line', line => {
        let request;
        try {request = JSON.parse(line);} catch {return;}
        try {
            if (request.op === 'encrypt') {
                respond({ok: true, result: Buffer.from(safeStorage.encryptString(String(request.payload ?? ''))).toString('base64')});
            } else if (request.op === 'decrypt') {
                respond({ok: true, result: safeStorage.decryptString(Buffer.from(String(request.payload ?? ''), 'base64'))});
            } else respond({ok: false});
        } catch {
            try {respond({ok: false});} catch { /* parent already gone */ }
            onDenied();
        }
    });
    lines.on('close', () => {try {fs.closeSync(output);} catch { /* already closed */ } onClose();});
}
function runOsCredentialHelper({app, safeStorage}) {
    return app.whenReady().then(() => new Promise(resolve => {
        serveOsCredentialHelper({safeStorage, onDenied: () => resolve('denied'), onClose: () => resolve('closed')});
    }));
}

module.exports = {
    KEYCHAIN_DENIED_MESSAGE, shouldIsolateKeychain, createOsCredentialSession, osCredentialSession,
    closeOsCredentialSessions, serveOsCredentialHelper, runOsCredentialHelper, replyPathFromArgv,
};
