import {safeStorage} from 'electron';

export function encryptDiagnostic(value) {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
        throw new Error('Unlock or configure your OS credential store to save secrets or diagnostic content.');
    }
    return safeStorage.encryptString(JSON.stringify(value));
}
export function decryptDiagnostic(data) {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('The OS credential store is unavailable.');
    return JSON.parse(safeStorage.decryptString(Buffer.from(data)));
}
