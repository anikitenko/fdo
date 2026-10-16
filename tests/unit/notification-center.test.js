import {NotificationCenter} from '../../src/utils/desktop/NotificationCenter';
import {notificationStorage} from '../../src/utils/persistence/notificationStorage';
import {webContents} from 'electron';

jest.mock('../../src/utils/persistence/notificationStorage', () => ({notificationStorage: jest.fn()}));
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
