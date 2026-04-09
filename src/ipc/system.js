import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import PluginManager from "../utils/PluginManager";
import {AppMetrics, PLUGINS_REGISTRY_FILE} from "../main.js";
import {metricDensityReductionInterval} from "../utils/metricDensityReductionInterval";
import {SystemChannels} from "./channels";
import {getFilesTree} from "../utils/getFilesTree";
import path from "node:path";
import PluginORM from "../utils/PluginORM";
import {editorWindow, isWindowValid, cleanupWindowResources} from "../utils/editorWindow";

import {exec} from "child_process";
import {promisify} from "util";
import {installFDOCLI, removeFDOCLI} from "../utils/installFDOCLI";
import {lookpath} from "lookpath";
import {createEditorWindowConfirmState} from "./system_confirm_state";
import {buildFdoSdkKnowledgeIndex, searchFdoSdkKnowledge} from "../utils/fdoSdkKnowledge";
import {extractReferenceUrls, summarizeHtmlReference} from "../utils/externalReferenceKnowledge";
import {fetchWithTimeout} from "../utils/fetchWithTimeout";
import {readFile} from "node:fs/promises";
import fs from "node:fs";

const execAsync = promisify(exec);

// Constants for electron-builder (replaces Forge webpack entries)
const isDev = !app.isPackaged;
const MAIN_WINDOW_WEBPACK_ENTRY = isDev
    ? 'file://' + path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html')
    : 'file://' + path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'index.html');

const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY = isDev
    ? path.join(__dirname, '..', '..', 'dist', 'main', 'preload.js')
    : path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'preload.js');

// Timeout tracking for editor window close operations
let editorCloseTimeoutId = null;
let fdoSdkKnowledgeCache = {
    sourcePath: "",
    index: null,
};

function pickExistingDirectory(paths = []) {
    for (const candidate of paths) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (_) {
            // Ignore unreadable candidates and continue with next path.
        }
    }
    return "";
}

