/** @jest-environment node */
const {expect, jest: jestMock, test} = require('@jest/globals');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/check-ci-keyring.cjs'), 'utf8');

async function check({backend = 'gnome_libsecret', available = true, decrypted = 'FDO CI encryption check'} = {}) {
    const app = {whenReady: () => Promise.resolve(), exit: jestMock.fn()};
    const safeStorage = {
        getSelectedStorageBackend: () => backend,
        isEncryptionAvailable: () => available,
        encryptString: jestMock.fn(() => new Uint8Array([1, 2, 3])),
        decryptString: jestMock.fn(() => decrypted),
    };
    const output = {log: jestMock.fn(), error: jestMock.fn()};
    vm.runInNewContext(source, {require: () => ({app, safeStorage}), console: output});
    await Promise.resolve();
    await Promise.resolve();
    return {app, safeStorage, output};
}

test('accepts a working GNOME encryption round trip', async () => {
    const {app, output} = await check();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(output.log).toHaveBeenCalledWith('Electron credential store verified: gnome_libsecret');
});

test('rejects the plaintext backend even when Electron reports encryption availability', async () => {
    const {app, safeStorage, output} = await check({backend: 'basic_text'});
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('basic_text'));
});

test('rejects an unavailable keyring', async () => {
    const {app, safeStorage} = await check({available: false});
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
});

test('rejects a failed encryption round trip', async () => {
    const {app, output} = await check({decrypted: 'incorrect'});
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('round trip failed'));
});
