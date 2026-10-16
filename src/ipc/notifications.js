import { ipcMain } from 'electron';
import {NotificationCenter} from "../utils/desktop/NotificationCenter";
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

    ipcMain.handle(NotificationChannels.MARK_AS_READ, async (event, id) => {
        await NotificationCenter.markAsRead(id);
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.MARK_ALL_AS_READ, async () => {
        await NotificationCenter.markAllAsRead();
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.REMOVE, async (event, id) => {
        await NotificationCenter.deleteNotification(id);
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.REMOVE_ALL, async () => {
        await NotificationCenter.deleteAllNotifications();
        return { success: true };
    });
}
