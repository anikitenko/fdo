// Playwright's Electron loader runs first and selects --password-store=basic.
// Restore the real Secret Service only inside our isolated Linux CI session,
// before Electron initializes safeStorage. Never permit plaintext encryption.
const shouldConfigureUserData = !!process.env.FDO_E2E_USER_DATA_DIR;
const shouldRestoreLinuxKeyring = process.platform === 'linux' && process.env.FDO_CI_KEYRING_SESSION === '1';
if (shouldConfigureUserData || shouldRestoreLinuxKeyring) {
    const {app} = require('electron');
    // Select Chromium's protected-storage directory before it initializes so an
    // E2E GUI and its CLI child use the same OS-protected credential context.
    if (shouldConfigureUserData) app.commandLine.appendSwitch('user-data-dir', process.env.FDO_E2E_USER_DATA_DIR);
    if (shouldRestoreLinuxKeyring) {
        app.commandLine.removeSwitch('password-store');
        app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
    }
}
