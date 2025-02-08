import {ipcMain} from "electron";
import PluginORM from "./PluginORM";
import fork from "child_process";

export default class PluginManager {
    constructor(mainWindow, pluginsORMpath) {
        this.mainWindow = mainWindow;
        this.pluginsORMpath = pluginsORMpath;
        this.loadedPlugin = {};

        ipcMain.on("load-plugin", (even, id) => {
            this.loadPlugin(id)
            this.sendPluginToRenderer(id);
        });
    }

    loadPlugin(id) {
        const pluginORM = new PluginORM(this.pluginsORMpath);
        const plugin = pluginORM.getPlugin(id)
        const pluginProcess = fork(plugin.path)
        pluginProcess.on("message", (msg) => {
            console.log("Plugin Message:", msg);
        });
        this.loadedPlugin = {id: id, process: pluginProcess};
    }

    sendPluginToRenderer() {
        if (this.mainWindow) {
            this.mainWindow.webContents.send("plugin-loaded", {
                id: this.loadedPlugin.id,
                pid: this.loadedPlugin.process.pid, // Only sending the process ID
            });
        }
    }
}
