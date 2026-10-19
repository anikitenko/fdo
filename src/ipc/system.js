import {observabilityRequest} from '../utils/persistence/observabilityStorage';
import {getCachedFdoSdkKnowledgeIndex, resolveFdoSdkDistPath} from '../utils/sdk/installedSdkKnowledge';
import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import PluginManager from "../utils/plugins/runtime/PluginManager";
import {AppMetrics, PLUGINS_REGISTRY_FILE} from "../main.js";
import {metricDensityReductionInterval} from "../utils/system/metricDensityReductionInterval";
import {SystemChannels} from "./channels";
import {getFilesTree} from "../utils/filesystem/getFilesTree";
import path from "node:path";
import PluginORM from "../utils/persistence/PluginORM";
import {editorWindow, isWindowValid, cleanupWindowResources} from "../utils/desktop/editorWindow";
import {focusAssistantOwner} from '../utils/desktop/assistantWindowPolicy';

import {exec} from "child_process";
import {promisify} from "util";
import {installFDOCLI, removeFDOCLI, getCliInstallationStatus} from "../utils/system/installFDOCLI";
import {lookpath} from "lookpath";
import {createEditorWindowConfirmState} from "./system_confirm_state";
import {searchFdoSdkKnowledge} from "../utils/sdk/fdoSdkKnowledge";
import {extractReferenceUrls, summarizeHtmlReference} from "../utils/ai/assistant/externalReferenceKnowledge";
import {fetchWithTimeout} from "../utils/network/fetchWithTimeout";
import fs from "node:fs";
import {registerLiveUiHandlers, readLiveUiSdkMetadata} from './liveUi';

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

function getOptionalFdoSdkEditorModule() {
    try {
        if (typeof __non_webpack_require__ === "function") {
            return __non_webpack_require__("@anikitenko/fdo-sdk");
        }
    } catch (_) {
        return null;
    }
    return null;
}

function createSafeSdkEditorSupportManifest() {
    return {
        name: "@anikitenko/fdo-sdk",
        private: true,
        types: "./index.d.ts",
        exports: {
            ".": {
                types: "./index.d.ts",
                default: "./dist/fdo-sdk.bundle.js",
            },
        },
    };
}

function normalizeSdkEditorModuleId(sdkModule) {
    return (
        typeof sdkModule?.SDK_EDITOR_MODULE_ID === "string" && sdkModule.SDK_EDITOR_MODULE_ID.trim()
            ? sdkModule.SDK_EDITOR_MODULE_ID.trim()
            : "@anikitenko/fdo-sdk"
    );
}

