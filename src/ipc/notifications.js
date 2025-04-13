import { ipcMain } from 'electron';
import {NotificationCenter} from "../utils/NotificationCenter";
import {NotificationChannels} from "./channels";

export function registerNotificationHandlers() {
    ipcMain.handle(NotificationChannels.GET_ALL, () => {
        return NotificationCenter.getAllNotifications();
    });

    ipcMain.handle(NotificationChannels.ADD, (event, title, body, type = 'info') => {
        return NotificationCenter.addNotification({
            title,
            message: body,
            type
        });
    });

    ipcMain.handle(NotificationChannels.MARK_AS_READ, (event, id) => {
        NotificationCenter.markAsRead(id);
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.MARK_ALL_AS_READ, () => {
        NotificationCenter.markAllAsRead();
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.REMOVE, (event, id) => {
        NotificationCenter.deleteNotification(id);
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.REMOVE_ALL, () => {
        NotificationCenter.deleteAllNotifications();
        return { success: true };
    });
}
