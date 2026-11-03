import {app, safeStorage} from 'electron';
import {osCredentialSession} from './osCredentialSession.cjs';

export function createAiCredentialProtection({platform = process.platform, application = app, storage = safeStorage} = {}) {
    const session = () => {
        if (!application.isReady()) throw new Error('Credential storage requires Electron to be ready.');
        if (platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend?.())) {
            throw new Error('An OS credential store is required.');
        }
        const current = osCredentialSession(storage, {platform});
        if (!current.usesIsolatedKeychainPrompt() && !storage.isEncryptionAvailable()) throw new Error('The OS credential store is locked.');
        return current;
    };
    return {encrypt: value => session().encrypt(value), decrypt: value => session().decrypt(value)};
}
