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

test('reports download progress and removes its listener after installation', async () => {
    const updater = updaterDouble({isUpdateAvailable: true});
    const listeners = new Map();
    updater.on = jest.fn((name, listener) => listeners.set(name, listener));
    updater.off = jest.fn();
    updater.downloadUpdate = async () => listeners.get('download-progress')({percent: 42});
    const onProgress = jest.fn();
    await installWithElectronAutoUpdater({updater, onProgress});
    expect(onProgress.mock.calls.map(([status]) => status)).toEqual([
        {phase: 'checking'}, {phase: 'downloading'}, {phase: 'downloading', percent: 42}, {phase: 'restarting'},
    ]);
    expect(updater.off).toHaveBeenCalledWith('download-progress', listeners.get('download-progress'));
});
