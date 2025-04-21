import {app, ipcMain} from "electron";
import ValidatePlugin from "../components/plugin/ValidatePlugin";
import {rmSync, writeFileSync, chmodSync} from "node:fs";
import { readFile } from 'node:fs/promises';
import PluginORM from "../utils/PluginORM";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "../main.js";
import generatePluginName from "../components/editor/utils/generatePluginName";
import path from "node:path";
import UserORM from "../utils/UserORM";
import PluginManager from "../utils/PluginManager";
import {PluginChannels} from "./channels";
import ensureAndWrite from "../utils/ensureAndWrite";
import {EsbuildVirtualFsPlugin} from "../utils/esbuild/plugins/virtual-fs";
import {Certs} from "../utils/certs";
import {syncPluginDir} from "../utils/syncPluginDir";
import {NotificationCenter} from "../utils/NotificationCenter";
import {editorWindow} from "../utils/editorWindow";
import {getIgnoreInstance} from "../utils/getIgnoreInstance";
import {getAllFilesWithIgnorance} from "../utils/getAllFilesWithIgnorance";

export function registerPluginHandlers() {
    ipcMain.handle(PluginChannels.GET_DATA, async (event, pluginPath) => {
        try {
            const ig = await getIgnoreInstance(pluginPath, []);

            const existingFiles = await getAllFilesWithIgnorance(pluginPath, (relativePath) => {
                return !ig.ignores(relativePath);
            });
            let metadata;
            let sourceFile = "index.ts";
            const content = await Promise.all(
                existingFiles.map(async (filePath) => {
                    const relPath = `/${path.relative(pluginPath, filePath).replace(/\\/g, "/")}`;
                    const buffer = await readFile(filePath);
                    const text = buffer.toString("utf8");

                    if (relPath === "/package.json") {
                        try {
                            const json = JSON.parse(text);
                            sourceFile = json.source || "index.ts";
                        } catch (err) {
                            return {success: false, error: `Invalid package.json: ${err}`};
                        }
                    }

                    return {
                        path: relPath,
                        content: text,
                    };
                })
            );

            const source = content.find(file => file.path === `/${sourceFile}`);
            if (source) {
                const metadataRegex = /{[^}]*\bname\s*:\s*["'`](.*?)["'`][^}]*\bversion\s*:\s*["'`](.*?)["'`][^}]*\bauthor\s*:\s*["'`](.*?)["'`][^}]*\bdescription\s*:\s*["'`](.*?)["'`][^}]*\bicon\s*:\s*["'`](.*?)["'`][^}]*}/s;
                const match = source.content.match(metadataRegex);
                if (match) {
                    metadata = {
                        name: match[1],
                        version: match[2],
                        author: match[3],
                        description: match[4],
                        icon: match[5],
                    };
                }
            } else {
                return {success: false, error: "No source file found"};
            }

            return {success: true, content, metadata};
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
            const result = await PluginManager.loadPlugin(id)
            if (!result.success) {
                return {success: false, error: result.error};
            }
            userORM.activatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.error};
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
            const srcJson = JSON.parse(latestContent["/package.json"])
            const pluginEntrypoint = srcJson.source || "index.ts"
            const esbuild = require("esbuild")
            const result = await esbuild.build({
                entryPoints: [`/${pluginEntrypoint}`],
                bundle: true,
                format: "cjs",
                platform: "node",
                write: false,
                plugins: [
                    EsbuildVirtualFsPlugin(latestContent)
                ],
            });

            return {success: true, files: result}

        } catch (error) {
            NotificationCenter.addNotification({title: `Build error`, message: error.toString(), type: "danger"});
            return {success: false, error: "Build error: "+error.toString()};
        }
    });

    ipcMain.handle(PluginChannels.DEPLOY_FROM_EDITOR, async (event, data) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(data.name);
        let pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
        if (plugin) {
            pathToDir = plugin.home
        }
        const pathToPlugin = path.join(pathToDir, data.entrypoint)
        const metadata = data.metadata
        metadata.icon = metadata.icon.toLowerCase()

        await ensureAndWrite(pathToPlugin, data.content)
        const signResult = Certs.signPlugin(pathToDir, data.rootCert)
        if (!signResult.success) {
            return signResult
        }
        pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true)

        const mainWindow = PluginManager.mainWindow
        if (mainWindow) {
            mainWindow.focus()
        }
        mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
        return {success: true}
    })

    ipcMain.handle(PluginChannels.SAVE_FROM_EDITOR, async (event, data) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(data.name);
        let pathToDir;
        if (data.dir === "sandbox" || data.dir.includes(data.sandbox) || !plugin) {
            pathToDir = path.join(PLUGINS_DIR, data.name)
        } else {
            pathToDir = plugin.home
        }

        await syncPluginDir(pathToDir, data.content)

        const signResult = Certs.signPlugin(pathToDir, data.rootCert)
        if (!signResult.success) {
            return signResult
        }

        const metadata = data.metadata
        metadata.icon = metadata.icon.toLowerCase()
        pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true)

        if (data.dir.includes(data.sandbox)) {
            rmSync(data.dir, {recursive: true, force: true})
            const mainWindow = PluginManager.mainWindow
            mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
        }

        const editorWindowInstance = editorWindow.getWindow()
        if (editorWindowInstance) {
            editorWindowInstance.destroy();
        }

        return {success: true}
    })

    ipcMain.handle(PluginChannels.VERIFY_SIGNATURE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.verifyPlugin(plugin.home)
    })

    ipcMain.handle(PluginChannels.SIGN, async (event, id, signerLabel) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.signPlugin(plugin.home, signerLabel)
    })
}