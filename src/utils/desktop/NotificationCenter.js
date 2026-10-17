import {v4 as uuidv4} from 'uuid';
import {createHash} from 'node:crypto';
import {NotificationChannels} from '../../ipc/channels';
import {webContents} from 'electron';
import {notificationStorage} from '../persistence/notificationStorage';
import {settings} from '../persistence/store';
import {notificationMetadata, notificationPreferences, shouldAlert} from './notificationModel';
import {diagnosticText} from './notificationContent';

function broadcast(channel, value) {
    for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed()) continue;
        try {wc.send(channel, value);}
        catch (error) {if (!wc.isDestroyed()) console.error('Notification delivery failed:', error);}
    }
}

function observe(promise) {
    // Lifecycle emitters can fire and forget; IPC callers still receive errors.
    promise.catch(error => console.error('Notification persistence failed:', error));
    return promise;
}

function mutate(operation, value) {
    return observe(notificationStorage(operation, value).then(result => {
        if (result.changed) {
            broadcast(NotificationChannels.on_off.UPDATED, result.notifications);
        }
        return result;
    }));
}

export const NotificationCenter = {
    async getAllNotifications() {
        const {retentionDays} = this.getPreferences();
        await mutate('prune', retentionDays);
        return notificationStorage('all');
    },
    getPreferences() {return notificationPreferences(settings.get('notificationPreferences', {}));},
    async savePreferences(value) {
        const preferences = notificationPreferences(value);
        settings.set('notificationPreferences', preferences);
        await mutate('prune', preferences.retentionDays);
        broadcast(NotificationChannels.on_off.PREFERENCES, preferences);
        return preferences;
    },
    addNotification({title, message = '', type = '', ...metadata}) {
        const now = new Date().toISOString();
        const notification = {id: uuidv4(), title: diagnosticText(title || 'FDO activity').slice(0, 240), message: diagnosticText(message), type: type === 'info' ? 'primary' : type,
            ...notificationMetadata({title, ...metadata}),
            read: false, createdAt: now, updatedAt: now};
        if (notification.details) notification.details = diagnosticText(notification.details);
        if (!notification.groupKey && ['warning', 'danger'].includes(notification.type)) {
            notification.groupKey = `repeat:${notification.source}:${createHash('sha256').update(`${notification.title}\0${notification.message}`).digest('hex')}`;
        }
        const result = mutate(notification.groupKey ? 'publish' : 'add', notification).then(async result => {
            const saved = result.notification || notification;
            const preferences = this.getPreferences();
            if (result.changed && result.alert !== false && shouldAlert(saved, preferences)) broadcast(NotificationChannels.on_off.ALERT, saved);
            await mutate('prune', preferences.retentionDays);
            return result.changed ? saved : null;
        });
        // mutate already reports the error; observe the derived promise too.
        result.catch(() => {});
        return result;
    },
    markAsRead(id) { return mutate('read', id); },
    markAsUnread(id) { return mutate('unread', id); },
    markAllAsRead() { return mutate('readAll'); },
    deleteNotification(id) { return mutate('delete', id); },
    deleteAllNotifications() { return mutate('deleteAll'); },
    async dismiss(id) {
        const undoToken = uuidv4();
        const result = await mutate('dismiss', {id, token: undoToken});
        return {success: true, undoToken: result.changed ? undoToken : null};
    },
    async undo(token) {const result = await mutate('undo', token); return {success: result.changed};},
};
