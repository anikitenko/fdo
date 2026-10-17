const {DatabaseSync} = require('node:sqlite');
const {createCipheriv, createDecipheriv, randomBytes, hkdfSync} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function transaction(db, operation) {
    db.exec(/* language=SQLite */ 'BEGIN IMMEDIATE');
    let committed = false;
    try {
        operation();
        db.exec(/* language=SQLite */ 'COMMIT');
        committed = true;
    } finally {
        if (!committed) db.exec(/* language=SQLite */ 'ROLLBACK');
    }
}

function openNotificationDatabase(filename) {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const db = new DatabaseSync(filename);
    try {
        fs.chmodSync(filename, 0o600);
        db.exec(/* language=SQLite */ `PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY, payload BLOB NOT NULL, read INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL, updatedAt TEXT
            );`);
        const columns = db.prepare(/* language=SQLite */ 'PRAGMA table_info(notifications)').all().map(column => column.name);
        if (!columns.includes('dismissedAt')) db.exec(/* language=SQLite */ 'ALTER TABLE notifications ADD COLUMN dismissedAt TEXT');
        if (!columns.includes('dismissalToken')) db.exec(/* language=SQLite */ 'ALTER TABLE notifications ADD COLUMN dismissalToken TEXT');
        db.prepare(/* language=TEXT */ 'INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('salt', randomBytes(32).toString('base64'));
        const salt = Buffer.from(db.prepare(/* language=TEXT */ 'SELECT value FROM metadata WHERE key = ?').get('salt').value, 'base64');
        // Preserve electron-store's existing application-key obfuscation. This
        // is not OS-backed secret storage; credentials stay in their old store.
        const key = Buffer.from(hkdfSync('sha256', Buffer.from('FDO-APPLICATION'), salt, Buffer.from('notifications'), 32));
        const encode = item => {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(item.id));
            const {id, read, createdAt, updatedAt, ...payload} = item;
            const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
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
        const all = () => db.prepare(/* language=TEXT */ 'SELECT * FROM notifications WHERE dismissedAt IS NULL ORDER BY rowid').all().map(decode);
        return {
            all,
            execute(operation, value, includeSnapshot = true) {
                let result;
                let notification;
                let alert = false;
                const now = new Date().toISOString();
                switch (operation) {
                    case 'ready': return true;
                    case 'all': return all();
                    case 'add': result = add(value); break;
                    case 'publish': {
                        const previous = all().find(item => item.groupKey === value.groupKey && item.status !== 'resolved');
                        if (value.status === 'resolved' && !previous) return {changed: false, notifications: null};
                        notification = previous ? {...previous, ...value, id: previous.id, createdAt: previous.createdAt,
                            occurrences: value.status === 'resolved' ? previous.occurrences || 1 : (previous.occurrences || 1) + 1,
                            lastOccurredAt: now, read: false} : {...value, occurrences: 1, lastOccurredAt: now};
                        alert = !previous || value.status === 'resolved';
                        result = previous ? db.prepare(/* language=SQLite */ 'UPDATE notifications SET payload = ?, read = 0, updatedAt = ? WHERE id = ?')
                            .run(encode(notification), now, previous.id) : add(notification);
                        break;
                    }
                    case 'read': result = db.prepare(/* language=TEXT */ 'UPDATE notifications SET read = 1, updatedAt = ? WHERE id = ? AND read = 0').run(now, value); break;
                    case 'unread': result = db.prepare(/* language=SQLite */ 'UPDATE notifications SET read = 0, updatedAt = ? WHERE id = ? AND read = 1').run(now, value); break;
                    case 'readAll': result = db.prepare(/* language=TEXT */ 'UPDATE notifications SET read = 1, updatedAt = ? WHERE read = 0').run(now); break;
                    case 'delete': result = db.prepare(/* language=TEXT */ 'DELETE FROM notifications WHERE id = ?').run(value); payloadCache.delete(value); break;
                    case 'deleteAll': result = db.prepare(/* language=TEXT */ 'DELETE FROM notifications').run(); payloadCache.clear(); break;
                    case 'dismiss': result = value.id
                        ? db.prepare(/* language=SQLite */ 'UPDATE notifications SET dismissedAt = ?, dismissalToken = ? WHERE id = ? AND dismissedAt IS NULL').run(now, value.token, value.id)
                        : db.prepare(/* language=SQLite */ 'UPDATE notifications SET dismissedAt = ?, dismissalToken = ? WHERE dismissedAt IS NULL').run(now, value.token); break;
                    case 'undo': {
                        const dismissed = db.prepare(/* language=SQLite */ 'SELECT * FROM notifications WHERE dismissalToken = ? AND dismissedAt >= ?')
                            .all(value, new Date(Date.now() - 15000).toISOString());
                        transaction(db, () => {
                            for (const row of dismissed) {
                                const old = decode(row);
                                const current = old.groupKey && old.status !== 'resolved' && all().find(item => item.groupKey === old.groupKey && item.status !== 'resolved');
                                if (current) {
                                    // A failure may recur during the Undo window. Keep one incident with the latest details.
                                    const merged = {...current, occurrences: (current.occurrences || 1) + (old.occurrences || 1)};
                                    db.prepare(/* language=SQLite */ 'UPDATE notifications SET payload = ?, read = ?, createdAt = ? WHERE id = ?')
                                        .run(encode(merged), Number(current.read && old.read), old.createdAt < current.createdAt ? old.createdAt : current.createdAt, current.id);
                                    db.prepare(/* language=SQLite */ 'DELETE FROM notifications WHERE id = ?').run(old.id);
                                    payloadCache.delete(old.id);
                                } else db.prepare(/* language=SQLite */ 'UPDATE notifications SET dismissedAt = NULL, dismissalToken = NULL WHERE id = ?').run(old.id);
                            }
                        });
                        result = {changes: dismissed.length}; break;
                    }
                    case 'prune': {
                        const cutoff = value ? new Date(Date.now() - value * 86400000).toISOString() : null;
                        result = db.prepare(/* language=SQLite */ 'DELETE FROM notifications WHERE (dismissedAt IS NOT NULL AND dismissedAt < ?) OR (? IS NOT NULL AND COALESCE(updatedAt, createdAt) < ?)')
                            .run(new Date(Date.now() - 86400000).toISOString(), cutoff, cutoff);
                        if (result.changes) payloadCache.clear(); break;
                    }
                    default: throw new Error(`Unknown notification operation: ${operation}`);
                }
                return {changed: Number(result.changes) > 0, notifications: result.changes && includeSnapshot ? all() : null,
                    ...(notification ? {notification, alert} : {})};
            },
            close: () => db.close(),
        };
    } catch (error) {
        db.close();
        throw error;
    }
}

module.exports = {openNotificationDatabase};
