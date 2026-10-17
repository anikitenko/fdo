const {DatabaseSync} = require('node:sqlite');
const {createCipheriv, createDecipheriv, randomBytes, hkdfSync} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function transaction(db, fn) {
    db.exec(/* language=SQLite */ 'BEGIN IMMEDIATE');
    let committed = false;
    try { const result = fn(); db.exec(/* language=SQLite */ 'COMMIT'); committed = true; return result; }
    finally { if (!committed) db.exec(/* language=SQLite */ 'ROLLBACK'); }
}

function openChatDatabase(filename) {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const db = new DatabaseSync(filename);
    try {
        fs.chmodSync(filename, 0o600);
        db.exec(/* language=TEXT */ `PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload BLOB NOT NULL,
                createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, messageCount INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS messages (sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(sessionId, id));
            CREATE INDEX IF NOT EXISTS message_order ON messages(sessionId, ordinal);`);
        const meta = key => db.prepare(/* language=TEXT */ 'SELECT value FROM metadata WHERE key = ?').get(key)?.value;
        db.prepare(/* language=TEXT */ 'INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('salt', randomBytes(32).toString('base64'));
        // Same application-key policy as the existing settings/notification stores.
        const key = Buffer.from(hkdfSync('sha256', Buffer.from('FDO-APPLICATION'), Buffer.from(meta('salt'), 'base64'), Buffer.from('chat-history'), 32));
        const cache = new Map();
        let cacheBytes = 0;
        const forget = id => {
            const entry = cache.get(id);
            if (entry) cacheBytes -= entry.bytes;
            cache.delete(id);
        };
        const remember = (id, entry) => {
            forget(id);
            entry.bytes = entry.data.byteLength + entry.text.length * 2;
            if (entry.bytes > 8 * 1024 * 1024) return;
            cache.set(id, entry);
            cacheBytes += entry.bytes;
            while (cacheBytes > 8 * 1024 * 1024) forget(cache.keys().next().value);
        };
        const text = (id, bytes) => {
            const data = Buffer.from(bytes);
            const cached = cache.get(id);
            if (cached?.data.equals(data)) return cached.text;
            const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
            cipher.setAAD(Buffer.from(id));
            cipher.setAuthTag(data.subarray(12, 28));
            const decoded = Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString();
            remember(id, {data, text: decoded});
            return decoded;
        };
        const encode = (id, value, previous) => {
            const serialized = JSON.stringify(value);
            if (previous && text(id, previous) === serialized) return previous;
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(id));
            const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
            const data = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
            remember(id, {data, text: serialized});
            return data;
        };
        const sessionKey = id => JSON.stringify(['session', id]);
        const messageKey = (sessionId, id) => JSON.stringify(['message', sessionId, id]);
        const get = id => {
            const row = db.prepare(/* language=TEXT */ 'SELECT payload FROM sessions WHERE id = ?').get(id);
            if (!row) return null;
            const messages = db.prepare(/* language=TEXT */ 'SELECT id, payload FROM messages WHERE sessionId = ? ORDER BY ordinal').all(id)
                .map(message => JSON.parse(text(messageKey(id, message.id), message.payload)));
            return {...JSON.parse(text(sessionKey(id), row.payload)), messages};
        };
        const put = session => {
            if (!session || typeof session.id !== 'string' || !session.id || typeof session.name !== 'string'
                || !Number.isFinite(Date.parse(session.createdAt)) || !Array.isArray(session.messages)
                || (session.updatedAt != null && !Number.isFinite(Date.parse(session.updatedAt)))) throw new Error('Invalid chat session');
            const ids = new Set();
            for (const message of session.messages) {
                if (!message || typeof message.id !== 'string' || !message.id || ids.has(message.id)
                    || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
                    || !Number.isFinite(Date.parse(message.createdAt))) throw new Error('Invalid chat message');
                ids.add(message.id);
            }
            const {messages, ...metadata} = session;
            const previous = db.prepare(/* language=TEXT */ 'SELECT * FROM sessions WHERE id = ?').get(session.id);
            const payload = encode(sessionKey(session.id), metadata, previous?.payload);
            const updatedAt = session.updatedAt || session.createdAt;
            if (!previous || payload !== previous.payload || previous.messageCount !== messages.length) {
                db.prepare(/* language=TEXT */ `INSERT INTO sessions VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, createdAt=excluded.createdAt,
                    updatedAt=excluded.updatedAt, messageCount=excluded.messageCount`)
                    .run(session.id, payload, session.createdAt, updatedAt, messages.length);
            }
            const previousMessages = new Map(db.prepare(/* language=TEXT */ 'SELECT * FROM messages WHERE sessionId = ?').all(session.id).map(row => [row.id, row]));
            messages.forEach((message, ordinal) => {
                const previous = previousMessages.get(message.id);
                const payload = encode(messageKey(session.id, message.id), message, previous?.payload);
                if (!previous || payload !== previous.payload || previous.ordinal !== ordinal) {
                    db.prepare(/* language=TEXT */ `INSERT INTO messages VALUES (?, ?, ?, ?)
                        ON CONFLICT(sessionId,id) DO UPDATE SET ordinal=excluded.ordinal, payload=excluded.payload`)
                        .run(session.id, message.id, ordinal, payload);
                }
                previousMessages.delete(message.id);
            });
            for (const id of previousMessages.keys()) {
                db.prepare(/* language=TEXT */ 'DELETE FROM messages WHERE sessionId = ? AND id = ?').run(session.id, id);
                forget(messageKey(session.id, id));
            }
            return session;
        };
        const pruneDrafts = () => {
            const {count} = db.prepare(/* language=TEXT */ 'SELECT count(*) AS count FROM sessions WHERE messageCount=0').get();
            if (count < 2) return;
            db.prepare(/* language=TEXT */ `DELETE FROM sessions WHERE messageCount=0 AND id NOT IN
                (SELECT id FROM sessions WHERE messageCount=0 ORDER BY julianday(updatedAt) DESC, rowid LIMIT 1)`).run();
        };
        return {
            execute(operation, value) {
                switch (operation) {
                    case 'ready': return true;
                    case 'get': return get(value);
                    case 'summaries':
                        pruneDrafts();
                        return db.prepare(/* language=TEXT */ 'SELECT id, payload, createdAt, updatedAt, messageCount FROM sessions ORDER BY julianday(updatedAt) DESC, rowid').all()
                            .map(row => ({id: row.id, name: JSON.parse(text(sessionKey(row.id), row.payload)).name,
                                createdAt: row.createdAt, updatedAt: row.updatedAt, messageCount: row.messageCount}));
                    case 'list':
                        pruneDrafts();
                        return db.prepare(/* language=TEXT */ 'SELECT id FROM sessions ORDER BY julianday(updatedAt) DESC, rowid').all().map(row => get(row.id));
                    case 'put': return transaction(db, () => { put(value); return true; });
                    case 'rename': return transaction(db, () => {
                        const session = get(value.id);
                        return session ? put({...session, name: value.name, updatedAt: value.updatedAt}) : null;
                    });
                    case 'create': return transaction(db, () => {
                        pruneDrafts();
                        const draft = db.prepare(/* language=TEXT */ 'SELECT id FROM sessions WHERE messageCount=0 LIMIT 1').get();
                        return put(draft ? {...get(draft.id), name: value.name, updatedAt: value.updatedAt} : value);
                    });
                    default: throw new Error(`Unknown chat storage operation: ${operation}`);
                }
            },
            close: () => db.close(),
        };
    } catch (error) { db.close(); throw error; }
}
module.exports = {openChatDatabase};
