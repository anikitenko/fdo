const {DatabaseSync} = require('node:sqlite');
const {createCipheriv, createDecipheriv, randomBytes, hkdfSync} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function transaction(db, operation) {
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
        operation();
        db.exec('COMMIT');
        committed = true;
    } finally {
        if (!committed) db.exec('ROLLBACK');
    }
}

function openNotificationDatabase(filename, legacy = []) {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const db = new DatabaseSync(filename);
    try {
        fs.chmodSync(filename, 0o600);
        db.exec(`PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY, payload BLOB NOT NULL, read INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL, updatedAt TEXT
            );`);
        db.prepare(/* language=TEXT */ 'INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('salt', randomBytes(32).toString('base64'));
        const salt = Buffer.from(db.prepare(/* language=TEXT */ 'SELECT value FROM metadata WHERE key = ?').get('salt').value, 'base64');
        // Preserve electron-store's existing application-key obfuscation. This
        // is not OS-backed secret storage; credentials stay in their old store.
        const key = Buffer.from(hkdfSync('sha256', Buffer.from('FDO-APPLICATION'), salt, Buffer.from('notifications'), 32));
        const encode = item => {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(item.id));
            const ciphertext = Buffer.concat([cipher.update(JSON.stringify({title: item.title, message: item.message, type: item.type})), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
        };
        const payloadCache = new Map();
        const decode = row => {
            const data = Buffer.from(row.payload);
            const cached = payloadCache.get(row.id);
            let payload = cached?.payload;
            if (!cached || !cached.data.equals(data)) {
                const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
                decipher.setAAD(Buffer.from(row.id));
                decipher.setAuthTag(data.subarray(12, 28));
                payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
                payloadCache.set(row.id, {data, payload});
            }
            return {id: row.id, ...payload, read: !!row.read, createdAt: row.createdAt,
                ...(row.updatedAt == null ? {} : {updatedAt: row.updatedAt})};
        };
        // SQL is verified by real database tests; these literals need no IDE data source.
        const insert = db.prepare(/* language=TEXT */ 'INSERT INTO notifications (id, payload, read, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
        const add = item => {
            if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string'
                || typeof item.message !== 'string' || !['', 'primary', 'warning', 'danger', 'success'].includes(item.type)
                || !Number.isFinite(Date.parse(item.createdAt))) {
                throw new Error('Invalid notification record');
            }
            return insert.run(item.id, encode(item), item.read ? 1 : 0, item.createdAt, item.updatedAt ?? null);
        };
        if (!db.prepare(/* language=TEXT */ 'SELECT value FROM metadata WHERE key = ?').get('json-import-v1')) {
            transaction(db, () => {
                for (const item of legacy) add(item);
                db.prepare(/* language=TEXT */ 'INSERT INTO metadata VALUES (?, ?)').run('json-import-v1', 'complete');
            });
        }
        const all = () => db.prepare(/* language=TEXT */ 'SELECT * FROM notifications ORDER BY rowid').all().map(decode);
        return {
            all,
            execute(operation, value, includeSnapshot = true) {
                let result;
                const now = new Date().toISOString();
                switch (operation) {
                    case 'all': return all();
                    case 'add': result = add(value); break;
                    case 'read': result = db.prepare(/* language=TEXT */ 'UPDATE notifications SET read = 1, updatedAt = ? WHERE id = ? AND read = 0').run(now, value); break;
                    case 'readAll': result = db.prepare(/* language=TEXT */ 'UPDATE notifications SET read = 1, updatedAt = ? WHERE read = 0').run(now); break;
                    case 'delete': result = db.prepare(/* language=TEXT */ 'DELETE FROM notifications WHERE id = ?').run(value); payloadCache.delete(value); break;
                    case 'deleteAll': result = db.prepare(/* language=TEXT */ 'DELETE FROM notifications').run(); payloadCache.clear(); break;
                    default: throw new Error(`Unknown notification operation: ${operation}`);
                }
                return {changed: Number(result.changes) > 0, notifications: result.changes && includeSnapshot ? all() : null};
            },
            close: () => db.close(),
        };
    } catch (error) {
        db.close();
        throw error;
    }
}

module.exports = {openNotificationDatabase};
