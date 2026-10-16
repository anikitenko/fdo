import path from 'node:path';
import {settings} from './store';
import {createStorageWorker} from './storageWorkerClient';

const client = createStorageWorker('Notification', 'notificationWorker.cjs', () => ({
    filename: path.join(path.dirname(settings.path), 'notifications.sqlite'),
    legacy: settings.get('notifications', []),
}));
export const notificationStorage = client.request;
export const closeNotificationStorage = client.close;
