import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import PluginManager from "../utils/PluginManager";
import {AppMetrics} from "../main.js";
import {metricDensityReductionInterval} from "../utils/metricDensityReductionInterval";
import {SystemChannels} from "./channels";
import {getFilesTree} from "../utils/getFilesTree";
import path from "node:path";

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

    ipcMain.handle(SystemChannels.OPEN_FILE_DIALOG, async () => {
        const result = await dialog.showOpenDialog({
            title: 'Select a file',
            buttonLabel: 'Upload',
            properties: ['openFile'],
            filters: [{name: 'FDO Modules (ES)', extensions: ['mjs']},]
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

    ipcMain.on(SystemChannels.OPEN_EDITOR_WINDOW, (_event, data) => {
        let editorWindow = new BrowserWindow({
            width: 1024,
            height: 800,
            minWidth: 1024,
            minHeight: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            },
        });

        const encodedData = encodeURIComponent(JSON.stringify(data));
        editorWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/editor?data=${encodedData}`).then(() => {});

        editorWindow.on('close', (event) => {
            event.preventDefault();
            editorWindow.webContents.send('confirm-close'); // Send event to React
        });
        editorWindow.webContents.on('before-input-event', (event, input) => {
            if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
                event.preventDefault();
                editorWindow.webContents.send('confirm-reload');
            }
        });
        editorWindow.on('closed', () => (editorWindow = null));

        ipcMain.on('approve-editor-window-close', () => {
            if (editorWindow) {
                editorWindow.destroy(); // Close the window
            }
        });

        ipcMain.on('approve-editor-window-reload', () => {
            if (editorWindow) {
                editorWindow.reload();
            }
        });
    });

    ipcMain.on(SystemChannels.OPEN_LIVE_UI_WINDOW, (_event, data) => {
        const liveUiWindow = new BrowserWindow({
            width: 1024,
            height: 800,
            minWidth: 1024,
            minHeight: 800,
            webPreferences: {
                sandbox:  true,
                nodeIntegration: false,
                contextIsolation: true,
                preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            },
        });

        const encodedData = encodeURIComponent(JSON.stringify(data));
        liveUiWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/live-ui?data=${encodedData}`).then(() => {});
    })
}