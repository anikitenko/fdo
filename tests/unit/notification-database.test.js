const {afterEach, beforeEach, expect, test} = require('@jest/globals');
const {Buffer} = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openNotificationDatabase: openDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');
const openNotificationDatabase = (filename, records = []) => {
    const db = openDatabase(filename);
    for (const record of records) db.execute('add', record);
    return db;
};

let directory;
let filename;
let database;
const item = {id: 'one', title: 'Private notification title', message: 'Private notification message', type: 'warning',
    read: false, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z'};
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-db-')); filename = path.join(directory, 'notifications.sqlite'); });
afterEach(() => { database?.close(); database = null; fs.rmSync(directory, {recursive: true, force: true}); });

test('preserves updates and deletions across reopen', () => {
    database = openNotificationDatabase(filename, [item]);
    database.execute('read', 'one');
    database.close(); database = openNotificationDatabase(filename);
    expect(database.all()[0].read).toBe(true);
    database.execute('deleteAll', undefined);
    database.close(); database = openNotificationDatabase(filename);
    expect(database.all()).toEqual([]);
});

test('persists added records, updates read flags, and deletes only the requested record', () => {
    database = openNotificationDatabase(filename, [item]);
    const second = {...item, id: 'two', title: 'Second'};
    expect(database.execute('add', second).notifications).toEqual([item, second]);
    expect(database.execute('readAll', undefined).notifications.every(record => record.read)).toBe(true);
    expect(database.execute('readAll', undefined).changed).toBe(false);
    expect(database.execute('delete', 'missing').changed).toBe(false);
    expect(database.execute('delete', 'one').notifications.map(record => record.id)).toEqual(['two']);
});

test('keeps notification text encrypted in the database and journal', () => {
    database = openNotificationDatabase(filename, [item]);
    for (const file of fs.readdirSync(directory)) {
        const bytes = Buffer.from(fs.readFileSync(path.join(directory, file)));
        expect(bytes.includes(Buffer.from(item.title))).toBe(false);
        expect(bytes.includes(Buffer.from(item.message))).toBe(false);
    }
    expect(database.all()).toEqual([item]);
});

test('rejects invalid records without replacing existing history', () => {
    database = openNotificationDatabase(filename, [item]);
    expect(() => database.execute('add', {...item, id: 'bad', type: 'not-a-type'})).toThrow('Invalid notification');
    expect(database.all()).toEqual([item]);
});

test('detects changed encrypted payloads instead of returning stale cached text', () => {
    database = openNotificationDatabase(filename, [item]);
    expect(database.all()).toEqual([item]);
    const {DatabaseSync} = require('node:sqlite');
    const connection = new DatabaseSync(filename);
    try { connection.prepare(/* language=TEXT */ 'UPDATE notifications SET payload = zeroblob(40) WHERE id = ?').run(item.id); }
    finally { connection.close(); }
    expect(() => database.all()).toThrow();
});

test('groups repeated failures atomically, resolves the incident, and preserves metadata across restart', () => {
    database = openNotificationDatabase(filename);
    const failure = {...item, source: 'gitops', groupKey: 'gitops:repo:plugin', details: 'Private technical details',
        actions: [{kind: 'retry-gitops', repositoryId: 'repo', pluginName: 'plugin'}]};
    const first = database.execute('publish', failure);
    expect(first.alert).toBe(true);
    const repeat = database.execute('publish', {...failure, id: 'repeat', message: 'Latest failure'});
    expect(repeat.alert).toBe(false);
    expect(repeat.notification).toMatchObject({id: 'one', occurrences: 2, message: 'Latest failure'});
    expect(database.all()).toHaveLength(1);
    database.close(); database = openNotificationDatabase(filename);
    expect(database.all()[0]).toMatchObject({source: 'gitops', details: failure.details, actions: failure.actions, occurrences: 2});
    const resolved = database.execute('publish', {...failure, id: 'recovery', status: 'resolved', type: 'success', title: 'Recovered'});
    expect(resolved).toMatchObject({changed: true, alert: true, notification: {id: 'one', status: 'resolved', occurrences: 2}});
    expect(database.execute('publish', {...failure, status: 'resolved'}).changed).toBe(false);
    expect(database.execute('publish', {...failure, id: 'new-incident'}).notification.id).toBe('new-incident');
    for (const file of fs.readdirSync(directory)) expect(Buffer.from(fs.readFileSync(path.join(directory, file))).includes(Buffer.from(failure.details))).toBe(false);
});

test('dismissal undo restores only its batch, keeps new arrivals, and is single use', () => {
    database = openNotificationDatabase(filename, [item]);
    database.execute('dismiss', {token: 'batch'});
    expect(database.all()).toEqual([]);
    database.execute('add', {...item, id: 'new'});
    expect(database.execute('undo', 'batch').changed).toBe(true);
    expect(database.all().map(item => item.id)).toEqual(['one', 'new']);
    expect(database.execute('undo', 'batch').changed).toBe(false);
    database.execute('unread', 'one');
    database.execute('read', 'one');
    expect(database.execute('unread', 'one').notifications[0].read).toBe(false);
});

test('expired undo tokens cannot restore old dismissals and retention removes expired history', () => {
    database = openNotificationDatabase(filename, [item]);
    database.execute('dismiss', {id: 'one', token: 'expired'});
    const {DatabaseSync} = require('node:sqlite');
    const connection = new DatabaseSync(filename);
    try {
        connection.prepare(/* language=SQLite */ 'UPDATE notifications SET dismissedAt = ? WHERE id = ? AND dismissalToken = ?')
            .run('2020-01-01T00:00:00Z', item.id, 'expired');
    }
    finally {connection.close();}
    expect(database.execute('undo', 'expired').changed).toBe(false);
    database.execute('add', {...item, id: 'ancient', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z'});
    database.execute('add', {...item, id: 'recent', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
    database.execute('prune', 30);
    expect(database.all().map(item => item.id)).toEqual(['recent']);
});

test('upgrades the previous SQLite schema without losing history', () => {
    database = openNotificationDatabase(filename, [item]);
    database.close(); database = null;
    const {DatabaseSync} = require('node:sqlite');
    const connection = new DatabaseSync(filename);
    try {
        connection.exec(/* language=SQLite */ 'ALTER TABLE notifications DROP COLUMN dismissedAt; ALTER TABLE notifications DROP COLUMN dismissalToken');
    } finally {connection.close();}
    database = openNotificationDatabase(filename);
    expect(database.all()).toEqual([item]);
    database.execute('dismiss', {id: item.id, token: 'upgraded'});
    expect(database.execute('undo', 'upgraded').notifications).toEqual([item]);
});

test('undo merges an incident that recurred during dismissal instead of duplicating it', () => {
    database = openNotificationDatabase(filename);
    database.execute('publish', {...item, groupKey: 'ongoing'});
    database.execute('dismiss', {id: item.id, token: 'incident'});
    database.execute('publish', {...item, id: 'new', groupKey: 'ongoing', message: 'Latest failure'});
    database.execute('undo', 'incident');
    expect(database.all()).toHaveLength(1);
    expect(database.all()[0]).toMatchObject({id: 'new', message: 'Latest failure', occurrences: 2});
});
