/** @jest-environment node */
const {afterEach, beforeAll, beforeEach, expect, jest: jestMock, test} = require('@jest/globals');
const {Buffer} = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {openCertificateDatabase} = require('../../src/utils/persistence/certificateDatabase.cjs');
const {certificateFixture} = require('../helpers/certificateFixture.cjs');

let root, directory, filename, database, protection;
beforeAll(async () => {root = await certificateFixture();});
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-certificate-db-'));
    filename = path.join(directory, 'certificates.sqlite');
    const key = Buffer.from(crypto.randomBytes(32));
    protection = {
        encrypt(value) {
            const iv = Buffer.from(crypto.randomBytes(12));
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {authTagLength: 16});
            const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
        },
        /** @param {Buffer} value */
        decrypt(value) {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12), {authTagLength: 16});
            decipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
        },
    };
    database = openCertificateDatabase(filename, protection);
});
afterEach(() => {database.close(); fs.rmSync(directory, {recursive: true, force: true});});

test('private keys are encrypted on disk and excluded from lists; metadata updates preserve encrypted bytes', () => {
    database.put(root);
    expect(database.list()).toEqual([{...root, key: undefined, scope: 'root', hasPrivateKey: true}]);
    expect(database.privateKey(root.id)).toBe(root.key);
    const inspection = new DatabaseSync(filename);
    const bytes = Buffer.from(inspection.prepare(/* language=SQLite */ 'SELECT privateKey FROM certificates').get().privateKey);
    expect(bytes.includes(Buffer.from('PRIVATE KEY'))).toBe(false);
    database.update(root.id, {label: 'Renamed', lastUsedAt: '2026-10-17T10:00:00Z'});
    expect(Buffer.from(inspection.prepare(/* language=SQLite */ 'SELECT privateKey FROM certificates').get().privateKey)).toEqual(bytes);
    inspection.close();
    for (const file of fs.readdirSync(directory)) expect(Buffer.from(fs.readFileSync(path.join(directory, file))).includes(Buffer.from(root.key))).toBe(false);
    database.close(); database = openCertificateDatabase(filename, protection);
    expect(database.list('root')[0].label).toBe('Renamed');
    expect(database.privateKey(root.id)).toBe(root.key);
});

test('migrates all trust scopes, preserves identities and chains, and removes JSON only after verification', () => {
    const {key, ...publicRoot} = root;
    let legacy = {root: [root], org: [{...publicRoot, chain: [root.cert]}], registry: [publicRoot]};
    const settings = {get: () => legacy, delete: jestMock.fn(setting => {
        expect(setting).toBe('certificates');
        expect(database.privateKey(root.id)).toBe(key);
        legacy = undefined;
    })};
    database.migrate(settings);
    expect(settings.delete).toHaveBeenCalledTimes(1);
    expect(database.list()).toHaveLength(3);
    expect(database.list('org')[0]).toMatchObject({chain: [root.cert], hasPrivateKey: false});
    expect(database.privateKey(root.id, 'org')).toBeNull();
    database.migrate(settings);
    expect(database.list()).toHaveLength(3);
});

test('failed encryption rolls back the entire migration and retains the original records for retry', () => {
    const {key, ...publicRoot} = root;
    const legacy = {root: [publicRoot, {...root, id: 'second'}]};
    const settings = {get: () => legacy, delete: jestMock.fn()};
    const encrypt = protection.encrypt;
    protection.encrypt = () => {throw new Error('Keychain locked');};
    expect(() => database.migrate(settings)).toThrow('Keychain locked');
    expect(database.list()).toEqual([]);
    expect(settings.delete).not.toHaveBeenCalled();
    protection.encrypt = encrypt;
    database.migrate(settings);
    expect(database.list()).toHaveLength(2);
});

test('retries safely when settings cleanup fails after the SQLite commit', () => {
    let legacy = {root: [root]};
    const settings = {get: () => legacy, delete: jestMock.fn()
        .mockImplementationOnce(() => {throw new Error('Settings temporarily unavailable');})
        .mockImplementation(() => {legacy = undefined;})};
    expect(() => database.migrate(settings)).toThrow('Settings temporarily unavailable');
    expect(legacy.root[0]).toBe(root);
    database.close(); database = openCertificateDatabase(filename, protection);
    database.migrate(settings);
    expect(database.list()).toHaveLength(1);
    expect(database.privateKey(root.id)).toBe(root.key);
    expect(legacy).toBeUndefined();
});

test('rejects mismatched keys, detects altered ciphertext, and preserves an existing identity on failed renewal', async () => {
    database.put(root);
    const other = await certificateFixture('renewed');
    expect(() => database.put({...other, key: root.key}, 'root', root.id)).toThrow('match');
    expect(database.list('root')[0].id).toBe(root.id);
    const inspection = new DatabaseSync(filename);
    inspection.prepare(/* language=SQLite */ 'UPDATE certificates SET privateKey = ? WHERE scope = ? AND id = ?')
        .run(crypto.randomBytes(80), 'root', root.id);
    inspection.close();
    expect(() => database.privateKey(root.id)).toThrow();
    // Trust lists remain readable without decrypting a damaged or locked signing key.
    expect(database.list('root')[0].id).toBe(root.id);
    database.put(other, 'root', root.id);
    expect(database.list('root').map(entry => entry.id)).toEqual([other.id]);
    database.remove(other.id);
    expect(database.list()).toEqual([]);
});
