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
        if (this.loadingPlugins?.[id]) {
            console.warn(`Plugin ${id} is already loading.`);
            return; // Prevent double execution
        }

        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPlugins[id] = true;

        this.unLoadPlugin(id)

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);
        const pluginPath = path.join(plugin.home, plugin.entry);
        const child = utilityProcess.fork(pluginPath, [], {
            serviceName: `plugin-${id}`,
            execArgv: ['--require', 'source-map-support/register'],
            cwd: plugin.home,
            env: {
                PLUGIN_HOME: plugin.home,
                LOG_LEVEL: "info"
            },
        })

        child.on('spawn', () => {
            this.loadedPlugins[id] = child;
            plugin.postMessage({message: 'PLUGIN_READY'})

            // Handle messages from the plugin
            plugin.once('message', (message) => {
                if (message.type === 'PLUGIN_READY') {
                    console.log(`Plugin ${id} is ready`)
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
    getLoadedPlugin(id) {
        return this.loadedPlugins[id];
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