function resolveFdoSdkPackagePath() {
    const isDev = !app.isPackaged;
    const candidates = isDev
        ? [
            path.join(process.cwd(), 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(__dirname, '..', '..', 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(__dirname, '..', '..', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk'),
        ]
        : [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anikitenko', 'fdo-sdk'),
        ];

    return pickExistingDirectory(candidates) || candidates[0];
}

function resolveFdoSdkDistPath() {
    const packagePath = resolveFdoSdkPackagePath();
    const isDev = !app.isPackaged;
    const candidates = [
        path.join(packagePath, 'dist'),
        ...(isDev
            ? [path.join(__dirname, '..', '..', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk', 'dist')]
            : [path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk', 'dist')]),
    ];

    return pickExistingDirectory(candidates) || candidates[0];
}

function getFilesTreeSafe(basePath, targetPath, filter = null) {
    try {
        const files = getFilesTree(basePath, targetPath);
        return typeof filter === "function" ? files.filter(filter) : files;
    } catch (_) {
        return [];
    }
}

function getCachedFdoSdkKnowledgeIndex() {
    const packagePath = resolveFdoSdkPackagePath();
    const distPath = resolveFdoSdkDistPath();
    const sourcePath = `${packagePath}|${distPath}`;
    if (fdoSdkKnowledgeCache.index && fdoSdkKnowledgeCache.sourcePath === sourcePath) {
        return fdoSdkKnowledgeCache.index;
    }

    const topLevelDocsFilter = (file) => /README|CHANGELOG|package\.json/i.test(file.path);
    const files = [
        ...getFilesTreeSafe(distPath, '@types'),
        ...getFilesTreeSafe(packagePath, '.', topLevelDocsFilter),
        ...getFilesTreeSafe(packagePath, 'docs'),
        ...getFilesTreeSafe(packagePath, 'examples'),
        ...getFilesTreeSafe(distPath, 'docs'),
    ];
    const index = buildFdoSdkKnowledgeIndex(files);
    fdoSdkKnowledgeCache = {
        sourcePath,
        index,
    };
    return index;
}

async function fetchExternalReferenceKnowledge(query = "", limit = 3) {
    const urls = extractReferenceUrls(query).slice(0, limit);
    const results = [];

    for (const url of urls) {
        try {
            const response = await fetchWithTimeout(url, {
                redirect: "follow",
                headers: {
                    "user-agent": "FDO-AI-Coding-Agent/1.0",
                },
            }, 8000);
            if (!response.ok) {
                continue;
            }
            const html = await response.text();
            results.push(summarizeHtmlReference(response.url || url, html));
        } catch (_) {
            // Ignore individual fetch failures and continue with the next reference.
        }
    }

    return results;
}

/**
 * Force closes the editor window if normal close fails
 * Used as fallback when timeout expires
 * @param {BrowserWindow} window - The window instance to force close
 */
function forceCloseWindow(window) {
    if (!window) return;
    
    try {
        if (!window.isDestroyed()) {
            console.warn('[Editor Close] Timeout expired, forcing window closure');
            window.destroy();
        }
    } catch (error) {
        console.error('[Editor Close] Error during force close:', error);
    } finally {
        // Ensure cleanup happens regardless
        editorWindow.nullWindow();
    }
}

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
    const confirmState = createEditorWindowConfirmState();
    editorWindowInstance.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/editor?data=${encodedData}`).then(() => {
    });

    editorWindowInstance.on('close', (event) => {
        if (confirmState.closeApprovedOnce) {
            confirmState.closeApprovedOnce = false;
            return;
        }
        event.preventDefault();
        editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_CLOSE); // Send event to React
    });
    editorWindowInstance.on('closed', () => {
        // Clear any active close timeout
        if (editorCloseTimeoutId) {
            clearTimeout(editorCloseTimeoutId);
            editorCloseTimeoutId = null;
        }

        const trackedWindow = editorWindow.getWindow();
        if (trackedWindow === editorWindowInstance) {
            editorWindow.nullWindow();
        }
        console.info('[Editor Close] Window closed and cleanup completed');
    });

    editorWindowInstance.webContents.on('before-input-event', (event, input) => {
        if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
            if (confirmState.reloadApprovedOnce) {
                confirmState.reloadApprovedOnce = false;
                return;
            }
            event.preventDefault();
            editorWindowInstance.webContents.send(SystemChannels.on_off.CONFIRM_RELOAD);
        }
    });

    editorWindowInstance.__confirmState = confirmState;
}

export function registerSystemHandlers() {
    // Listen for external link requests
    ipcMain.on(SystemChannels.OPEN_EXTERNAL_LINK, (event, url) => {
        if (typeof url === "string" && (url.startsWith("http") || url.startsWith("file:"))) {
            shell.openExternal(url).catch((error) => {
                console.error("[System] Failed to open external URL", { url, error: error?.message || error });
            });
        }
    });

    ipcMain.handle(SystemChannels.OPEN_PLUGIN_LOGS, async (event, pluginId = "") => {
        const normalizedPluginId = String(pluginId || "").trim();
        const userDataPath = app.getPath("userData");
        const pluginDataDir = normalizedPluginId
            ? path.join(userDataPath, "plugin-data", normalizedPluginId)
            : "";
        const pluginLogsDir = pluginDataDir ? path.join(pluginDataDir, "logs") : "";
        const logsDir = pickExistingDirectory([
            pluginLogsDir,
            pluginDataDir,
            path.join(userDataPath, "logs"),
        ]) || (pluginLogsDir || pluginDataDir || path.join(userDataPath, "logs"));
        try {
            const openError = await shell.openPath(logsDir);
            if (openError) {
                return {success: false, error: openError};
            }
            return {success: true, path: logsDir};
        } catch (error) {
            return {success: false, error: error?.message || String(error)};
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

    ipcMain.handle(SystemChannels.OPEN_FILE_DIALOG, async (event, params, multiple = false) => {
        const result = await dialog.showOpenDialog({
            ...params,
        });

        if (!result.canceled && result.filePaths.length > 0) {
            if (!multiple) {
                return result.filePaths[0];
            } else {
                return result.filePaths;
            }
        }
        return null; // Return null if no file was selected
    });

    ipcMain.handle(SystemChannels.GET_MODULE_FILES, async () => {
        try {
            const isDev = !app.isPackaged;
            const assetsPath = isDev
                ? path.join(__dirname, '..', '..', 'dist', 'renderer', 'assets')
                : path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'assets');
            const filesTree = getFilesTree(assetsPath, 'vendor')
            return {success: true, files: filesTree};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_TYPES, async () => {
        try {
            const fdoSdkTypes = resolveFdoSdkDistPath();
            const candidates = [
                path.join(fdoSdkTypes, "@types"),
                path.join(fdoSdkTypes, "types"),
            ];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                    const filesTree = getFilesTree(candidate, '.');
                    return {success: true, files: filesTree};
                }
            }
            // Recent SDK bundles may ship without dedicated .d.ts trees.
            return {success: true, files: [], warning: "No SDK type files found in dist."};
        } catch (error) {
            return {success: false, error: error.message, files: []};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_DOM_METADATA, async () => {
        try {
            const domMetadataPath = path.join(resolveFdoSdkDistPath(), "dom-metadata.json");
            const content = await readFile(domMetadataPath, "utf8");
            return {
                success: true,
                metadata: JSON.parse(content),
            };
        } catch (error) {
            return {success: false, error: error.message, metadata: []};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_KNOWLEDGE, async (_event, query = "", limit = 6) => {
        try {
            const index = getCachedFdoSdkKnowledgeIndex();
            const results = searchFdoSdkKnowledge(index, query, { limit });
            return { success: true, results };
        } catch (error) {
            return { success: false, error: error.message, results: [] };
        }
    })

    ipcMain.handle(SystemChannels.GET_EXTERNAL_REFERENCE_KNOWLEDGE, async (_event, query = "", limit = 3) => {
        try {
            const results = await fetchExternalReferenceKnowledge(query, limit);
            return { success: true, results };
        } catch (error) {
            return { success: false, error: error.message, results: [] };
        }
    })

    ipcMain.handle(SystemChannels.GET_BABEL_PATH, async () => {
        try {
            const isDev = !app.isPackaged;
            const babel = isDev
                ? path.join(__dirname, '..', '..', 'dist', 'renderer', 'assets', 'vendor', '@babel', 'standalone')
                : path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'assets', 'vendor', '@babel', 'standalone');
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
                    if (!await lookpath("code")) {
                        return {success: false, error: "VS Code is not installed or not in PATH."};
                    }
                    await execAsync(`code "${pluginDirectory}"`);
                    break;
                case "idea":
                    if (!await lookpath("idea")) {
                        return {success: false, error: "IntelliJ IDEA is not installed or not in PATH."};
                    }
                    await execAsync(`idea "${pluginDirectory}"`);
                    break;
                case "webstorm":
                    if (!await lookpath("webstorm")) {
                        return {success: false, error: "IntelliJ WebStorm is not installed or not in PATH."};
                    }
                    await execAsync(`webstorm "${pluginDirectory}"`);
            }
            return {success: true};
        }
    })

    ipcMain.handle(SystemChannels.IS_FDO_IN_PATH, async () => {
        if (await lookpath('fdo')) {
            return {success: true};
        } else {
            return {success: false};
        }
    })

    ipcMain.handle(SystemChannels.ADD_FDO_IN_PATH, async () => {
        if (!await lookpath("fdo")) {
            return installFDOCLI()
        } else {
            return {success: false, error: "FDO CLI is already in PATH."};
        }
    })

    ipcMain.handle(SystemChannels.REMOVE_FDO_FROM_PATH, async () => {
        if (await lookpath("fdo")) {
            return removeFDOCLI()
        } else {
            return {success: false, error: "FDO CLI is not in PATH."};
        }
    })

    ipcMain.on(SystemChannels.OPEN_EDITOR_WINDOW, (_event, data) => {
        systemOpenEditorWindow(data)
    });

    ipcMain.on(SystemChannels.EDITOR_CLOSE_APPROVED, (event) => {
        console.info('[Editor Close] Close approved by user');
        const editorWindowInstance = BrowserWindow.fromWebContents(event.sender);
        
        // Validate window before attempting to close
        if (!isWindowValid(editorWindowInstance)) {
            console.warn('[Editor Close] Window validation failed - already null or destroyed');
            cleanupWindowResources({ timeoutId: editorCloseTimeoutId });
            editorWindow.nullWindow();
            return;
        }
        
        // Start timeout mechanism (2.5 seconds) as fallback
        editorCloseTimeoutId = setTimeout(() => {
            console.warn('[Editor Close] Normal close timeout expired, forcing closure');
            forceCloseWindow(editorWindowInstance);
        }, 2500);
        
        // Attempt normal window destruction
        try {
            if (editorWindowInstance.__confirmState) {
                editorWindowInstance.__confirmState.closeApprovedOnce = true;
            }
            editorWindowInstance.destroy();
            console.info('[Editor Close] Window destroy initiated');
        } catch (error) {
            console.error('[Editor Close] Error during window destruction:', error);
            // Clear timeout and cleanup since destroy failed
            if (editorCloseTimeoutId) {
                clearTimeout(editorCloseTimeoutId);
                editorCloseTimeoutId = null;
            }
            // Force close as fallback
            forceCloseWindow(editorWindowInstance);
        }
    });

    ipcMain.on(SystemChannels.EDITOR_RELOAD_APPROVED, (event) => {
        console.info('[Editor Reload] Reload approved by user');
        const editorWindowInstance = BrowserWindow.fromWebContents(event.sender);
        
        // Validate window before attempting to reload
        if (!isWindowValid(editorWindowInstance)) {
            console.warn('[Editor Reload] Window validation failed - already null or destroyed');
            return;
        }
        
        // Attempt window reload
        try {
            if (editorWindowInstance.__confirmState) {
                editorWindowInstance.__confirmState.reloadApprovedOnce = true;
            }
            editorWindowInstance.reload();
            console.info('[Editor Reload] Window reload initiated');
        } catch (error) {
            console.error('[Editor Reload] Error during window reload:', error);
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
