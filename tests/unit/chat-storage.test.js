jest.mock('node:fs', () => ({...jest.requireActual('node:fs'), copyFileSync: jest.fn(), chmodSync: jest.fn()}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {path: '/tmp/fdo-test/settings.json', get: jest.fn(), delete: jest.fn()}}));
jest.mock('../../src/utils/persistence/storageWorkerClient', () => ({createStorageWorker: jest.fn()}));

let storage, client, settings, fs;
beforeEach(() => {
    jest.resetModules();
    fs = require('node:fs');
    settings = require('../../src/utils/persistence/store').settings;
    settings.get.mockReturnValue([{id: 'legacy'}]);
    client = {request: jest.fn().mockResolvedValue(true), close: jest.fn().mockResolvedValue()};
    require('../../src/utils/persistence/storageWorkerClient').createStorageWorker.mockReturnValue(client);
    storage = require('../../src/utils/persistence/chatStorage');
});

test('waits for migration commit and backup before removing active JSON history', async () => {
    let finish;
    client.request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const request = storage.chatStorage.get('legacy');
    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(settings.delete).not.toHaveBeenCalled();
    finish(true);
    await request;
    expect(fs.copyFileSync).toHaveBeenCalledWith(settings.path, expect.stringContaining('settings-before-chat-sqlite.json'), fs.constants.COPYFILE_EXCL);
    expect(fs.copyFileSync.mock.invocationCallOrder[0]).toBeLessThan(settings.delete.mock.invocationCallOrder[0]);
    expect(settings.delete).toHaveBeenCalledWith('ai.sessions');
    expect(client.request).toHaveBeenLastCalledWith('get', 'legacy');
});

test('failed imports preserve the JSON and still allow orderly worker shutdown', async () => {
    client.request.mockRejectedValue(new Error('Import failed'));
    await expect(storage.chatStorage.list()).rejects.toThrow('Import failed');
    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(settings.delete).not.toHaveBeenCalled();
    await expect(storage.closeChatStorage()).rejects.toThrow('Import failed');
    expect(client.close).toHaveBeenCalledTimes(1);
});

test('failed backups never remove the source history or start chat writes', async () => {
    fs.copyFileSync.mockImplementation(() => { throw Object.assign(new Error('Disk full'), {code: 'ENOSPC'}); });
    await expect(storage.chatStorage.put({id: 'new'})).rejects.toThrow('Disk full');
    expect(settings.delete).not.toHaveBeenCalled();
    expect(client.request).toHaveBeenCalledTimes(1);
});

test('preserves an existing encrypted backup without overwriting or changing its permissions', async () => {
    fs.copyFileSync.mockImplementation(() => { throw Object.assign(new Error('Exists'), {code: 'EEXIST'}); });
    await storage.chatStorage.list();
    expect(fs.chmodSync).not.toHaveBeenCalled();
    expect(settings.delete).toHaveBeenCalledWith('ai.sessions');
});
