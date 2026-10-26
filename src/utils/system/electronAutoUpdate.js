// electron-updater reads the latest-mac.yml feed electron-builder publishes,
// downloads the zip to disk, and MacUpdater installs it with Electron's autoUpdater.
export async function installWithElectronAutoUpdater({channel = 'stable', updater} = {}) {
    if (!updater) updater = require('electron-updater').autoUpdater;
    updater.logger = console;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = channel === 'prerelease';
    const onError = error => console.error('Electron auto-update failed:', error);
    updater.on?.('error', onError);
    try {
        const checked = await updater.checkForUpdates();
        if (!checked?.isUpdateAvailable) throw new Error('FDO is already up to date.');
        await updater.downloadUpdate();
        updater.quitAndInstall();
        return {success: true};
    } finally {
        updater.off?.('error', onError);
    }
}
