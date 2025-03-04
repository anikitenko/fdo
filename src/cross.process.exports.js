import {app, dialog, ipcMain} from "electron";
import ValidatePlugin from "./components/plugin/ValidatePlugin";
import {existsSync, readFileSync, writeFileSync, copyFileSync} from "node:fs";
import PluginORM from "./utils/PluginORM";
import path from "node:path";
import UserORM from "./utils/UserORM";
import {FDO_SDK} from "@anikitenko/fdo-sdk";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "./main";
import {getFilesTree} from "./utils/getFilesTree";
import PluginManager from "./utils/PluginManager";
import ensureAndWrite from "./utils/ensureAndWrite";

ipcMain.on('approve-editor-window-close', () => {
    if (global.editorWindow) {
        global.editorWindow.destroy(); // Close the window
    }
});

ipcMain.on('approve-editor-window-reload', () => {
    if (global.editorWindow) {
        global.editorWindow.reload();
    }
})

ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Select a file',
        buttonLabel: 'Upload',
        properties: ['openFile'],
        filters: [
            { name: 'FDO Modules (ES)', extensions: ['mjs'] },
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0]; // Return the selected file path
    }
    return null; // Return null if no file was selected
});

ipcMain.handle('get-plugin-data', async (event, filePath) => {
    try {
        const plugin = ValidatePlugin(filePath);
        if (!plugin) {
            return { success: false, error: "Problem with validating plugin" };
        }
        const data = readFileSync(filePath, 'utf8');
        return { success: true, content: data, metadata: plugin.metadata };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-plugin', async (event, content) => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    try {
        const pluginName = FDO_SDK.generatePluginName(content.name)
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
            return { success: false, error: "Plugin already installed!" };
        }
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-all-plugins', async () => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    try {
        const plugins = pluginORM.getAllPlugins();
        return { success: true, plugins: plugins };
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('activate-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.loadPlugin(id)
        userORM.activatePlugin(id)
        return { success: true };
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('deactivate-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.unLoadPlugin(id)
        userORM.deactivatePlugin(id)
        return { success: true };
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-activated-plugins', async () => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        const plugins = userORM.getActivatedPlugins()
        return { success: true, plugins: plugins };
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('deactivate-all-plugins', async () => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.unLoadPlugins()
        userORM.deactivateAllPlugins()
        return { success: true };
    }  catch (error) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('get-module-files', async () => {
    try {
        const filesTree = getFilesTree(path.join(app.getAppPath(), '.webpack/renderer', 'assets'), 'node_modules')
        return { success: true, files: filesTree};
    }  catch (error) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('get-esbuild-wasm-path', async () => {
    try {
        const isDev = !app.isPackaged
        if (!isDev) {
            // Path inside asar
            const wasmPath = path.join(process.resourcesPath, 'esbuild.wasm')
            // Path in temp directory
            const tempDir = app.getPath('temp');
            const extractedWasmPath = path.join(tempDir, 'esbuild.wasm');

            // Extract if not already extracted
            if (!existsSync(extractedWasmPath)) {
                copyFileSync(wasmPath, extractedWasmPath);
            }

            return `file://${extractedWasmPath}`;
        } else {
            return "/assets/esbuild-wasm/esbuild.wasm"
        }
    } catch (error) {
        console.error('Error extracting esbuild.wasm:', error);
        return null;
    }
});

ipcMain.handle('deploy-to-main-from-editor', async (event, data) => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    const pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
    const pathToPlugin = path.join(pathToDir, data.entrypoint)
    const metadata = data.metadata
    metadata.icon = metadata.icon.toLowerCase()

    await ensureAndWrite(pathToPlugin, data.content)
    pluginORM.addPlugin(data.name, metadata, pathToPlugin, true)

    const mainWindow = PluginManager.mainWindow
    if (mainWindow) {
        mainWindow.focus()
    }
    mainWindow.webContents.send("deploy-from-editor", data.name);
})
