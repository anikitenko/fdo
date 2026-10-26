const {failure} = require('./contracts.cjs');
const {osCredentialSession} = require('../persistence/osCredentialSession.cjs');
function createProtection(safeStorage, platform = process.platform) {
    const session = osCredentialSession(safeStorage, {platform});
    const check = () => {
        if (platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend?.())) throw failure('UNAVAILABLE');
        // On macOS the availability probe itself stores a denial for the process.
        // The isolated session prompts again on the next attempt instead.
        if (!session.usesIsolatedKeychainPrompt() && !safeStorage.isEncryptionAvailable()) throw failure('LOCKED');
        // Probe the provider even for missing reads and metadata-only operations;
        // a positive availability flag alone must not mask a locked keychain.
        let verified;
        try {
            const probe = 'FDO host credential store readiness';
            verified = session.decrypt(session.encrypt(probe)) === probe;
        } catch {throw failure('LOCKED');}
        if (!verified) throw failure('LOCKED');
    };
    return {
        check,
        encrypt(value) {check(); try {return session.encrypt(value);} catch {throw failure('LOCKED');}},
        decrypt(value) {check(); try {return session.decrypt(value);} catch {throw failure('LOCKED');}},
    };
}
module.exports = {createProtection};
