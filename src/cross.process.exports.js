import {app, dialog, ipcMain} from "electron";
import ValidatePlugin from "./components/plugin/ValidatePlugin";
import {readFileSync, writeFileSync} from "node:fs";
import PluginORM from "./utils/PluginORM";
import path from "node:path";
import UserORM from "./utils/UserORM";
import {FDO_SDK} from "@anikitenko/fdo-sdk";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "./main";
import {getFilesTree} from "./utils/getFilesTree";

//const SDKInstance = new FDO_SDK();
// In your React component (or any JS file in the renderer process)
//contextBridge.exposeInMainWorld('sdk', SDKInstance);

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
        global.PLUGIN_MANAGER.loadPlugin(id)
        userORM.activatePlugin(id)
        return { success: true };
    }  catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('deactivate-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        global.PLUGIN_MANAGER.unLoadPlugin(id)
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
        global.PLUGIN_MANAGER.unLoadPlugins()
        userORM.deactivateAllPlugins()
        return { success: true };
    }  catch (error) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('get-module-files', async (event, rootFolder) => {
    try {
        const filesTree = getFilesTree(path.join(app.getAppPath(), '.webpack/renderer', 'assets'), 'node_modules')
        return { success: true, files: filesTree};
    }  catch (error) {
        return { success: false, error: error.message };
    }
})
