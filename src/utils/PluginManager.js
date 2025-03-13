import UserORM from "./UserORM";
import {utilityProcess} from "electron";
import PluginORM from "./PluginORM";
import path from "node:path";

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
        if (this.loadingPlugins[id]) {
            console.warn(`Plugin ${id} is already loading.`);
            return; // Prevent double execution
        }

        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPlugins[id] = true;

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);
        const child = utilityProcess.fork(plugin.entry, [], {
            serviceName: `plugin-${id}`,
            cwd: plugin.home,
            env: {
                PLUGIN_HOME: plugin.home,
                LOG_LEVEL: "info",
                ...process.env,
            },
        })

        child.on('spawn', () => {
            delete this.loadingPlugins[id];
            this.loadedPlugins[id] = {
                instance: child,
                ready: false
            };
            child.postMessage({message: 'PLUGIN_READY'})
            // Handle messages from the plugin
            child.once('message', (message) => {
                if (message.type === 'PLUGIN_READY') {
                    this.setPluginReady(id)
                    this.sendReadyToRenderer(id)
                }
            });
        })

        child.on('error', () => {
            console.log(`Plugin ${id} encountered an error. Exiting...`)
            delete this.loadingPlugins[id];
            this.sendUnloadToRenderer(id);
        })

        child.on('exit', () => {
            console.log(`Plugin ${id} exited`)
            delete this.loadingPlugins[id];
            this.sendUnloadToRenderer(id);
        })
    },
    setPluginReady(id) {
        this.loadedPlugins[id].ready = true;
    },
    getLoadedPlugin(id) {
        return this.loadedPlugins[id];
    },
    getLoadedPluginInstance(id) {
        return this.loadedPlugins[id].instance;
    },
    getLoadedPluginReady(id) {
        return this.loadedPlugins[id].ready;
    },
    unLoadPlugins() {
        for(const id in this.loadedPlugins) {
            this.unLoadPlugin(id);
        }
    },
    unLoadPlugin(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id].instance.kill();
            delete this.loadedPlugins[id];
            this.sendUnloadToRenderer(id);
        }
    },
    sendPluginToRenderer(id) {
        this.mainWindow.webContents.send("plugin-loaded", id);
    },
    sendUnloadToRenderer(id) {
        this.mainWindow.webContents.send("plugin-unloaded", id);
    },
    sendReadyToRenderer(id) {
        this.mainWindow.webContents.send("plugin-ready", id);
    }
}

export default PluginManager
