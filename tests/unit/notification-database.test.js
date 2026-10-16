const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openNotificationDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');

let directory;
let filename;
let database;
const item = {id: 'one', title: 'Private notification title', message: 'Private notification message', type: 'warning',
    read: false, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z'};
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-db-')); filename = path.join(directory, 'notifications.sqlite'); });
afterEach(() => { database?.close(); database = null; fs.rmSync(directory, {recursive: true, force: true}); });

test('imports once, preserves updates across reopen, and never resurrects deleted JSON records', () => {
    database = openNotificationDatabase(filename, [item]);
    expect(database.all()).toEqual([item]);
    expect(database.execute('read', 'one').changed).toBe(true);
    expect(database.execute('read', 'one').changed).toBe(false);
    database.close();
    database = openNotificationDatabase(filename, [item]);
    expect(database.all()[0].read).toBe(true);
    database.execute('deleteAll');
    database.close();
    database = openNotificationDatabase(filename, [item]);
    expect(database.all()).toEqual([]);
});

test('failed imports roll back every record and can be retried with the original JSON', () => {
    expect(() => openNotificationDatabase(filename, [item, {...item}])).toThrow();
    database = openNotificationDatabase(filename, [{...item, id: 'replacement'}]);
    expect(database.all().map(record => record.id)).toEqual(['replacement']);
});

test('persists added records, updates read flags, and deletes only the requested record', () => {
    database = openNotificationDatabase(filename, [item]);
    const second = {...item, id: 'two', title: 'Second'};
    expect(database.execute('add', second).notifications).toEqual([item, second]);
    expect(database.execute('readAll').notifications.every(record => record.read)).toBe(true);
    expect(database.execute('readAll').changed).toBe(false);
    expect(database.execute('delete', 'missing').changed).toBe(false);
    expect(database.execute('delete', 'one').notifications.map(record => record.id)).toEqual(['two']);
});

test('keeps notification text encrypted in the database and journal', () => {
    database = openNotificationDatabase(filename, [item]);
    for (const file of fs.readdirSync(directory)) {
        const bytes = fs.readFileSync(path.join(directory, file));
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
