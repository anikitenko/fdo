const {failure} = require('./contracts.cjs');
function createProtection(safeStorage, platform = process.platform) {
    const check = () => {
        if (platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend?.())) throw failure('UNAVAILABLE');
        if (!safeStorage.isEncryptionAvailable()) throw failure('LOCKED');
        // Probe the provider even for missing reads and metadata-only operations;
        // a positive availability flag alone must not mask a locked keychain.
        let verified;
        try {
            const probe = 'FDO host credential store readiness';
            verified = safeStorage.decryptString(safeStorage.encryptString(probe)) === probe;
        } catch {throw failure('LOCKED');}
        if (!verified) throw failure('LOCKED');
    };
    return {
        check,
        encrypt(value) {check(); try {return safeStorage.encryptString(value);} catch {throw failure('LOCKED');}},
        decrypt(value) {check(); try {return safeStorage.decryptString(value);} catch {throw failure('LOCKED');}},
    };
}
module.exports = {createProtection};
