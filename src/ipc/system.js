import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import PluginManager from "../utils/PluginManager";
import {AppMetrics, PLUGINS_REGISTRY_FILE} from "../main.js";
import {metricDensityReductionInterval} from "../utils/metricDensityReductionInterval";
import {SystemChannels} from "./channels";
import {getFilesTree} from "../utils/getFilesTree";
import path from "node:path";
import PluginORM from "../utils/PluginORM";
import {editorWindow} from "../utils/editorWindow";

import {exec} from "child_process";
import {promisify} from "util";

const execAsync = promisify(exec);

function systemOpenEditorWindow(data) {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    const plugin = pluginORM.getPlugin(data.name);
    let pluginDirectory = "sandbox";
    if (plugin) {
        pluginDirectory = plugin.home
    }

    data.dir = pluginDirectory

    const encodedData = encodeURIComponent(JSON.stringify(data));
    const editorWindowInstance = editorWindow.createWindow()
    editorWindowInstance.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/editor?data=${encodedData}`).then(() => {
    });

    editorWindowInstance.on('close', (event) => {
        event.preventDefault();
        editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_CLOSE); // Send event to React
    });
    editorWindowInstance.on('closed', () => editorWindow.nullWindow());

    editorWindowInstance.webContents.on('before-input-event', (event, input) => {
        if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
            event.preventDefault();
            editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_RELOAD);
        }
    });
}

async function isCommandAvailable(command) {
    const platform = process.platform;
    const checkCommand = platform === "win32" ? `where ${command}` : `which ${command}`;

    try {
        await execAsync(checkCommand);
        return true;
    } catch {
        return false;
    }
}

export function registerSystemHandlers() {
    // Listen for external link requests
    ipcMain.on(SystemChannels.OPEN_EXTERNAL_LINK, (event, url) => {
        if (typeof url === "string" && url.startsWith("http")) {
            shell.openExternal(url).then(() => {
            });
        }
    });

    ipcMain.handle(SystemChannels.GET_PLUGIN_METRIC, (event, id, fromTime, toTime) => {
        let plugin = PluginManager.getLoadedPluginInstance(id);
        // If plugin is not found, try to retrieve it from `AppMetrics`
        if (!plugin) {
            const matchingEntry = AppMetrics.find(({metrics}) =>
                metrics.some((m) => m.name === `plugin-${id}`)
            );

            if (matchingEntry) {
                const matchedMetric = matchingEntry.metrics.find((m) => m.name === `plugin-${id}`);
                if (matchedMetric) {
                    plugin = {pid: matchedMetric.pid};
                }
            }
        }

        if (!plugin) return []; // Still not found, return empty

        const startTime = fromTime || 0; // Default to 0 to get all metrics if not provided
        const endTime = toTime || Date.now(); // Default to now

        let filteredData = AppMetrics
            .filter(({date, metrics}) =>
                date >= startTime && date <= endTime && metrics.some(m => m.pid === plugin.pid)
            )
            .map(({date, metrics}) => ({
                date,
                metric: metrics.find(m => m.pid === plugin.pid)
            }));

        // Adjust data density based on time range
        const durationMs = endTime - startTime;
        const interval = metricDensityReductionInterval(durationMs)

        filteredData = filteredData.filter((_, index) => index % Math.floor(interval / 1000) === 0);

        return filteredData;
    });

    ipcMain.handle(SystemChannels.OPEN_FILE_DIALOG, async (event, params) => {
        const result = await dialog.showOpenDialog({
            ...params,
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0]; // Return the selected file path
        }
        return null; // Return null if no file was selected
    });

    ipcMain.handle(SystemChannels.GET_MODULE_FILES, async () => {
        try {
            const filesTree = getFilesTree(path.join(app.getAppPath(), '.webpack', 'renderer', 'assets'), 'node_modules')
            return {success: true, files: filesTree};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(SystemChannels.GET_BABEL_PATH, async () => {
        try {
            const babel = path.join(app.getAppPath(), '.webpack', 'renderer', 'assets', 'node_modules', '@babel', 'standalone')
            return {success: true, babel};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(SystemChannels.OPEN_PLUGIN_IN_EDITOR, async (event, editor, pluginID) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(pluginID);
        if (plugin) {
            const pluginDirectory = plugin.home
            switch (editor) {
                case "builtin":
                    systemOpenEditorWindow({name: pluginID})
                    break;
                case "vscode":
                    if (!await isCommandAvailable("code")) {
                        return {success: false, error: "VS Code is not installed or not in PATH."};
                    }
                    await execAsync(`code "${pluginDirectory}"`);
                    break;
                case "idea":
                    if (!await isCommandAvailable("idea")) {
                        return {success: false, error: "IntelliJ IDEA is not installed or not in PATH."};
                    }
                    await execAsync(`code "${pluginDirectory}"`);
                    break;
                case "webstorm":
                    if (!await isCommandAvailable("webstorm")) {
                        return {success: false, error: "IntelliJ WebStorm is not installed or not in PATH."};
                    }
                    await execAsync(`webstorm "${pluginDirectory}"`);
            }
            return {success: true};
        }
    })

    ipcMain.on(SystemChannels.OPEN_EDITOR_WINDOW, (_event, data) => {
        systemOpenEditorWindow(data)
    });

    ipcMain.once(SystemChannels.EDITOR_CLOSE_APPROVED, () => {
        const editorWindowInstance = editorWindow.getWindow()
        if (editorWindowInstance) {
            editorWindowInstance.destroy(); // Close the window
        }
    });

    ipcMain.on(SystemChannels.EDITOR_RELOAD_APPROVED, () => {
        const editorWindowInstance = editorWindow.getWindow()
        if (editorWindowInstance) {
            editorWindowInstance.reload();
        }
    });

    ipcMain.on(SystemChannels.OPEN_LIVE_UI_WINDOW, (_event, data) => {
        const liveUiWindow = new BrowserWindow({
            width: 1024,
            height: 800,
            minWidth: 1024,
            minHeight: 800,
            webPreferences: {
                sandbox: true,
                nodeIntegration: false,
                contextIsolation: true,
                preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            },
        });

        const encodedData = encodeURIComponent(JSON.stringify(data));
        liveUiWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/live-ui?data=${encodedData}`).then(() => {
        });
    })
}