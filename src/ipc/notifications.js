import { ipcMain } from 'electron';
import {NotificationCenter} from "../utils/desktop/NotificationCenter";
import {NotificationChannels} from "./channels";

export function registerNotificationHandlers() {
    ipcMain.handle(NotificationChannels.GET_ALL, () => {
        return NotificationCenter.getAllNotifications();
    });

    ipcMain.handle(NotificationChannels.ADD, (event, title, body, type = 'info', metadata = {}) => {
        return NotificationCenter.addNotification({
            ...metadata,
            title,
            message: body,
            type
        });
    });
    ipcMain.handle(NotificationChannels.MARK_AS_UNREAD, (_, id) => NotificationCenter.markAsUnread(id));
    ipcMain.handle(NotificationChannels.UNDO, (_, token) => NotificationCenter.undo(token));
    ipcMain.handle(NotificationChannels.GET_PREFERENCES, () => NotificationCenter.getPreferences());
    ipcMain.handle(NotificationChannels.SAVE_PREFERENCES, (_, value) => NotificationCenter.savePreferences(value));

    ipcMain.handle(NotificationChannels.MARK_AS_READ, async (event, id) => {
        await NotificationCenter.markAsRead(id);
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.MARK_ALL_AS_READ, async () => {
        await NotificationCenter.markAllAsRead();
        return { success: true };
    });

    ipcMain.handle(NotificationChannels.REMOVE, async (event, id) => {
        return NotificationCenter.dismiss(id);
    });

    ipcMain.handle(NotificationChannels.REMOVE_ALL, async () => {
        return NotificationCenter.dismiss();
    });
}
