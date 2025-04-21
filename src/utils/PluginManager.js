import UserORM from "./UserORM";
import {utilityProcess} from "electron";
import PluginORM from "./PluginORM";
import {PluginChannels} from "../ipc/channels";
import {Certs} from "./certs";
import {NotificationCenter} from "./NotificationCenter";

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
    async loadPlugins() {
        const userORM = new UserORM(this.userConfigFile);
        const plugins = userORM.getActivatedPlugins();

        const loadPromises = plugins.map((id) => this.loadPlugin(id));

        const results = await Promise.allSettled(loadPromises);

        const loaded = results.filter(r => r.status === "fulfilled" && r.value.success).length;
        NotificationCenter.addNotification({title: `Plugins were loaded`, message: `🔄 Loaded ${loaded} of ${plugins.length} plugins.`});
    },

    async loadPlugin(id) {
        if (this.loadingPlugins[id]) {
            return { success: true };
        }

        this.loadingPlugins = this.loadingPlugins || {};
        this.loadingPlugins[id] = true;

        const pluginORM = new PluginORM(this.pluginConfigFile);
        const plugin = pluginORM.getPlugin(id);

        const result = Certs.verifyPlugin(plugin.home);
        if (!result.success) {
            delete this.loadingPlugins[id];
            this.sendUnloadToRenderer(id);
            NotificationCenter.addNotification({title: `Plugin ${id} verification failed`, message: result.error, type: "danger"});
            return { success: false, error: result.error };
        }

        try {
            const child = utilityProcess.fork(plugin.entry, [], {
                serviceName: `plugin-${id}`,
                cwd: plugin.home,
                env: {
                    PLUGIN_HOME: plugin.home,
                    LOG_LEVEL: "info",
                    ...process.env,
                },
            });

            const cleanup = () => {
                delete this.loadingPlugins[id];
                delete this.loadedPlugins[id];
                this.sendUnloadToRenderer(id);
                NotificationCenter.addNotification({title: `Plugin ${id} was unloaded`});
            };

            child.once("spawn", () => {
                delete this.loadingPlugins[id];

                this.loadedPlugins[id] = {
                    instance: child,
                    ready: false,
                };

                child.postMessage({ message: "PLUGIN_READY" });

                child.once("message", (message) => {
                    if (message.type === "PLUGIN_READY") {
                        this.setPluginReady(id);
                        this.sendReadyToRenderer(id)
                        NotificationCenter.addNotification({title: `${id} is ready`});
                    }
                });
            });

            child.once("error", (err) => {
                cleanup();
                NotificationCenter.addNotification({title: `Error with ${id}`, message: err, type: "danger"});
            });

            child.once("exit", (code) => {
                NotificationCenter.addNotification({title: `Plugin ${id} exited`, message: `Code is ${code}`, type: "danger"});
                cleanup();
            });

            return { success: true };
        } catch (err) {
            delete this.loadingPlugins[id];
            NotificationCenter.addNotification({title: `Failed to load ${id}`, message: err, type: "danger"});
            return { success: false, error: err.message };
        }
    },

    setPluginReady(id) {
        this.loadedPlugins[id].ready = true;
    },
    getLoadedPlugin(id) {
        return this.loadedPlugins[id];
    },
    getLoadedPluginInstance(id) {
        return this.loadedPlugins[id]?.instance;
    },
    getLoadedPluginReady(id) {
        return this.loadedPlugins[id]?.ready;
    },
    unLoadPlugins() {
        for(const id in this.loadedPlugins) {
            this.unLoadPlugin(id);
        }
    },
    unLoadPlugin(id) {
        if (this.loadedPlugins[id]) {
            this.loadedPlugins[id]?.instance.kill();
            delete this.loadedPlugins[id];
            this.sendUnloadToRenderer(id);
        }
    },
    sendUnloadToRenderer(id) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send(PluginChannels.on_off.UNLOADED, id);
        }
    },
    sendReadyToRenderer(id) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send(PluginChannels.on_off.READY, id);
        }
    }
}

export default PluginManager
