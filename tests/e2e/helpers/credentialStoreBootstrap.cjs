// Playwright's Electron loader runs first and selects --password-store=basic.
// Restore the real Secret Service only inside our isolated Linux CI session,
// before Electron initializes safeStorage. Never permit plaintext encryption.
const shouldRestoreLinuxKeyring = process.platform === 'linux' && process.env.FDO_CI_KEYRING_SESSION === '1';
const shouldConfigureLinuxUserData = shouldRestoreLinuxKeyring && !!process.env.FDO_E2E_USER_DATA_DIR;
if (shouldConfigureLinuxUserData || shouldRestoreLinuxKeyring) {
    const {app} = require('electron');
    // Linux CI must select Chromium's profile before safeStorage initializes so
    // a Playwright GUI and its CLI child share one Secret Service context.
    if (shouldConfigureLinuxUserData) app.commandLine.appendSwitch('user-data-dir', process.env.FDO_E2E_USER_DATA_DIR);
    if (shouldRestoreLinuxKeyring) {
        app.commandLine.removeSwitch('password-store');
        app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
    }
}
