// Playwright's Electron loader runs first and selects --password-store=basic.
// Restore the real Secret Service only inside our isolated Linux CI session,
// before Electron initializes safeStorage. Never permit plaintext encryption.
const shouldRestoreLinuxKeyring = process.platform === 'linux' && process.env.FDO_CI_KEYRING_SESSION === '1';
const shouldConfigureLinuxUserData = shouldRestoreLinuxKeyring && !!process.env.FDO_E2E_USER_DATA_DIR;
const shouldMockMacKeychain = process.platform === 'darwin' && process.env.FDO_E2E === '1';
if (shouldConfigureLinuxUserData || shouldRestoreLinuxKeyring || shouldMockMacKeychain) {
    const {app} = require('electron');
    // Linux CI must select Chromium's profile before safeStorage initializes so
    // a Playwright GUI and its CLI child share one Secret Service context.
    if (shouldConfigureLinuxUserData) app.commandLine.appendSwitch('user-data-dir', process.env.FDO_E2E_USER_DATA_DIR);
    if (shouldRestoreLinuxKeyring) {
        app.commandLine.removeSwitch('password-store');
        app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
    }
    // E2E fixtures explicitly exercise private-key operations. Keep that
    // coverage independent of interactive macOS Keychain prompts.
    if (shouldMockMacKeychain) app.commandLine.appendSwitch('use-mock-keychain');
}
