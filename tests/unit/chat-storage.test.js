jest.mock('../../src/utils/desktop/backgroundNotifications', () => ({createIncidentReporter: () => ({fail: jest.fn(), recover: jest.fn()})}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {path: '/tmp/fdo-test/settings.json'}}));
jest.mock('../../src/utils/persistence/storageWorkerClient', () => ({createStorageWorker: jest.fn()}));

test('chat operations use only the SQLite worker and never read JSON history', async () => {
    const client = {request: jest.fn(async () => true), close: jest.fn(async () => {})};
    const {createStorageWorker} = require('../../src/utils/persistence/storageWorkerClient');
    createStorageWorker.mockReturnValue(client);
    const {chatStorage, closeChatStorage} = require('../../src/utils/persistence/chatStorage');
    expect(createStorageWorker.mock.calls[0][2]()).toEqual({filename: '/tmp/fdo-test/chat-history.sqlite'});
    await chatStorage.ready(); await chatStorage.get('conversation');
    expect(client.request).toHaveBeenCalledWith('ready');
    expect(client.request).toHaveBeenCalledWith('get', 'conversation');
    await closeChatStorage(); expect(client.close).toHaveBeenCalledTimes(1);
});
