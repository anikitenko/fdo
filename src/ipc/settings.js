import {ipcMain} from "electron";
import {SettingsChannels} from "./channels";
import {settings} from "../utils/store";
import {Certs} from "../utils/certs";

export function registerSettingsHandlers() {
    ipcMain.handle(SettingsChannels.certificates.GET_ROOT, async () => {
        return settings.get('certificates.root') || [];
    });

    ipcMain.handle(SettingsChannels.certificates.CREATE, async () => {
        const randomName = (Math.random() + 1).toString(36).substring(2)
        Certs.generateRootCA(randomName);
    });

    ipcMain.handle(SettingsChannels.certificates.RENAME, async (event, oldName, newName) => {
        if (newName) {
            Certs.setLabel(oldName, newName);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.EXPORT, async (event, id) => {
        if (id) {
            const data = Certs.export(id);
            return data.cert
        }
    });

    ipcMain.handle(SettingsChannels.certificates.IMPORT, async (event, file) => {
        if (file) {
            return await Certs.import(file);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.DELETE, async (event, id) => {
        if (id) {
            const roots = settings.get('certificates.root') || [];
            const newRoots = roots.filter((root) => root.id !== id);
            settings.set('certificates.root', newRoots);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.RENEW, async (event, label) => {
        Certs.generateRootCA(label, true);
    });
}