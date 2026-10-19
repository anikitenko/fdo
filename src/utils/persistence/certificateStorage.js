import {app, safeStorage} from 'electron';
import path from 'node:path';
import {settings} from './store';
import {openCertificateDatabase, readCertificateMetadata} from './certificateDatabase.cjs';

let database;
function requireProtection() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
        throw new Error('Certificate private keys require an available OS credential store. Unlock or configure your system keychain and try again.');
    }
}
export function initializeCertificateStorage() {
    if (database) return database;
    if (!app.isReady()) throw new Error('Certificate storage requires Electron to be ready');
    const candidate = openCertificateDatabase(path.join(path.dirname(settings.path), 'certificates.sqlite'), {
        encrypt(key) {requireProtection(); return safeStorage.encryptString(key);},
        decrypt(data) {requireProtection(); return safeStorage.decryptString(data);},
    });
    try {candidate.migrate(settings); database = candidate;}
    catch (error) {candidate.close(); throw error;}
    return database;
}
export const certificateStorage = {
    list: scope => initializeCertificateStorage().list(scope),
    put: (entry, scope, previousId) => initializeCertificateStorage().put(entry, scope, previousId),
    putIfLabelMissing: (entry, scope) => initializeCertificateStorage().putIfLabelMissing(entry, scope),
    update: (id, patch, scope) => initializeCertificateStorage().update(id, patch, scope),
    remove: (id, scope) => initializeCertificateStorage().remove(id, scope),
    privateKey: (id, scope) => initializeCertificateStorage().privateKey(id, scope),
};
export function closeCertificateStorage() {database?.close(); database = undefined;}

export function previewSigningCertificates() {
    const saved = readCertificateMetadata(path.join(path.dirname(settings.path), 'certificates.sqlite'), 'root');
    const legacy = settings.get('certificates')?.root ?? [];
    if (!Array.isArray(legacy)) throw new Error('Invalid existing certificate collection');
    const byId = new Map(saved.map(entry => [entry.id, entry]));
    for (const {key, ...entry} of legacy) byId.set(entry.id, {...entry, hasPrivateKey: typeof key === 'string' && !!key});
    return [...byId.values()];
}
