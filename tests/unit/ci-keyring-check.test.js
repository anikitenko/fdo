/** @jest-environment node */
const {expect, jest: jestMock, test} = require('@jest/globals');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/check-ci-keyring.cjs'), 'utf8');
const bootstrap = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/credentialStoreBootstrap.cjs'), 'utf8');

function fixture({backend = 'gnome_libsecret', available = true, decrypted = 'FDO CI encryption check'} = {}) {
    const safeStorage = {
        getSelectedStorageBackend: () => backend,
        isEncryptionAvailable: () => available,
        encryptString: jestMock.fn(() => new Uint8Array([1, 2, 3])),
        decryptString: jestMock.fn(() => decrypted),
    };
    const app = {evaluate: jestMock.fn(async fn => fn({safeStorage}))};
    const launchElectronApp = jestMock.fn(async () => app);
    const closeElectronApp = jestMock.fn().mockResolvedValue(undefined);
    const output = {log: jestMock.fn(), error: jestMock.fn()};
    const module = {exports: {}};
    vm.runInNewContext(source, {
        require: () => ({launchElectronApp, closeElectronApp}), module, console: output,
    });
    return {run: () => module.exports.checkCiKeyring('electron'), app, safeStorage, output, launchElectronApp, closeElectronApp};
}

test('checks the shared Playwright launch path using an isolated profile and closes it', async () => {
    const f = fixture();
    await f.run();
    expect(f.launchElectronApp.mock.calls).toEqual([['electron', {isolatedUserDataDir: true}]]);
    expect(f.closeElectronApp).toHaveBeenCalledWith(f.app);
    expect(f.output.log.mock.calls).toEqual([['Playwright Electron credential store verified: gnome_libsecret']]);
});

test('rejects the plaintext backend even when Electron reports encryption availability', async () => {
    const f = fixture({backend: 'basic_text'});
    await expect(f.run()).rejects.toThrow('basic_text');
    expect(f.safeStorage.encryptString).not.toHaveBeenCalled();
    expect(f.closeElectronApp).toHaveBeenCalledWith(f.app);
});

test('rejects an unavailable keyring', async () => {
    const f = fixture({available: false});
    await expect(f.run()).rejects.toThrow('unlocked GNOME Secret Service');
    expect(f.safeStorage.encryptString).not.toHaveBeenCalled();
    expect(f.closeElectronApp).toHaveBeenCalledWith(f.app);
});

test('rejects a failed encryption round trip', async () => {
    const f = fixture({decrypted: 'incorrect'});
    await expect(f.run()).rejects.toThrow('round trip failed');
    expect(f.closeElectronApp).toHaveBeenCalledWith(f.app);
});

test('restores Secret Service after Playwright selected the basic password store', () => {
    const switches = new Map([['password-store', 'basic']]);
    vm.runInNewContext(bootstrap, {
        process: {platform: 'linux', env: {FDO_CI_KEYRING_SESSION: '1'}},
        require: () => ({app: {commandLine: {
            removeSwitch: name => switches.delete(name),
            appendSwitch: (name, value) => switches.set(name, value),
        }}}),
    });
    expect(switches.get('password-store')).toBe('gnome-libsecret');
});

test.each([
    ['linux', {}], ['darwin', {FDO_CI_KEYRING_SESSION: '1'}], ['win32', {FDO_CI_KEYRING_SESSION: '1'}],
])('leaves the credential backend unchanged outside the Linux CI session (%s)', (platform, env) => {
    const requireElectron = jestMock.fn();
    vm.runInNewContext(bootstrap, {process: {platform, env}, require: requireElectron});
    expect(requireElectron).not.toHaveBeenCalled();
});
