// CLI regressions must fail immediately if a command accidentally opens UI.
const path = require('node:path');
const {app} = require('electron');
// Match Playwright's macOS keychain identity for certificates created by the
// isolated GUI. Linux CI restores its real private Secret Service session.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
    if (process.env.FDO_E2E_USER_DATA_DIR) {
        app.commandLine.appendSwitch('disk-cache-dir', path.join(process.env.FDO_E2E_USER_DATA_DIR, 'cli-chromium-cache'));
    }
}
require('./credentialStoreBootstrap.cjs');
app.on('browser-window-created', () => {
    console.error('CLI regression: a command created a BrowserWindow.');
    app.exit(97);
});
