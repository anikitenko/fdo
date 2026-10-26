import {NotificationCenter, watchNotificationMenuBadge} from '../../src/utils/desktop/NotificationCenter';
import {notificationStorage} from '../../src/utils/persistence/notificationStorage';
import {webContents} from 'electron';

jest.mock('../../src/utils/persistence/notificationStorage', () => ({notificationStorage: jest.fn()}));
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(() => ({})), set: jest.fn()}}));
jest.mock('electron', () => ({webContents: {getAllWebContents: jest.fn()}}));
beforeEach(() => jest.clearAllMocks());

test('broadcasts only after the database write commits', async () => {
    let finish;
    notificationStorage.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const send = jest.fn();
    webContents.getAllWebContents.mockReturnValue([{send, isDestroyed: () => false}]);
    const request = NotificationCenter.markAsRead('one');
    expect(send).not.toHaveBeenCalled();
    const notifications = [{id: 'one', read: true}];
    finish({changed: true, notifications});
    await request;
    expect(notificationStorage).toHaveBeenCalledWith('read', 'one');
    expect(send).toHaveBeenCalledWith('notifications:on_off:updated', notifications);
});

test('tells the menu badge watcher about the saved notification list', async () => {
    const seen = [];
    const stop = watchNotificationMenuBadge(list => seen.push(list));
    notificationStorage.mockResolvedValue({changed: true, notifications: [{id: 'one', read: false}]});
    await NotificationCenter.markAsRead('one');
    stop();
    expect(seen).toEqual([[{id: 'one', read: false}]]);
});

test.each(['markAsRead', 'markAllAsRead', 'deleteNotification', 'deleteAllNotifications'])('%s does not broadcast unchanged data', async method => {
    notificationStorage.mockResolvedValue({changed: false, notifications: null});
    await NotificationCenter[method]('missing');
    expect(webContents.getAllWebContents).not.toHaveBeenCalled();
});

test('returns persistence errors to callers without broadcasting success', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        notificationStorage.mockRejectedValue(new Error('Disk full'));
        await expect(NotificationCenter.markAsRead('one')).rejects.toThrow('Disk full');
        expect(webContents.getAllWebContents).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
});

test('a closing window does not prevent delivery to other windows after commit', async () => {
    notificationStorage.mockResolvedValue({changed: true, notifications: []});
    const send = jest.fn();
    let destroyed = false;
    webContents.getAllWebContents.mockReturnValue([
        {isDestroyed: () => destroyed, send: () => { destroyed = true; throw new Error('Window closed'); }},
        {isDestroyed: () => false, send},
    ]);
    await expect(NotificationCenter.deleteAllNotifications()).resolves.toMatchObject({changed: true});
    expect(send).toHaveBeenCalledWith('notifications:on_off:updated', []);
});

test('persists events before alerting and applies source and severity preferences without losing history', async () => {
    const {settings} = require('../../src/utils/persistence/store');
    const send = jest.fn();
    webContents.getAllWebContents.mockReturnValue([{send, isDestroyed: () => false}]);
    notificationStorage.mockImplementation(async (operation, value) => ({changed: true, notifications: [value]}));
    settings.get.mockReturnValue({successToasts: false});
    await NotificationCenter.addNotification({title: 'Updated', source: 'gitops', type: 'success'});
    expect(send.mock.calls.filter(([channel]) => channel.endsWith(':alert'))).toHaveLength(0);
    expect(notificationStorage).toHaveBeenCalledWith('add', expect.objectContaining({source: 'gitops', title: 'Updated'}));
    settings.get.mockReturnValue({failureToasts: true});
    await NotificationCenter.addNotification({title: 'Failed', source: 'gitops', type: 'danger', groupKey: 'incident'});
    expect(send.mock.calls.filter(([channel]) => channel.endsWith(':alert'))).toHaveLength(1);
    settings.get.mockReturnValue({mutedSources: ['gitops']});
    await NotificationCenter.addNotification({title: 'Failed', source: 'gitops', type: 'danger', groupKey: 'incident'});
    expect(send.mock.calls.filter(([channel]) => channel.endsWith(':alert'))).toHaveLength(1);
});

test('only the first failure in a group alerts, and recovery without an incident is silent', async () => {
    const {settings} = require('../../src/utils/persistence/store');
    settings.get.mockReturnValue({});
    const send = jest.fn();
    webContents.getAllWebContents.mockReturnValue([{send, isDestroyed: () => false}]);
    notificationStorage.mockResolvedValue({changed: true, notifications: [], notification: {source: 'gitops', type: 'danger'}, alert: false});
    await NotificationCenter.addNotification({title: 'Failure', type: 'danger', groupKey: 'incident'});
    expect(send.mock.calls.filter(([channel]) => channel.endsWith(':alert'))).toHaveLength(0);
    notificationStorage.mockResolvedValue({changed: false, notifications: null});
    expect(await NotificationCenter.addNotification({title: 'Recovered', type: 'success', groupKey: 'incident', status: 'resolved'})).toBeNull();
});
