const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openChatDatabase: openDatabase} = require('../../src/utils/persistence/chatDatabase.cjs');
const openChatDatabase = (filename, records = []) => {
    const db = openDatabase(filename);
    for (const record of records) db.execute('put', record);
    return db;
};

const now = '2026-10-16T10:00:00Z';
const message = (id, content = 'Private message content') => ({id, role: 'user', content, createdAt: now,
    replyTo: {id: 'reply', role: 'assistant', content: 'Previous answer'}, attachments: [{type: 'file', path: '/tmp/attachment'}]});
const session = (id, messages = [message('one'), message('two')]) => ({id, name: 'Private session name', createdAt: now,
    updatedAt: now, messages, memory: {preferences: {preferredLanguage: 'uk'}}, routing: {activeRoute: 'fdo'}});
let directory, filename, database;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-chat-db-')); filename = path.join(directory, 'chat.sqlite'); });
afterEach(() => { database?.close(); database = null; fs.rmSync(directory, {recursive: true, force: true}); });
const rows = () => {
    const connection = new DatabaseSync(filename);
    try { return connection.prepare(/* language=TEXT */ 'SELECT sessionId,id,payload FROM messages ORDER BY sessionId,id').all()
        .map(row => ({...row, payload: Buffer.from(row.payload).toString('hex')})); }
    finally { connection.close(); }
};

test('preserves message details and subsequent edits across reopen', () => {
    const records = [session('first')];
    database = openChatDatabase(filename, records);
    expect(database.execute('get', 'first')).toEqual(records[0]);
    database.execute('rename', {id: 'first', name: 'Renamed', updatedAt: now});
    database.close();
    database = openChatDatabase(filename);
    expect(database.execute('get', 'first').name).toBe('Renamed');
});

test('updates individual messages without rewriting other messages or conversations', () => {
    database = openChatDatabase(filename, [session('first'), session('second')]);
    const before = rows();
    database.execute('put', session('first', [message('one', 'Updated'), message('two'), message('three')]));
    const after = rows();
    for (const previous of before.filter(row => row.sessionId === 'second' || row.id === 'two')) {
        expect(after.find(row => row.sessionId === previous.sessionId && row.id === previous.id)).toEqual(previous);
    }
    expect(after.find(row => row.sessionId === 'first' && row.id === 'one').payload).not.toBe(before[0].payload);
    database.execute('put', session('first', [message('three'), message('two')]));
    expect(database.execute('get', 'first').messages.map(item => item.id)).toEqual(['three', 'two']);
    expect(database.execute('get', 'second')).toEqual(session('second'));
});

test('renaming and listing preserve encrypted message rows', () => {
    database = openChatDatabase(filename, [session('first')]);
    const before = rows();
    database.execute('rename', {id: 'first', name: 'New name', updatedAt: now});
    database.execute('list');
    expect(rows()).toEqual(before);
});

test('orders sessions by actual recency across valid timestamp offsets', () => {
    database = openChatDatabase(filename, [
        {...session('older'), updatedAt: '2026-10-16T12:00:00+02:00'},
        {...session('newer'), updatedAt: '2026-10-16T10:30:00Z'},
    ]);
    expect(database.execute('list').map(item => item.id)).toEqual(['newer', 'older']);
});

test('keeps one empty draft and reuses it atomically while preserving populated conversations', () => {
    database = openChatDatabase(filename, [session('populated'), session('old', []), {...session('new', []), updatedAt: '2026-10-16T11:00:00Z'}]);
    expect(database.execute('create', {...session('unused', []), name: 'Requested draft'}).id).toBe('new');
    expect(database.execute('get', 'new').name).toBe('Requested draft');
    expect(database.execute('get', 'old')).toBeNull();
    expect(database.execute('list')).toHaveLength(2);
});

test('encrypts history on disk and rejects invalid updates without losing stored messages', () => {
    database = openChatDatabase(filename, [session('first')]);
    expect(() => database.execute('put', session('first', [message('duplicate'), message('duplicate')]))).toThrow('Invalid chat message');
    expect(database.execute('get', 'first')).toEqual(session('first'));
    for (const name of fs.readdirSync(directory)) {
        const data = fs.readFileSync(path.join(directory, name));
        expect(data.includes(Buffer.from('Private session name'))).toBe(false);
        expect(data.includes(Buffer.from('Private message content'))).toBe(false);
    }
});

test('lightweight summaries contain counts and current metadata without loading message payloads', () => {
    database = openChatDatabase(filename, [session('first'), {...session('second', [message('other')]), updatedAt: '2026-10-16T11:00:00Z'}]);
    // A damaged message must affect only opening its conversation, not browsing
    // the picker. This also proves summaries never decrypt message rows.
    const connection = new DatabaseSync(filename);
    try { connection.prepare(/* language=TEXT */ 'UPDATE messages SET payload = ? WHERE sessionId = ?').run(Buffer.from('invalid'), 'first'); }
    finally { connection.close(); }
    expect(database.execute('summaries')).toEqual([
        {id: 'second', name: 'Private session name', createdAt: now, updatedAt: '2026-10-16T11:00:00Z', messageCount: 1},
        {id: 'first', name: 'Private session name', createdAt: now, updatedAt: now, messageCount: 2},
    ]);
    expect(database.execute('get', 'second')).toEqual({...session('second', [message('other')]), updatedAt: '2026-10-16T11:00:00Z'});
    expect(() => database.execute('get', 'first')).toThrow();
});

test('summaries reflect writes, renames and draft pruning without stale counts', () => {
    database = openChatDatabase(filename, [session('first'), session('empty-old', []), {...session('empty-new', []), updatedAt: '2026-10-16T11:00:00Z'}]);
    expect(database.execute('summaries').map(item => item.id)).toEqual(['empty-new', 'first']);
    database.execute('put', session('first', [message('only')]));
    database.execute('rename', {id: 'first', name: 'Latest title', updatedAt: '2026-10-16T12:00:00Z'});
    expect(database.execute('summaries')[0]).toEqual({id: 'first', name: 'Latest title', createdAt: now, updatedAt: '2026-10-16T12:00:00Z', messageCount: 1});
    database.close();
    database = openChatDatabase(filename);
    expect(database.execute('summaries')[0]).toMatchObject({id: 'first', name: 'Latest title', messageCount: 1});
});
