import {app, ipcMain} from "electron";
import ValidatePlugin from "../components/plugin/ValidatePlugin";
import {readFileSync, rmSync, writeFileSync, chmodSync} from "node:fs";
import PluginORM from "../utils/PluginORM";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "../main.js";
import generatePluginName from "../components/editor/utils/generatePluginName";
import path from "node:path";
import UserORM from "../utils/UserORM";
import PluginManager from "../utils/PluginManager";
import {PluginChannels} from "./channels";
import {workspaceTsCompilerOptions} from "../utils/workspaceTsCompilerOptions";
import ensureAndWrite from "../utils/ensureAndWrite";
import {EsbuildVirtualFsPlugin} from "../utils/esbuild/plugins/virtual-fs";

export function registerPluginHandlers() {
    ipcMain.handle(PluginChannels.GET_DATA, async (event, filePath) => {
        try {
            const plugin = ValidatePlugin(filePath);
            if (!plugin) {
                return {success: false, error: "Problem with validating plugin"};
            }
            const data = readFileSync(filePath, 'utf8');
            return {success: true, content: data, metadata: plugin.metadata};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.SAVE, async (event, content) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const pluginName = generatePluginName(content.name)
            const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.mjs`);
            if (!pluginORM.isInstalled(pluginName)) {
                writeFileSync(pluginPath, content.data);
                const plugin = ValidatePlugin(pluginPath);
                /*if (!plugin) {
                    unlink(pluginPath, (err) => {
                        return { success: false, error: err };
                    })
                }
                pluginORM.addPlugin(pluginName, plugin.metadata, pluginPath);
                return { success: true, pluginID: pluginName, metadata: plugin.metadata }*/
            } else {
                return {success: false, error: "Plugin already installed!"};
            }
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.REMOVE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id)
            rmSync(plugin.home, {recursive: true, force: true})
            pluginORM.removePlugin(plugin.id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET_ALL, async () => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugins = pluginORM.getAllPlugins();
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id);
            return {success: true, plugin: plugin};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.ACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.loadPlugin(id)
            userORM.activatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugin(id)
            userORM.deactivatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_USERS, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        userORM.deactivatePlugin(id)
        return {success: true};
    });

    ipcMain.handle(PluginChannels.GET_ACTIVATED, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            const plugins = userORM.getActivatedPlugins()
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_ALL, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugins()
            userORM.deactivateAllPlugins()
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.INIT, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (plugin.ready) {
            plugin.instance.postMessage({message: 'PLUGIN_INIT'})
            plugin.instance.once('message', (message) => {
                if (message.type === 'PLUGIN_INIT') {
                    const mainWindow = PluginManager.mainWindow
                    mainWindow.webContents.send(PluginChannels.on_off.INIT, {id, ...message.response})
                }
            });
        }
    })

    ipcMain.handle(PluginChannels.RENDER, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (plugin.ready) {
            plugin.instance.postMessage({message: 'PLUGIN_RENDER'})
            plugin.instance.once('message', (message) => {
                if (message.type === 'PLUGIN_RENDER') {
                    const mainWindow = PluginManager.mainWindow
                    mainWindow.webContents.send(PluginChannels.on_off.RENDER, message.response)
                }
            });
        }
    })

    ipcMain.handle(PluginChannels.UI_MESSAGE, async (event, id, content) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (plugin.ready) {
            plugin.instance.postMessage({message: 'UI_MESSAGE', content})
            plugin.instance.once('message', (message) => {
                if (message.type === 'UI_MESSAGE') {
                    const mainWindow = PluginManager.mainWindow
                    mainWindow.webContents.send(PluginChannels.on_off.UI_MESSAGE, message.response)
                }
            });
        }
    })

    ipcMain.handle(PluginChannels.BUILD, async (event, data) => {
        try {
            let esbuildBinary;
            if (process.env.NODE_ENV === "development") {
                // In development, use the normal esbuild path
                const paths = [
                    app.getAppPath(),
                    ".webpack",
                    "main",
                    "node_modules",
                    "@esbuild",
                    process.platform + "-" + process.arch,
                    "bin",
                    "esbuild"
                ]
                esbuildBinary = path.join(...paths);
            } else {
                // In production, point to the unpacked binary
                const paths = [
                    process.resourcesPath,
                    "app.asar.unpacked",
                    ".webpack",
                    "main",
                    "node_modules",
                    "@esbuild",
                    process.platform + "-" + process.arch,
                    "bin",
                    "esbuild"
                ]
                esbuildBinary = path.join(...paths);
            }
            // Set permissions
            chmodSync(esbuildBinary, 0o755)

            // Ensure esbuild uses the correct binary
            process.env.ESBUILD_BINARY_PATH = esbuildBinary;
            const latestContent = data.latestContent
            const esbuild = require("esbuild")
            const result = await esbuild.build({
                entryPoints: ["/index.ts"],
                bundle: true,
                format: "cjs",
                minify: false,
                treeShaking: false,
                platform: "node",
                sourcesContent: false,
                jsx: "automatic",
                keepNames: true,
                write: false,
                tsconfigRaw: {
                    compilerOptions: {
                        target: "ESNext",
                        module: "ESNext",
                        moduleResolution: "node",
                        ...workspaceTsCompilerOptions
                    },
                },
                plugins: [
                    EsbuildVirtualFsPlugin(latestContent)
                ],
            });

            return {success: true, files: result}

        } catch (error) {
            console.log(error)
            return {success: false, error: "Build error: "+error.toString()};
        }
    });

    ipcMain.handle(PluginChannels.DEPLOY_FROM_EDITOR, async (event, data) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
        const pathToPlugin = path.join(pathToDir, data.entrypoint)
        const metadata = data.metadata
        metadata.icon = metadata.icon.toLowerCase()

        await ensureAndWrite(pathToPlugin, data.content)
        pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true)

        const mainWindow = PluginManager.mainWindow
        if (mainWindow) {
            mainWindow.focus()
        }
        mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
    })

    ipcMain.handle(PluginChannels.SAVE_FROM_EDITOR, async (event, data) => {

    })
}