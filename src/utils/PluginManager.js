import UserORM from "./UserORM";
import {utilityProcess} from "electron";
import PluginORM from "./PluginORM";

const PluginManager = {
    mainWindow: null,
    userConfigFile: "",
    pluginConfigFile: "",
    loadedPlugins: {},
    loadingPlugins: {},
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    },
    setUserConfigFile(userConfigFile) {
        this.userConfigFile = userConfigFile;
    },
    setPluginsRegistryFile(pluginConfigFile) {
        this.pluginConfigFile = pluginConfigFile;
    },
    loadPlugins() {
        const userORM = new UserORM(this.userConfigFile);
        const plugins = userORM.getActivatedPlugins();
        for(const id of plugins) {
            this.loadPlugin(id)
        }
    },
    loadPlugin(id) {
        if (this.loadingPlugins?.[id]) {
            console.warn(`Plugin ${id} is already loading.`);
            return; // Prevent double execution
        }

        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPlugins[id] = true;

        this.unLoadPlugin(id)

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);
        const child = utilityProcess.fork(plugin.path, [], {serviceName: `plugin-${id}`})

        child.on('spawn', () => {
            this.loadedPlugins[id] = child;
            console.log(`Plugin ${id} loaded with PID ${child.pid}`);
            this.sendPluginToRenderer(id);
            delete this.loadingPlugins[id];
        })

        child.on('error', () => {
            console.error(`Error loading plugin ${id}`);
            delete this.loadingPlugins[id]; // Ensure cleanup on failure
        });
    },
    unLoadPlugins() {
        for(const id in this.loadedPlugins) {
            this.unLoadPlugin(id);
        }
    },
    unLoadPlugin(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id].kill();
            delete this.loadedPlugins[id];
            this.sendUnloadToRenderer(id);
        }
    },
    sendPluginToRenderer(id) {
        this.mainWindow.webContents.send("plugin-loaded", id);
    },
    sendUnloadToRenderer(id) {
        this.mainWindow.webContents.send("plugin-unloaded", id);
    }
}

export default PluginManager
