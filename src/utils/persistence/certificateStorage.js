import {app, safeStorage} from 'electron';
import path from 'node:path';
import {settings} from './store';
import {openCertificateDatabase, readCertificateMetadata} from './certificateDatabase.cjs';
import {osCredentialSession} from './osCredentialSession.cjs';

let database;
function legacyCertificates(scope) {
    const legacy = settings.get('certificates') || {};
    const scopes = scope === undefined ? ['root', 'org', 'registry'] : [scope];
    return scopes.flatMap(currentScope => (legacy[currentScope] || []).map(({key, ...entry}) => ({
        ...entry,
        scope: currentScope,
        hasPrivateKey: typeof key === 'string' && !!key,
    })));
}
function requireProtection() {
    const unavailable = safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        || (!osCredentialSession(safeStorage).usesIsolatedKeychainPrompt() && !safeStorage.isEncryptionAvailable());
    if (unavailable) {
        throw new Error('Certificate private keys require an available OS credential store. Unlock or configure your system keychain and try again.');
    }
}
export function initializeCertificateStorage({migrateLegacy = true} = {}) {
    if (database) {
        if (migrateLegacy) database.migrate(settings);
        return database;
    }
    if (!app.isReady()) throw new Error('Certificate storage requires Electron to be ready');
    const candidate = openCertificateDatabase(path.join(path.dirname(settings.path), 'certificates.sqlite'), {
        encrypt(key) {requireProtection(); return osCredentialSession(safeStorage).encrypt(key);},
        decrypt(data) {requireProtection(); return osCredentialSession(safeStorage).decrypt(data);},
    });
    try {
        if (migrateLegacy) candidate.migrate(settings);
        database = candidate;
    }
    catch (error) {candidate.close(); throw error;}
    return database;
}
function migrateLegacy() {
    return initializeCertificateStorage({migrateLegacy: true});
}
export const certificateStorage = {
    list(scope) {
        const stored = initializeCertificateStorage({migrateLegacy: false}).list(scope);
        const known = new Set(stored.map(entry => `${entry.scope}:${entry.id}`));
        return [...stored, ...legacyCertificates(scope).filter(entry => !known.has(`${entry.scope}:${entry.id}`))];
    },
    put(entry, scope, previousId) {migrateLegacy().put(entry, scope, previousId);},
    putIfLabelMissing(entry, scope) {return migrateLegacy().putIfLabelMissing(entry, scope);},
    update(id, patch, scope = 'root') {
        const db = initializeCertificateStorage({migrateLegacy: false}), stored = db.list(scope).some(entry => entry.id === id);
        if (stored) return db.update(id, patch, scope);
        const legacy = settings.get('certificates');
        if (!legacy || !Array.isArray(legacy[scope])) return;
        settings.set('certificates', {...legacy, [scope]: legacy[scope].map(entry => entry.id === id ? {...entry, ...patch} : entry)});
    },
    remove(id, scope = 'root') {
        const db = initializeCertificateStorage({migrateLegacy: false}), stored = db.list(scope).some(entry => entry.id === id);
        if (stored) return db.remove(id, scope);
        const legacy = settings.get('certificates');
        if (!legacy || !Array.isArray(legacy[scope])) return;
        settings.set('certificates', {...legacy, [scope]: legacy[scope].filter(entry => entry.id !== id)});
    },
    privateKey(id, scope) {return migrateLegacy().privateKey(id, scope);},
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
