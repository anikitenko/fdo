const {app, safeStorage} = require('electron');

app.whenReady().then(() => {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend !== 'gnome_libsecret' || !safeStorage.isEncryptionAvailable()) {
        throw new Error(`CI requires an unlocked GNOME Secret Service; Electron selected ${backend}.`);
    }
    const probe = 'FDO CI encryption check';
    if (safeStorage.decryptString(safeStorage.encryptString(probe)) !== probe) {
        throw new Error('CI credential-store encryption round trip failed.');
    }
    console.log(`Electron credential store verified: ${backend}`);
    app.exit(0);
}).catch(error => {
    console.error(error.message);
    app.exit(1);
});
