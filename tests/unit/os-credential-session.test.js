/** @jest-environment node */
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {expect, test} = require('@jest/globals');
const {createOsCredentialSession, KEYCHAIN_DENIED_MESSAGE, shouldIsolateKeychain} = require('../../src/utils/persistence/osCredentialSession.cjs');

const helper = `
const {serveOsCredentialHelper} = require(process.env.FDO_CREDENTIAL_MODULE);
serveOsCredentialHelper({
    replyPath: process.env.FDO_CREDENTIAL_REPLY,
    safeStorage: {
        encryptString(value) {
            if (process.env.FDO_KEYCHAIN_ALLOW !== '1') throw new Error('user denied keychain');
            return Buffer.from('enc:' + value);
        },
        decryptString(data) {
            const text = Buffer.from(data).toString('utf8');
            if (!text.startsWith('enc:')) throw new Error('not encrypted');
            return text.slice(4);
        },
    },
    onDenied() { process.exit(0); },
    onClose() { process.exit(0); },
});
`;

function launchHelper() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-keychain-test-'));
    fs.chmodSync(userDataDir, 0o700);
    const replyPath = path.join(userDataDir, 'reply');
    execFileSync('mkfifo', ['-m', '600', replyPath]);
    return {
        command: process.execPath,
        args: ['-e', helper],
        replyPath,
        userDataDir,
        env: {
            ...process.env,
            FDO_CREDENTIAL_MODULE: path.join(__dirname, '../../src/utils/persistence/osCredentialSession.cjs'),
            FDO_CREDENTIAL_REPLY: replyPath,
            FDO_KEYCHAIN_ALLOW: process.env.FDO_KEYCHAIN_ALLOW || '',
        },
    };
}

test('keeps non-macOS and mock keychain access in process', () => {
    const storage = {encryptString: value => Buffer.from(value), decryptString: value => value.toString(), encryptStringAsync() {}};
    expect(shouldIsolateKeychain(storage, {platform: 'linux'})).toBe(false);
    expect(shouldIsolateKeychain(storage, {platform: 'darwin', argv: ['--use-mock-keychain']})).toBe(false);
    expect(shouldIsolateKeychain(storage, {platform: 'darwin', argv: ['--fdo-os-credential-helper']})).toBe(false);
    expect(shouldIsolateKeychain({encryptString() {}}, {platform: 'darwin', argv: []})).toBe(false);
    const session = createOsCredentialSession(storage, {platform: 'darwin', argv: ['--use-mock-keychain']});
    expect(session.usesIsolatedKeychainPrompt()).toBe(false);
    expect(session.encrypt('pem').toString()).toBe('pem');
    expect(session.decrypt(Buffer.from('pem'))).toBe('pem');
});

test('a Keychain denial starts a fresh prompt on the next certificate attempt', () => {
    const starts = [];
    delete process.env.FDO_KEYCHAIN_ALLOW;
    const session = createOsCredentialSession({}, {
        isolate: true,
        launch: launchHelper,
        spawnProcess(command, args, options) {
            const child = spawn(command, args, options);
            starts.push(child.pid);
            return child;
        },
    });
    expect(() => session.encrypt('signing-key')).toThrow(KEYCHAIN_DENIED_MESSAGE);
    expect(starts).toHaveLength(1);
    process.env.FDO_KEYCHAIN_ALLOW = '1';
    const encrypted = session.encrypt('signing-key');
    expect(encrypted.toString()).toBe('enc:signing-key');
    expect(session.decrypt(encrypted)).toBe('signing-key');
    expect(starts).toHaveLength(2);
    session.close();
    delete process.env.FDO_KEYCHAIN_ALLOW;
});