function createDefaultEditorVirtualPath(moduleId = "@anikitenko/fdo-sdk", suffix = "index.d.ts") {
    const normalizedModuleId = String(moduleId || "@anikitenko/fdo-sdk")
        .replace(/^\/+/, "")
        .replace(/^node_modules\//, "")
        .trim();
    const normalizedSuffix = String(suffix || "index.d.ts").replace(/^\/+/, "").trim();
    return `/node_modules/${normalizedModuleId}/${normalizedSuffix}`;
}

function normalizeEditorVirtualPath(pathValue = "", fallback = "") {
    const normalized = String(pathValue || "").trim();
    if (!normalized) {
        return fallback;
    }
    return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
}

function getFdoSdkEditorSupportPayload() {
    const sdkModule = getOptionalFdoSdkEditorModule();
    const fallbackManifest = createSafeSdkEditorSupportManifest();
    const fallbackPackageJson = JSON.stringify(fallbackManifest, null, 2);
    const moduleId = normalizeSdkEditorModuleId(sdkModule);
    const fallbackIndexTypesVirtualPath = createDefaultEditorVirtualPath(moduleId, "index.d.ts");
    const fallbackPackageJsonVirtualPath = createDefaultEditorVirtualPath(moduleId, "package.json");
    const indexTypesVirtualPath = normalizeEditorVirtualPath(
        sdkModule?.SDK_EDITOR_INDEX_TYPES_VIRTUAL_PATH,
        fallbackIndexTypesVirtualPath
    );
    const packageJsonVirtualPath = normalizeEditorVirtualPath(
        sdkModule?.SDK_EDITOR_PACKAGE_JSON_VIRTUAL_PATH,
        fallbackPackageJsonVirtualPath
    );

    if (typeof sdkModule?.getEditorSupportBundle === "function") {
        try {
            const bundle = sdkModule.getEditorSupportBundle();
            if (bundle && typeof bundle === "object") {
                const packageManifest = (
                    bundle.packageManifest && typeof bundle.packageManifest === "object"
                        ? bundle.packageManifest
                        : fallbackManifest
                );
                const packageJson = (
                    typeof bundle.packageJson === "string" && bundle.packageJson.trim()
                        ? bundle.packageJson
                        : JSON.stringify(packageManifest, null, 2)
                );
                return {
                    success: true,
                    bundle: {
                        ...bundle,
                        moduleId,
                        indexTypesVirtualPath,
                        packageJsonVirtualPath,
                        packageManifest,
                        packageJson,
                    },
                };
            }
        } catch (_) {
            // Continue with the compatibility helper path below.
        }
    }

    let packageManifest = null;
    let packageJson = null;

    try {
        if (typeof sdkModule?.getEditorSupportPackageManifest === "function") {
            const manifest = sdkModule.getEditorSupportPackageManifest();
            if (manifest && typeof manifest === "object") {
                packageManifest = manifest;
            }
        }
    } catch (_) {
        packageManifest = null;
    }

    try {
        if (typeof sdkModule?.getEditorSupportPackageJson === "function") {
            const content = sdkModule.getEditorSupportPackageJson();
            if (typeof content === "string" && content.trim()) {
                packageJson = content;
            }
        }
    } catch (_) {
        packageJson = null;
    }

    return {
        success: true,
        bundle: {
            moduleId,
            indexTypesVirtualPath,
            packageJsonVirtualPath,
            packageManifest: packageManifest || fallbackManifest,
            packageJson: packageJson || fallbackPackageJson,
            renderOnLoadTypeDefinitions: null,
            renderOnLoadHints: null,
        },
    };
}

function getFdoSdkEditorMonacoPolicyPayload(options = {}) {
    const sdkModule = getOptionalFdoSdkEditorModule();
    if (typeof sdkModule?.getEditorSupportMonacoPolicy !== "function") {
        return {success: true, policy: null};
    }

    const hasSdkIndex = options?.hasSdkIndex === true;
    const namespaceFallbackTypeDefinitions = typeof options?.namespaceFallbackTypeDefinitions === "string"
        ? options.namespaceFallbackTypeDefinitions
        : "";

    try {
        const policy = sdkModule.getEditorSupportMonacoPolicy({
            hasSdkIndex,
            namespaceFallbackTypeDefinitions,
        });
        return {
            success: true,
            policy: policy && typeof policy === "object" ? policy : null,
        };
    } catch (error) {
        return {
            success: false,
            error: error?.message || String(error),
            policy: null,
        };
    }
}

function normalizeRenderOnLoadTemplate(template = {}) {
    const id = String(template?.id || "").trim();
    if (!id) {
        return null;
    }
    const context = template?.context === "runtime-source" ? "runtime-source" : "plugin-method";
    const language = String(template?.language || "").trim().toLowerCase() === "javascript" ? "javascript" : "typescript";
    const source = typeof template?.source === "string" ? template.source : "";
    return {
        id,
        context,
        language,
        source,
        label: typeof template?.label === "string" ? template.label : id,
        description: typeof template?.description === "string" ? template.description : "",
    };
}

function getFdoSdkRenderOnLoadTemplatesPayload() {
    const sdkModule = getOptionalFdoSdkEditorModule();
    if (typeof sdkModule?.listRenderOnLoadTemplates !== "function") {
        return {success: true, templates: []};
    }
    try {
        const templates = sdkModule.listRenderOnLoadTemplates();
        const normalized = Array.isArray(templates)
            ? templates.map(normalizeRenderOnLoadTemplate).filter(Boolean)
            : [];
        return {success: true, templates: normalized};
    } catch (error) {
        return {success: false, error: error?.message || String(error), templates: []};
    }
}

function getFdoSdkRenderOnLoadTemplatePayload(templateId) {
    const sdkModule = getOptionalFdoSdkEditorModule();
    const normalizedTemplateId = String(templateId || "").trim();
    if (!normalizedTemplateId) {
        return {success: false, error: "Template id is required.", template: null};
    }
    if (typeof sdkModule?.getRenderOnLoadTemplate !== "function") {
        return {success: true, template: null};
    }
    try {
        const template = sdkModule.getRenderOnLoadTemplate(normalizedTemplateId);
        return {success: true, template: normalizeRenderOnLoadTemplate(template)};
    } catch (error) {
        return {success: false, error: error?.message || String(error), template: null};
    }
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
    editorWindowInstance.__fdoPluginId = String(data.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
    registerLiveUiHandlers({entry: MAIN_WINDOW_WEBPACK_ENTRY, preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY});
    // Listen for external link requests
    ipcMain.on(SystemChannels.OPEN_EXTERNAL_LINK, (event, url) => {
        if (typeof url !== "string") {
            return;
        }
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return;
            }
            shell.openExternal(parsed.href).catch((error) => {
                console.error("[System] Failed to open external URL", { url: parsed.href, error: error?.message || error });
            });
        } catch (_) {
            // Ignore invalid external-link requests.
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

    ipcMain.handle(SystemChannels.GET_PLUGIN_METRIC, async (event, id, fromTime, toTime) => {
        if (typeof id !== 'string' || id.length > 500) return [];
        const startTime = Number.isFinite(fromTime) ? fromTime : 0;
        const endTime = Number.isFinite(toTime) ? toTime : Date.now();
        if (endTime < startTime) return [];
        const persisted = await observabilityRequest('runtime', {pluginId: id, from: startTime, to: endTime, interval: metricDensityReductionInterval(endTime - startTime)});
        const plugin = PluginManager.getLoadedPluginInstance(id);
        const live = AppMetrics.filter(sample => sample.date >= startTime && sample.date <= endTime)
            .flatMap(sample => {
                const metric = sample.metrics.find(item => (plugin?.pid && item.pid === plugin.pid) || item.name === `plugin-${id}`);
                return metric ? [{date: sample.date, metric}] : [];
            });
        const liveStart = live[0]?.date ?? Infinity;
        const combined = [...persisted.filter(sample => sample.date < liveStart), ...live].sort((a, b) => a.date - b.date);
        const interval = metricDensityReductionInterval(endTime - startTime);
        let lastDate = -Infinity;
        return combined.filter(sample => {if (sample.date - lastDate < interval) return false; lastDate = sample.date; return true;});
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

    ipcMain.handle(SystemChannels.GET_FDO_SDK_EDITOR_SUPPORT, async () => {
        try {
            return getFdoSdkEditorSupportPayload();
        } catch (error) {
            return {success: false, error: error.message, bundle: null};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_EDITOR_MONACO_POLICY, async (_event, options = {}) => {
        try {
            return getFdoSdkEditorMonacoPolicyPayload(options);
        } catch (error) {
            return {success: false, error: error.message, policy: null};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATES, async () => {
        try {
            return getFdoSdkRenderOnLoadTemplatesPayload();
        } catch (error) {
            return {success: false, error: error.message, templates: []};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATE, async (_event, templateId) => {
        try {
            return getFdoSdkRenderOnLoadTemplatePayload(templateId);
        } catch (error) {
            return {success: false, error: error.message, template: null};
        }
    })

    ipcMain.handle(SystemChannels.GET_FDO_SDK_DOM_METADATA, async () => {
        try {
            return {
                success: true,
                ...await readLiveUiSdkMetadata(),
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
        const status = getCliInstallationStatus();
        return {...status, inPath: status.paths.includes(await lookpath('fdo'))};
    });
    ipcMain.handle(SystemChannels.ADD_FDO_IN_PATH, () => installFDOCLI());
    ipcMain.handle(SystemChannels.REMOVE_FDO_FROM_PATH, () => removeFDOCLI());

    ipcMain.on(SystemChannels.OPEN_EDITOR_WINDOW, (_event, data) => {
        systemOpenEditorWindow(data)
    });
    ipcMain.handle(SystemChannels.FOCUS_EDITOR_WINDOW, event =>
        focusAssistantOwner(BrowserWindow.fromWebContents(event.sender)));

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

}
