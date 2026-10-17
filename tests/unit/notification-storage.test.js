jest.mock('../../src/utils/persistence/store', () => ({settings: {path: '/tmp/fdo-test/settings.json'}}));
jest.mock('../../src/utils/persistence/storageWorkerClient', () => ({createStorageWorker: jest.fn()}));

test('notification operations use only the SQLite worker and never read JSON history', async () => {
    const client = {request: jest.fn(async () => []), close: jest.fn(async () => {})};
    const {createStorageWorker} = require('../../src/utils/persistence/storageWorkerClient');
    createStorageWorker.mockReturnValue(client);
    const {notificationStorage, closeNotificationStorage} = require('../../src/utils/persistence/notificationStorage');
    expect(createStorageWorker.mock.calls[0][2]()).toEqual({filename: '/tmp/fdo-test/notifications.sqlite'});
    await notificationStorage('all'); expect(client.request).toHaveBeenCalledWith('all');
    await closeNotificationStorage(); expect(client.close).toHaveBeenCalledTimes(1);
});
