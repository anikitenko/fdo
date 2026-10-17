const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openObservabilityDatabase(filename) {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    db.exec(/* language=SQLite */ `PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_metrics (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metric_history (createdAt INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS retrieval_misses (id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, payload BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS usage_entries (id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, surface TEXT, sessionId TEXT, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS usage_time ON usage_entries(createdAt);
        CREATE INDEX IF NOT EXISTS usage_scope ON usage_entries(surface, sessionId, createdAt);
        CREATE TABLE IF NOT EXISTS runtime_samples (id INTEGER PRIMARY KEY, createdAt INTEGER NOT NULL, pluginId TEXT, sessionId TEXT NOT NULL, pid INTEGER, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS runtime_plugin_time ON runtime_samples(pluginId, createdAt);
        CREATE TABLE IF NOT EXISTS startup_events (id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, sessionId TEXT NOT NULL, event TEXT NOT NULL, elapsed INTEGER NOT NULL, payload TEXT NOT NULL, details BLOB);
        CREATE INDEX IF NOT EXISTS startup_time ON startup_events(createdAt);
        CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, sessionId TEXT, name TEXT NOT NULL, status TEXT NOT NULL,
            payload BLOB NOT NULL, destination TEXT, exportState TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL DEFAULT 0, lastError TEXT);
        CREATE INDEX IF NOT EXISTS traces_time ON traces(createdAt);
        CREATE INDEX IF NOT EXISTS traces_export ON traces(destination, exportState, nextAttemptAt);`);
    const transaction = run => {
        db.exec(/* language=SQLite */ 'BEGIN IMMEDIATE');
        try {const result = run(); db.exec(/* language=SQLite */ 'COMMIT'); return result;} catch (error) {db.exec(/* language=SQLite */ 'ROLLBACK'); throw error;}
    };
    const json = value => JSON.stringify(value);
    const blob = value => value == null ? null : Buffer.from(value);
    const write = ({kind, value}) => {
        switch (kind) {
            case 'metrics': {
                const text = json(value.totals);
                db.prepare(/* language=SQLite */ 'INSERT INTO ai_metrics VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(text);
                db.prepare(/* language=SQLite */ 'INSERT OR REPLACE INTO metric_history VALUES (?, ?)').run(Math.floor(value.createdAt / 60000) * 60000, text);
                break;
            }
            case 'miss': db.prepare(/* language=SQLite */ 'INSERT OR IGNORE INTO retrieval_misses VALUES (?, ?, ?)').run(value.id, value.createdAt, blob(value.payload)); break;
            case 'usage': {
                if (!value.id || !Number.isFinite(Date.parse(value.startedAt))) throw new Error('Invalid usage record');
                db.prepare(/* language=SQLite */ 'INSERT INTO usage_entries VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
                    .run(value.id, Date.parse(value.startedAt), value.surface ?? null, value.sessionId ?? null, json(value)); break;
            }
            case 'runtime':
                for (const item of value.metrics) db.prepare(/* language=SQLite */ 'INSERT INTO runtime_samples(createdAt, pluginId, sessionId, pid, payload) VALUES (?, ?, ?, ?, ?)')
                    .run(value.createdAt, item.pluginId ?? null, value.sessionId, item.metric.pid, json(item.metric));
                break;
            case 'startup': db.prepare(/* language=SQLite */ 'INSERT OR IGNORE INTO startup_events VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(value.id, value.createdAt, value.sessionId, value.event, value.elapsed, json(value.summary), blob(value.details)); break;
            case 'trace': db.prepare(/* language=SQLite */ 'INSERT OR IGNORE INTO traces(id, createdAt, sessionId, name, status, payload, destination, exportState) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(value.id, value.createdAt, value.sessionId, value.name, value.status, blob(value.payload), value.destination, value.destination ? 'pending' : 'local'); break;
            default: throw new Error('Unknown observability record');
        }
    };
    const traceColumns = 'id, createdAt, sessionId, name, status, exportState, attempts, nextAttemptAt, lastError';
    const boundedLimit = (value, fallback = 100) => Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : fallback;
    return {
        execute(operation, value = {}) {
            switch (operation) {
                case 'initialize': return transaction(() => {
                    if (!db.prepare(/* language=SQLite */ 'SELECT 1 FROM metadata WHERE key = ?').get('settings-import-v1')) {
                        for (const record of value.records || []) write(record);
                        db.prepare(/* language=SQLite */ 'INSERT INTO metadata VALUES (?, ?)').run('settings-import-v1', 'complete');
                    }
                    return true;
                });
                case 'batch': return transaction(() => {for (const record of value) write(record); return true;});
                case 'metrics': {
                    const row = db.prepare(/* language=SQLite */ 'SELECT payload FROM ai_metrics WHERE id = 1').get();
                    return {totals: row ? JSON.parse(row.payload) : {}, misses: db.prepare(/* language=SQLite */ 'SELECT payload FROM retrieval_misses ORDER BY createdAt DESC LIMIT 50').all().reverse().map(row => row.payload)};
                }
                case 'usage': return db.prepare(/* language=SQLite */ 'SELECT payload FROM usage_entries ORDER BY createdAt DESC LIMIT 5000').all().reverse().map(row => JSON.parse(row.payload));
                case 'runtime': {
                    const interval = Math.max(10000, Number.isFinite(value.interval) ? value.interval : 10000);
                    return db.prepare(/* language=SQLite */ `SELECT createdAt AS date, payload FROM (
                        SELECT createdAt, payload, ROW_NUMBER() OVER (PARTITION BY CAST(createdAt / ? AS INTEGER) ORDER BY createdAt DESC) AS position
                        FROM runtime_samples WHERE pluginId = ? AND createdAt >= ? AND createdAt <= ?
                    ) WHERE position = 1 ORDER BY createdAt DESC LIMIT 5000`)
                        .all(interval, value.pluginId, value.from ?? 0, value.to ?? Date.now()).reverse().map(row => ({date: row.date, metric: JSON.parse(row.payload)}));
                }
                case 'overview': return {
                    counts: Object.fromEntries(['usage_entries', 'runtime_samples', 'startup_events', 'traces'].map(table => [table, db.prepare(/* language=SQLite */ `SELECT count(*) AS count FROM ${table}`).get().count])),
                    exports: db.prepare(/* language=SQLite */ 'SELECT exportState AS state, count(*) AS count FROM traces GROUP BY exportState').all(),
                    traces: db.prepare(/* language=SQLite */ `SELECT ${traceColumns} FROM traces ORDER BY createdAt DESC LIMIT ?`).all(boundedLimit(value.limit, 30)),
                    startups: db.prepare(/* language=SQLite */ 'SELECT createdAt, sessionId, event, elapsed, payload FROM startup_events ORDER BY createdAt DESC LIMIT 100').all().map(({payload, ...row}) => ({...row, ...JSON.parse(payload)})),
                    metrics: JSON.parse(db.prepare(/* language=SQLite */ 'SELECT payload FROM ai_metrics WHERE id = 1').get()?.payload || '{}'),
                };
                case 'trace': return db.prepare(/* language=SQLite */ 'SELECT payload FROM traces WHERE id = ?').get(value.id)?.payload ?? null;
                case 'due': return db.prepare(/* language=SQLite */ 'SELECT id, payload, attempts FROM traces WHERE destination = ? AND exportState = ? AND nextAttemptAt <= ? ORDER BY createdAt LIMIT 10')
                    .all(value.destination, 'pending', value.now ?? Date.now());
                case 'export-status': return db.prepare(/* language=SQLite */ "SELECT count(*) AS remaining FROM traces WHERE destination = ? AND exportState IN ('pending', 'failed')").get(value.destination);
                case 'export-result': return db.prepare(/* language=SQLite */ 'UPDATE traces SET exportState = ?, attempts = ?, nextAttemptAt = ?, lastError = ? WHERE id = ? AND destination = ?')
                    .run(value.state, value.attempts, value.nextAttemptAt ?? 0, value.error ?? null, value.id, value.destination).changes;
                case 'retry': return db.prepare(/* language=SQLite */ "UPDATE traces SET exportState = 'pending', attempts = 0, nextAttemptAt = 0, lastError = NULL WHERE destination = ? AND exportState IN ('failed', 'pending')").run(value.destination).changes;
                case 'prune': return transaction(() => {
                    const now = value.now ?? Date.now();
                    for (const [table, days, cap] of [['runtime_samples', value.runtimeDays, 250000], ['startup_events', value.diagnosticsDays, 20000], ['traces', value.traceDays, 5000], ['usage_entries', value.usageDays, 5000], ['metric_history', value.diagnosticsDays, 50000], ['retrieval_misses', value.diagnosticsDays, 50]]) {
                        if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Invalid retention period');
                        db.prepare(/* language=SQLite */ `DELETE FROM ${table} WHERE createdAt < ?`).run(now - days * 86400000);
                        db.exec(/* language=SQLite */ `DELETE FROM ${table} WHERE rowid NOT IN (SELECT rowid FROM ${table} ORDER BY createdAt DESC LIMIT ${cap})`);
                    }
                    return true;
                });
                default: throw new Error('Unknown observability operation');
            }
        },
        close: () => db.close(),
    };
}
module.exports = {openObservabilityDatabase};
