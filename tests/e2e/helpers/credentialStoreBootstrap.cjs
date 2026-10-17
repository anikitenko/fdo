// Playwright's Electron loader runs first and selects --password-store=basic.
// Restore the real Secret Service only inside our isolated Linux CI session,
// before Electron initializes safeStorage. Never permit plaintext encryption.
if (process.platform === 'linux' && process.env.FDO_CI_KEYRING_SESSION === '1') {
    const {app} = require('electron');
    app.commandLine.removeSwitch('password-store');
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}
