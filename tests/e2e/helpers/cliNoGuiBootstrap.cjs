// CLI regressions must fail immediately if a command accidentally opens UI.
const {app} = require('electron');
// Match Playwright's macOS keychain identity for certificates created by the
// isolated GUI. Linux CI restores its real private Secret Service session.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('./credentialStoreBootstrap.cjs');
app.on('browser-window-created', () => {
    console.error('CLI regression: a command created a BrowserWindow.');
    app.exit(97);
});
