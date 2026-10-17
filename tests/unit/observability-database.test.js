/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openObservabilityDatabase} = require('../../src/utils/persistence/observabilityDatabase.cjs');
let directory, filename, database;
const now = Date.now();
const usage = (id = 'request', createdAt = now) => ({id, startedAt: new Date(createdAt).toISOString(), provider: 'openai', model: 'test', surface: 'chat', sessionId: 'one', status: 'completed', usage: {input_tokens: 10}, cost: {status: 'unknown'}});
const trace = (id = 'trace', destination = 'project-one', createdAt = now) => ({kind: 'trace', value: {id, destination, createdAt, sessionId: 'one', name: 'AI turn', status: 'completed', payload: Buffer.from('encrypted-trace')}});
beforeEach(() => {directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-observability-db-')); filename = path.join(directory, 'observability.sqlite'); database = openObservabilityDatabase(filename);});
afterEach(() => {database.close(); fs.rmSync(directory, {recursive: true, force: true});});

test('imports history atomically and idempotently, upserts individual usage records, and indexes history by scope and time', () => {
    const records = [{kind: 'metrics', value: {createdAt: now, totals: {tokens: {requests: 3}}}}, {kind: 'usage', value: usage()}];
    database.execute('initialize', {records});
    database.execute('initialize', {records: [{kind: 'usage', value: usage('duplicate')}]});
    database.execute('batch', [{kind: 'usage', value: {...usage(), status: 'failed'}}]);
    expect(database.execute('usage')).toHaveLength(1);
    expect(database.execute('usage')[0].status).toBe('failed');
    expect(database.execute('metrics').totals.tokens.requests).toBe(3);
    database.close(); database = openObservabilityDatabase(filename);
    expect(database.execute('usage')).toHaveLength(1);
    const inspect = new DatabaseSync(filename);
    expect(inspect.prepare(/* language=SQLite */ 'PRAGMA index_list(usage_entries)').all().map(row => row.name)).toContain('usage_scope');
    inspect.close();
});
test('failed imports roll back all records and can be retried', () => {
    expect(() => database.execute('initialize', {records: [{kind: 'usage', value: usage()}, {kind: 'usage', value: {id: 'invalid'}}]})).toThrow();
    expect(database.execute('usage')).toEqual([]);
    database.execute('initialize', {records: [{kind: 'usage', value: usage()}]});
    expect(database.execute('usage')).toHaveLength(1);
});
test('export work survives restart, respects backoff, and stays bound to its original destination', () => {
    database.execute('batch', [trace(), trace('other', 'project-two')]);
    database.execute('export-result', {id: 'trace', destination: 'project-one', state: 'pending', attempts: 1, nextAttemptAt: now + 10000, error: 'Retrying'});
    database.close(); database = openObservabilityDatabase(filename);
    expect(database.execute('due', {destination: 'project-one', now})).toEqual([]);
    expect(database.execute('due', {destination: 'project-one', now: now + 10001})[0]).toMatchObject({id: 'trace', attempts: 1});
    database.execute('export-result', {id: 'trace', destination: 'project-two', state: 'sent', attempts: 2});
    expect(database.execute('overview').traces.find(item => item.id === 'trace').exportState).toBe('pending');
    database.execute('retry', {destination: 'project-one'});
    expect(database.execute('due', {destination: 'project-one', now})).toHaveLength(1);
});
test('retention is independent for runtime, diagnostics, traces and accounting; runtime queries use plugin identities across restarts', () => {
    const old = now - 10 * 86400000;
    database.execute('batch', [trace('old', null, old), {kind: 'usage', value: usage('old-usage', old)},
        {kind: 'runtime', value: {createdAt: now, sessionId: 'launch-one', metrics: [{pluginId: 'calculator', metric: {pid: 42, memory: {workingSetSize: 4}}}]}},
        {kind: 'runtime', value: {createdAt: now + 10000, sessionId: 'launch-two', metrics: [{pluginId: 'calculator', metric: {pid: 99}}]}}]);
    expect(database.execute('runtime', {pluginId: 'calculator', to: now + 20000}).map(item => item.metric.pid)).toEqual([42, 99]);
    database.execute('prune', {now, runtimeDays: 7, diagnosticsDays: 30, traceDays: 1, usageDays: 365});
    expect(database.execute('overview').counts).toMatchObject({traces: 0, usage_entries: 1, runtime_samples: 2});
});
