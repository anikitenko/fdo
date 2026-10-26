import {safeStorage} from 'electron';
import {osCredentialSession} from './osCredentialSession.cjs';

function credentialStoreUnavailable() {
    return safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        || (!osCredentialSession(safeStorage).usesIsolatedKeychainPrompt() && !safeStorage.isEncryptionAvailable());
}
export function encryptDiagnostic(value) {
    if (credentialStoreUnavailable()) throw new Error('Unlock or configure your OS credential store to save secrets or diagnostic content.');
    return osCredentialSession(safeStorage).encrypt(JSON.stringify(value));
}
export function decryptDiagnostic(data) {
    if (credentialStoreUnavailable()) throw new Error('The OS credential store is unavailable.');
    return JSON.parse(osCredentialSession(safeStorage).decrypt(Buffer.from(data)));
}
