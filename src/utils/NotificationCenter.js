import { settings } from './store';
import { v4 as uuidv4 } from 'uuid';

export const NotificationCenter = {
    getAllNotifications() {
        return settings.get('notifications') || [];
    },

    addNotification({ title, message, type = 'info' }) {
        const now = new Date().toISOString();
        const notification = {
            id: uuidv4(),
            title,
            message,
            type,
            read: false,
            createdAt: now,
            updatedAt: now
        };

        const notifications = NotificationCenter.getAllNotifications();
        notifications.push(notification);
        settings.set('notifications', notifications);

        return notification;
    },

    markAsRead(notificationId) {
        const notifications = NotificationCenter.getAllNotifications().map(n =>
            n.id === notificationId
                ? { ...n, read: true, updatedAt: new Date().toISOString() }
                : n
        );
        settings.set('notifications', notifications);
    },

    markAllAsRead() {
        const now = new Date().toISOString();
        const notifications = NotificationCenter.getAllNotifications().map(n =>
            n.read ? n : { ...n, read: true, updatedAt: now }
        );
        settings.set('notifications', notifications);
    },

    deleteNotification(notificationId) {
        const filtered = NotificationCenter.getAllNotifications().filter(n => n.id !== notificationId);
        settings.set('notifications', filtered);
    },

    deleteAllNotifications() {
        settings.set('notifications', []);
    }
};
