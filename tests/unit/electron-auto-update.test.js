import {installWithElectronAutoUpdater} from '../../src/utils/system/electronAutoUpdate';

function updaterDouble(checked) {
    const calls = [];
    return {
        calls,
        logger: null,
        autoDownload: true,
        autoInstallOnAppQuit: true,
        allowDowngrade: true,
        allowPrerelease: false,
        on: () => {},
        off: () => {},
        checkForUpdates: async () => {calls.push('check'); return checked;},
        downloadUpdate: async () => {calls.push('download');},
        quitAndInstall: () => {calls.push('install');},
    };
}

test('installs an available update through Electron autoUpdater', async () => {
    const updater = updaterDouble({isUpdateAvailable: true, updateInfo: {version: '1.4.0'}});
    await expect(installWithElectronAutoUpdater({channel: 'stable', updater})).resolves.toEqual({success: true});
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.calls).toEqual(['check', 'download', 'install']);
});

test('follows the prerelease channel and stops when Electron reports no update', async () => {
    const updater = updaterDouble({isUpdateAvailable: false});
    await expect(installWithElectronAutoUpdater({channel: 'prerelease', updater})).rejects.toThrow('up to date');
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.calls).toEqual(['check']);
});
