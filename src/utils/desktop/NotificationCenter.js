import {v4 as uuidv4} from 'uuid';
import {NotificationChannels} from '../../ipc/channels';
import {webContents} from 'electron';
import {notificationStorage} from '../persistence/notificationStorage';

function observe(promise) {
    // Lifecycle emitters can fire and forget; IPC callers still receive errors.
    promise.catch(error => console.error('Notification persistence failed:', error));
    return promise;
}

function mutate(operation, value) {
    return observe(notificationStorage(operation, value).then(result => {
        if (result.changed) {
            for (const wc of webContents.getAllWebContents()) {
                if (wc.isDestroyed()) continue;
                try { wc.send(NotificationChannels.on_off.UPDATED, result.notifications); }
                catch (error) {
                    // A closing window must not turn a committed write into an
                    // apparent persistence failure or prevent other deliveries.
                    if (!wc.isDestroyed()) console.error('Notification delivery failed:', error);
                }
            }
        }
        return result;
    }));
}

export const NotificationCenter = {
    getAllNotifications() { return notificationStorage('all'); },
    addNotification({title, message = '', type = ''}) {
        const now = new Date().toISOString();
        const notification = {id: uuidv4(), title: String(title), message: String(message), type: type === 'info' ? 'primary' : type,
            read: false, createdAt: now, updatedAt: now};
        const result = mutate('add', notification).then(() => notification);
        // mutate already reports the error; observe the derived promise too.
        result.catch(() => {});
        return result;
    },
    markAsRead(id) { return mutate('read', id); },
    markAllAsRead() { return mutate('readAll'); },
    deleteNotification(id) { return mutate('delete', id); },
    deleteAllNotifications() { return mutate('deleteAll'); },
};
