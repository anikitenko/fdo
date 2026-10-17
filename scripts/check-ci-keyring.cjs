const {launchElectronApp, closeElectronApp} = require('../tests/e2e/helpers/electronApp');

async function checkCiKeyring(electron) {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const backend = await app.evaluate(({safeStorage}) => {
            const selected = safeStorage.getSelectedStorageBackend();
            if (selected !== 'gnome_libsecret' || !safeStorage.isEncryptionAvailable()) {
                throw new Error(`CI requires an unlocked GNOME Secret Service; Electron selected ${selected}.`);
            }
            const probe = 'FDO CI encryption check';
            if (safeStorage.decryptString(safeStorage.encryptString(probe)) !== probe) {
                throw new Error('CI credential-store encryption round trip failed.');
            }
            return selected;
        });
        console.log(`Playwright Electron credential store verified: ${backend}`);
    } finally {
        await closeElectronApp(app);
    }
}

module.exports = {checkCiKeyring};

if (require.main === module) {
    checkCiKeyring(require('playwright')._electron).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
