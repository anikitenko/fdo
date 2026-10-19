const {DatabaseSync} = require('node:sqlite');
const {X509Certificate, createPrivateKey} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCOPES = ['root', 'org', 'registry'];

function openCertificateDatabase(filename, protection) {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const db = new DatabaseSync(filename);
    try {
        fs.chmodSync(filename, 0o600);
        db.exec(/* language=SQLite */ `PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS certificates (
                scope TEXT NOT NULL, id TEXT NOT NULL, metadata TEXT NOT NULL, privateKey BLOB,
                PRIMARY KEY (scope, id)
            );`);
        const transaction = operation => {
            db.exec(/* language=SQLite */ 'BEGIN IMMEDIATE');
            try {const result = operation(); db.exec(/* language=SQLite */ 'COMMIT'); return result;}
            catch (error) {db.exec(/* language=SQLite */ 'ROLLBACK'); throw error;}
        };
        const assertScope = scope => {if (!SCOPES.includes(scope)) throw new Error('Invalid certificate scope');};
        const publicEntry = row => ({...JSON.parse(row.metadata), scope: row.scope, hasPrivateKey: !!row.hasPrivateKey});
        const list = scope => {
            if (scope !== undefined) assertScope(scope);
            return db.prepare(/* language=SQLite */ `SELECT scope, metadata, privateKey IS NOT NULL AS hasPrivateKey FROM certificates ${scope === undefined ? '' : 'WHERE scope = ?'} ORDER BY rowid`)
                .all(...(scope === undefined ? [] : [scope])).map(publicEntry);
        };
        const write = (entry, scope) => {
            assertScope(scope);
            const {key, hasPrivateKey, scope: ignoredScope, ...metadata} = entry;
            if (typeof metadata.id !== 'string' || !metadata.id || typeof metadata.label !== 'string' || !metadata.label) {
                throw new Error('Certificate ID and label are required');
            }
            const cert = new X509Certificate(metadata.cert);
            let encrypted = null;
            if (key != null) {
                if (typeof key !== 'string' || !cert.checkPrivateKey(createPrivateKey(key))) throw new Error('Private key does not match certificate');
                encrypted = protection.encrypt(key);
                if (!Buffer.isBuffer(encrypted) || !encrypted.length || protection.decrypt(encrypted) !== key) {
                    throw new Error('Could not verify encrypted certificate private key');
                }
            }
            db.prepare(/* language=SQLite */ 'INSERT INTO certificates (scope, id, metadata, privateKey) VALUES (?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET metadata = excluded.metadata, privateKey = excluded.privateKey')
                .run(scope, metadata.id, JSON.stringify(metadata), encrypted);
            // Verify the persisted bytes, not just the encryption result, before committing.
            const stored = db.prepare(/* language=SQLite */ 'SELECT metadata, privateKey FROM certificates WHERE scope = ? AND id = ?').get(scope, metadata.id);
            if (stored.metadata !== JSON.stringify(metadata) || (key != null && protection.decrypt(Buffer.from(stored.privateKey)) !== key)) {
                throw new Error('Could not verify stored certificate');
            }
        };
        return {
            list,
            put(entry, scope = 'root', previousId) {
                transaction(() => {
                    write(entry, scope);
                    if (previousId && previousId !== entry.id) db.prepare(/* language=SQLite */ 'DELETE FROM certificates WHERE scope = ? AND id = ?').run(scope, previousId);
                });
            },
            putIfLabelMissing(entry, scope = 'root') {
                assertScope(scope);
                let inserted = false;
                transaction(() => {
                    if (db.prepare(/* language=SQLite */ "SELECT 1 FROM certificates WHERE scope = ? AND json_extract(metadata, '$.label') = ?").get(scope, entry.label)) return;
                    write(entry, scope);
                    inserted = true;
                });
                return inserted;
            },
            update(id, patch, scope = 'root') {
                assertScope(scope);
                // Metadata changes must never decrypt or replace private keys.
                if (Object.keys(patch).some(key => !['label', 'lastUsedAt'].includes(key))) throw new Error('Invalid certificate metadata update');
                const row = db.prepare(/* language=SQLite */ 'SELECT metadata FROM certificates WHERE scope = ? AND id = ?').get(scope, id);
                if (row) db.prepare(/* language=SQLite */ 'UPDATE certificates SET metadata = ? WHERE scope = ? AND id = ?').run(JSON.stringify({...JSON.parse(row.metadata), ...patch}), scope, id);
            },
            remove(id, scope = 'root') {assertScope(scope); db.prepare(/* language=SQLite */ 'DELETE FROM certificates WHERE scope = ? AND id = ?').run(scope, id);},
            privateKey(id, scope = 'root') {
                assertScope(scope);
                const row = db.prepare(/* language=SQLite */ 'SELECT privateKey, metadata FROM certificates WHERE scope = ? AND id = ?').get(scope, id);
                if (!row?.privateKey) return null;
                const key = protection.decrypt(Buffer.from(row.privateKey));
                if (!new X509Certificate(JSON.parse(row.metadata).cert).checkPrivateKey(createPrivateKey(key))) throw new Error('Stored private key does not match certificate');
                return key;
            },
            migrate(settings) {
                const legacy = settings.get('certificates');
                if (legacy === undefined) return;
                if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)
                    || Object.keys(legacy).some(scope => !SCOPES.includes(scope))) throw new Error('Invalid existing certificate collection');
                transaction(() => {
                    for (const scope of SCOPES) {
                        const records = legacy[scope] ?? [];
                        if (!Array.isArray(records)) throw new Error('Invalid existing certificate collection');
                        for (const record of records) write(record, scope);
                    }
                });
                // A failed import or encryption leaves the original settings untouched.
                // Retrying after a crash is safe because records are keyed by scope and ID.
                settings.delete('certificates');
            },
            close: () => db.close(),
        };
    } catch (error) {db.close(); throw error;}
}

// Preview commands must not initialize/migrate the database or access key bytes.
function readCertificateMetadata(filename, scope = 'root') {
    if (!SCOPES.includes(scope)) throw new Error('Invalid certificate scope');
    if (!fs.existsSync(filename)) return [];
    const db = new DatabaseSync(filename, {readOnly: true});
    // language=SQLite
    const query = 'SELECT metadata, privateKey IS NOT NULL AS hasPrivateKey FROM certificates WHERE scope = ? ORDER BY rowid';
    try {
        return db.prepare(query)
            .all(scope).map(row => ({...JSON.parse(row.metadata), scope, hasPrivateKey: !!row.hasPrivateKey}));
    } finally {db.close();}
}

module.exports = {openCertificateDatabase, readCertificateMetadata};
