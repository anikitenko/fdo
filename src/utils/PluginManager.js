import UserORM from "./UserORM";
import fork from "child_process";
import PluginORM from "./PluginORM";

export default class PluginManager {
    constructor(mainWindow, pluginConfigFile, userConfigFile) {
        this.mainWindow = mainWindow;
        this.userConfigFile = userConfigFile;
        this.pluginConfigFile = pluginConfigFile;
        this.loadedPlugins = {};
        this.loadPlugins();
    }

    loadPlugins() {
        const userORM = new UserORM(this.userConfigFile);
        const plugins = userORM.getActivatedPlugins();
        for(const id of plugins) {
            this.loadPlugin(id)
        }
    }

    loadPlugin(id) {
        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);
        this.loadedPlugins[id] = fork(plugin.path);
        this.sendPluginToRenderer(id);
    }

    unLoadPlugins() {
        for(const id in this.loadedPlugins) {
            this.unLoadPlugin(id);
        }
    }

    unLoadPlugin(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id].kill();
            delete this.loadedPlugins[id];
            this.sendUnloadToRenderer(id);
        }
    }

    sendPluginToRenderer(id) {
        this.mainWindow.webContents.send("plugin-loaded", id);
    }

    sendUnloadToRenderer(id) {
        this.mainWindow.webContents.send("plugin-unloaded", id);
    }
}
