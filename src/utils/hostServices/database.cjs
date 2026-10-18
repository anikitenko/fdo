const {DatabaseSync} = require('node:sqlite');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {failure, key} = require('./contracts.cjs');

function openVault(filename, protection) {
    fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
    fs.chmodSync(path.dirname(filename), 0o700);
    const db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    db.exec(/* language=SQLite */ `PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS installations (pluginId TEXT PRIMARY KEY, namespace TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS secrets (namespace TEXT NOT NULL REFERENCES installations(namespace) ON DELETE CASCADE,
            key TEXT NOT NULL, value BLOB NOT NULL, bytes INTEGER NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY(namespace,key));
        CREATE TABLE IF NOT EXISTS profiles (namespace TEXT NOT NULL REFERENCES installations(namespace) ON DELETE CASCADE,
            id TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY(namespace,id));
        CREATE TABLE IF NOT EXISTS git_policy (namespace TEXT PRIMARY KEY REFERENCES installations(namespace) ON DELETE CASCADE, enabled INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, pluginId TEXT NOT NULL, action TEXT NOT NULL,
            outcome TEXT NOT NULL, requestId TEXT NOT NULL, at TEXT NOT NULL);`);
    const transaction = fn => {db.exec(/* language=SQLite */ 'BEGIN IMMEDIATE'); try {const result = fn(); db.exec(/* language=SQLite */ 'COMMIT'); return result;} catch (error) {db.exec(/* language=SQLite */ 'ROLLBACK'); throw error;}};
    const namespace = pluginId => {
        const existing = db.prepare(/* language=SQLite */ 'SELECT namespace FROM installations WHERE pluginId = ?').get(pluginId);
        if (existing) return existing.namespace;
        const id = randomUUID(); db.prepare(/* language=SQLite */ 'INSERT INTO installations VALUES (?,?)').run(pluginId, id); return id;
    };
    const seal = (ns, name, value) => protection.encrypt(JSON.stringify({namespace: ns, name, value}));
    const unseal = (ns, name, value) => {
        let result;
        try {result = JSON.parse(protection.decrypt(Buffer.from(value)));} catch (error) {throw failure(error.code === 'LOCKED' ? 'LOCKED' : 'UNAVAILABLE');}
        if (result.namespace !== ns || result.name !== name) throw failure('UNAVAILABLE');
        return result.value;
    };
    const check = () => protection.check();
    return {
        set(pluginId, name, value) {
            check(); key(name);
            if (typeof value !== 'string' || Buffer.byteLength(value) > 1048576) throw failure('INVALID_REQUEST');
            return transaction(() => {
                const ns = namespace(pluginId), bytes = Buffer.byteLength(value);
                const totals = db.prepare(/* language=SQLite */ 'SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM secrets WHERE namespace = ? AND key <> ?').get(ns, name);
                if (totals.count >= 256 || totals.bytes + bytes > 8388608) throw failure('INVALID_REQUEST');
                const encrypted = seal(ns, name, value);
                if (unseal(ns, name, encrypted) !== value) throw failure('UNAVAILABLE');
                db.prepare(/* language=SQLite */ 'INSERT INTO secrets VALUES (?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,bytes=excluded.bytes,updatedAt=excluded.updatedAt')
                    .run(ns, name, encrypted, bytes, new Date().toISOString());
                return {stored: true};
            });
        },
        get(pluginId, name) {
            check(); key(name); const ns = namespace(pluginId);
            const row = db.prepare(/* language=SQLite */ 'SELECT value FROM secrets WHERE namespace = ? AND key = ?').get(ns, name);
            return row ? unseal(ns, name, row.value) : null;
        },
        list(pluginId) {check(); return db.prepare(/* language=SQLite */ 'SELECT key, updatedAt FROM secrets WHERE namespace = ? ORDER BY key COLLATE BINARY').all(namespace(pluginId)).map(row => ({...row}));},
        delete(pluginId, name) {check(); key(name); return {deleted: db.prepare(/* language=SQLite */ 'DELETE FROM secrets WHERE namespace = ? AND key = ?').run(namespace(pluginId), name).changes > 0};},
        gitMode(pluginId) {const row = db.prepare(/* language=SQLite */ 'SELECT enabled FROM git_policy WHERE namespace = ?').get(namespace(pluginId)); return row ? row.enabled === 1 : null;},
        gitEnabled(pluginId) {return db.prepare(/* language=SQLite */ 'SELECT enabled FROM git_policy WHERE namespace = ?').get(namespace(pluginId))?.enabled === 1;},
        setGitEnabled(pluginId, enabled) {check(); db.prepare(/* language=SQLite */ 'INSERT INTO git_policy VALUES (?,?) ON CONFLICT(namespace) DO UPDATE SET enabled=excluded.enabled').run(namespace(pluginId), enabled ? 1 : 0);},
        profiles(pluginId) {check(); const ns = namespace(pluginId); return db.prepare(/* language=SQLite */ 'SELECT id,value FROM profiles WHERE namespace = ? ORDER BY id').all(ns).map(row => unseal(ns, 'profile:' + row.id, row.value));},
        profile(pluginId, id) {
            check(); key(id); const ns = namespace(pluginId);
            const row = db.prepare(/* language=SQLite */ 'SELECT value FROM profiles WHERE namespace = ? AND id = ?').get(ns, id);
            return row ? unseal(ns, 'profile:' + id, row.value) : null;
        },
        summaries(pluginId, consumer) {
            check(); const ns = namespace(pluginId), summaries = [];
            for (const row of db.prepare(/* language=SQLite */ 'SELECT id,value FROM profiles WHERE namespace = ? ORDER BY id').iterate(ns)) {
                const value = unseal(ns, 'profile:' + row.id, row.value);
                if ((Array.isArray(consumer)?consumer:[consumer]).some(item=>value.policy.consumers.includes(item))) summaries.push({id:value.id,label:value.label,
                    host:value.host,port:value.port,username:value.username,authenticationType:value.authentication.type,
                    trustedHostKey:value.trustedHostKey});
            }
            return summaries;
        },
        putProfile(pluginId, value) {
            check(); return transaction(() => {
                const ns = namespace(pluginId);
                const count = db.prepare(/* language=SQLite */ 'SELECT COUNT(*) AS count FROM profiles WHERE namespace = ? AND id <> ?').get(ns, value.id).count;
                if (count >= 64) throw failure('INVALID_REQUEST');
                if (value.policy.consumers.includes('git')) db.prepare(/* language=SQLite */ 'INSERT INTO git_policy VALUES (?,1) ON CONFLICT(namespace) DO UPDATE SET enabled=1').run(ns);
                db.prepare(/* language=SQLite */ 'INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run(ns, value.id, seal(ns, 'profile:' + value.id, value));
            });
        },
        deleteProfile(pluginId, id) {check(); key(id); db.prepare(/* language=SQLite */ 'DELETE FROM profiles WHERE namespace = ? AND id = ?').run(namespace(pluginId), id);},
        uninstall(pluginId) {transaction(() => db.prepare(/* language=SQLite */ 'DELETE FROM installations WHERE pluginId = ?').run(pluginId));},
        audit(pluginId, action, outcome, requestId) {
            transaction(() => {
                db.prepare(/* language=SQLite */ 'INSERT INTO audit(pluginId,action,outcome,requestId,at) VALUES (?,?,?,?,?)').run(pluginId, action, outcome, requestId, new Date().toISOString());
                db.exec(/* language=SQLite */ 'DELETE FROM audit WHERE id <= (SELECT COALESCE(MAX(id),0)-1000 FROM audit)');
            });
        },
        close() {db.close();},
    };
}
module.exports = {openVault};
