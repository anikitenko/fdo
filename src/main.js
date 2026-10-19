import {cliProfile} from './utils/system/cliProfile';
import {checkForFdoUpdate} from './utils/system/updateChecker';
import {failureNotification, pluginDisplayName} from './utils/desktop/notificationContent';
import {closeHostServices, removeHostServices} from './utils/hostServices/runtime';
import {registerHostServiceSettings} from './ipc/hostServices';
import crypto from 'node:crypto';
import {initializeObservabilityStorage, closeObservabilityStorage, recordRuntimeSamples} from './utils/persistence/observabilityStorage';
import {registerObservabilityHandlers} from './ipc/observability';
import {usageLedger} from './utils/ai/billing/ledger';
import {certificateStorage, previewSigningCertificates, initializeCertificateStorage, closeCertificateStorage} from './utils/persistence/certificateStorage';
import './utils/system/installStdioErrorHandlers';
import {registerAiUsageHandlers} from './ipc/ai_usage';
import {registerAiCodingActivityHandlers} from './ipc/ai_coding_activity';
import {app, BrowserWindow, dialog, Menu, nativeTheme, protocol, safeStorage} from 'electron';
import {registerGitOpsHandlers} from './ipc/gitops';
import {syncCollection, detachCollection, decideGitOpsUpdate} from './utils/gitops/syncCollection';
import {readPluginRepository} from './utils/gitops/verifyRepository';
import {normalizeAndValidatePluginMetadata} from './utils/plugins/runtime/pluginMetadataContract';
import UserORM from './utils/persistence/UserORM';
import {SettingsChannels} from './ipc/channels';
import {installAssistantWindowPolicy} from './utils/desktop/assistantWindowPolicy';
import nodeUrl from 'node:url';
import PluginManager from "./utils/plugins/runtime/PluginManager";
import {pluginTray} from './utils/plugins/runtime/pluginTray';
import fs, {existsSync, mkdirSync} from "node:fs";

import nodePath from "node:path";


import {settings} from "./utils/persistence/store";
import {Certs} from "./utils/system/certs";

import {registerNotificationHandlers} from "./ipc/notifications";
import {registerSystemHandlers} from "./ipc/system";
import {buildUsingEsbuild, registerPluginHandlers} from "./ipc/plugin";
import {interruptAllCodexAuthProcesses, registerSettingsHandlers} from "./ipc/settings";
import {NotificationCenter} from "./utils/desktop/NotificationCenter";
import {closeNotificationStorage} from './utils/persistence/notificationStorage';
import {closeChatStorage} from './utils/persistence/chatStorage';
import {readFile} from "node:fs/promises";

import mime from 'mime';
import { hasCliCommand, hasCliOnlyCommand, getCleanCliArgs } from "./utils/system/cliCommands.js";

import PluginORM from "./utils/persistence/PluginORM";
import {PluginChannels} from "./ipc/channels";
import {readCliPluginLogs, followCliPluginLogs} from './utils/system/cliLogs';
import {runPluginWorkspaceTests} from './utils/plugins/runtime/pluginTestRunner';
import {listCliProfiles} from './utils/system/cliProfiles';
import {withCliLock} from './utils/system/cliLock';
import {watchPluginDirectory} from './utils/system/cliDev';
import {diagnoseCli, inspectCliPlugins} from './utils/system/cliInspection';
import {inspectCliInstallation} from './utils/system/installFDOCLI';
import {runFdoCli, flushCliOutput} from "./utils/system/fdoCli";
import {readCliWorkspaceFiles, deployCliPluginDirectory, compilePluginDirectory, validatePluginDirectory, planCliDeployment, assertCliDeployAllowed} from "./utils/system/cliPluginOperations";

import log from 'electron-log/main';
import {extractMetadata} from "./utils/plugins/runtime/extractMetadata";
import {initMetrics, logMetric, logStartupError, checkSlowStartupWarning} from "./utils/system/startupMetrics";
import {ipcMain} from 'electron';
import {StartupChannels} from "./ipc/channels";
import {registerAiChatHandlers} from "./ipc/ai/ai_chat";
import {registerAiCodingAgentHandlers} from "./ipc/ai_coding_agent";

// Isolate Chromium storage as well as config/plugin files in native tests.
// This must run before the first BrowserWindow/default session is created.
if (process.env.FDO_E2E === '1' && process.env.FDO_E2E_USER_DATA_DIR) {
    const e2eUserData = nodePath.resolve(process.env.FDO_E2E_USER_DATA_DIR);
    mkdirSync(e2eUserData, {recursive: true});
    app.setPath('userData', e2eUserData);
    app.setPath('sessionData', e2eUserData);
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'static',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    {
        scheme: 'plugin',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);

// Debug logging to file (works even in packaged mode)
const debugLog = (msg) => {
    try {
        const logPath = '/tmp/fdo-debug.log';
        const timestamp = new Date().toISOString();
        const content = `${timestamp} - ${msg}\n`;
        // Use synchronous write to ensure it happens before any exit
        if (!existsSync(logPath)) {
            fs.writeFileSync(logPath, content);
        } else {
            fs.appendFileSync(logPath, content);
        }
    } catch (e) {
        // Try to at least write the error somewhere visibly
        try {
            fs.writeFileSync('/tmp/fdo-error.log', `Debug log error: ${e.message}\n`);
        } catch {}
    }
};

debugLog('[MAIN] Starting FDO main process...');
debugLog(`[MAIN] isPackaged: ${app.isPackaged}`);
debugLog(`[MAIN] argv: ${JSON.stringify(process.argv)}`);

// E2E parallel workers need isolated app instances.
// Keep production/single-instance behavior unchanged unless explicitly enabled.
const allowE2EMultiInstance = process.env.FDO_E2E === "1" && process.env.FDO_E2E_MULTI_INSTANCE === "1";
if (allowE2EMultiInstance) {
    debugLog('[MAIN] E2E multi-instance mode enabled; skipping single-instance lock enforcement.');
}

// Initialize startup metrics (must be early)
const cliArgs = cliProfile.args ?? getCleanCliArgs(process.argv, {defaultApp: !app.isPackaged});
if (!hasCliOnlyCommand(cliArgs) && !process.argv.includes('--cli')) initMetrics();

// IPC handler for renderer process metrics
ipcMain.on(StartupChannels.LOG_METRIC, (event, metricEvent, metadata) => {
    logMetric(metricEvent, metadata);
});

// Constants for electron-builder (replaces Forge webpack entries)
const isDev = !app.isPackaged;
if (isDev) {
    app.commandLine.appendSwitch("disable-http-cache");
}
const MAIN_WINDOW_WEBPACK_ENTRY = isDev
    ? nodeUrl.pathToFileURL(nodePath.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html')).toString()
    : nodeUrl.pathToFileURL(nodePath.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'index.html')).toString();

const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY = isDev
    ? nodePath.join(__dirname, '..', '..', 'dist', 'main', 'preload.js')
    : nodePath.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'preload.js');

if (process.platform === "darwin") {
    const knownPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    const currentPath = process.env.PATH || "";
    for (const p of knownPaths) {
        if (!currentPath.includes(p)) {
            process.env.PATH += `:${p}`;
        }
    }
}

function getPluginFilePath(urlPath) {
    const isPackaged = app.isPackaged;

    const baseDir = isPackaged
        ? nodePath.join(process.resourcesPath, 'app.asar', 'dist', 'renderer')
        : nodePath.join(__dirname, '..', '..', 'dist', 'renderer'); // dev mode fallback

    const safePath = decodeURIComponent(urlPath || '/plugin_host.html');
    return nodePath.join(baseDir, safePath);
}

// Lazy getters for paths that require app.getPath('userData')
// These must be functions because app.getPath() isn't available until app is ready
const getUserDataRoot = () => process.env.FDO_E2E_USER_DATA_DIR || app.getPath('userData');
export const getPluginsDir = () => nodePath.join(getUserDataRoot(), 'plugins');
export const getUserConfigFile = () => nodePath.join(getUserDataRoot(), 'config.json');
export const getPluginsRegistryFile = () => nodePath.join(getUserDataRoot(), 'plugins.json');

// For backwards compatibility, keep these as constants that will be initialized when used
// (they'll be calculated lazily on first access after app is ready)
export let PLUGINS_DIR;
export let USER_CONFIG_FILE;
export let PLUGINS_REGISTRY_FILE;

export const AppMetrics = [];
export const MAX_METRICS = 300; // Five minutes of full-resolution live samples.
let runtimeMetricsTimer, observabilityHandlers;

let isAppShuttingDown = false;

// Live E2E failures used to report only that Playwright had lost the page.
// Keep a small, test-only lifecycle trail in the main process so a closed
// window can be distinguished from a renderer crash or an application quit.
// It is intentionally unavailable in normal builds and never records prompt
// or provider data.
function recordE2EWindowLifecycle(event, details = {}) {
    if (process.env.FDO_E2E !== "1") return;
    const records = globalThis.__FDO_E2E_WINDOW_LIFECYCLE__ || [];
    records.push({
        event,
        at: new Date().toISOString(),
        isAppShuttingDown,
        windows: BrowserWindow.getAllWindows().map((window) => ({
            id: window.id,
            destroyed: window.isDestroyed(),
            visible: !window.isDestroyed() && window.isVisible(),
        })),
        ...details,
    });
    globalThis.__FDO_E2E_WINDOW_LIFECYCLE__ = records.slice(-40);
}

// Initialize paths once app is ready
function initializePaths() {
    const rootPath = getUserDataRoot();
    mkdirSync(rootPath, { recursive: true });
    PLUGINS_DIR = getPluginsDir();
    USER_CONFIG_FILE = getUserConfigFile();
    PLUGINS_REGISTRY_FILE = getPluginsRegistryFile();
}

let cliFinished = false;
if (hasCliCommand(cliArgs) || process.argv.includes('--cli')) {
    let result;
    try {
        await app.whenReady();
        initializePaths();
        const signUnlocked = async (directory, label) => {
            if (label === 'root' && !certificateStorage.list('root').some(cert => cert.label === 'root')) {
                const created = await Certs.generateRootCA('root', false, {notify: false, onlyIfMissing: true});
                if (created) (cliArgs.includes('--json') ? console.error : console.log)('Created the default root signing certificate in OS-protected storage.');
            }
            const signed = Certs.signPlugin(directory, label);
            if (!signed?.success) throw new Error(signed?.error || 'Plugin signing failed.');
        };
        const withCertificateLock = operation => withCliLock(nodePath.join(getUserDataRoot(), 'certificates.sqlite'), operation);
        const sign = (directory, label) => withCliLock(directory, () => withCertificateLock(() => signUnlocked(directory, label)));
        const compile = directory => withCliLock(directory, () => compilePluginDirectory(directory, {build: buildUsingEsbuild, extractMetadata}));
        const validate = directory => validatePluginDirectory(directory, {build: buildUsingEsbuild, extractMetadata});
        const credentialStoreAvailable = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
        const deploy = async (directory, label) => {
            const compiled = await deployCliPluginDirectory(directory, {registryFile: PLUGINS_REGISTRY_FILE, build: buildUsingEsbuild, extractMetadata,
                sign: target => withCertificateLock(() => signUnlocked(target, label))});
            // A notification failure must not undo an already committed deploy.
            try {if (app.requestSingleInstanceLock({fdoCliDeploy: compiled.name})) app.releaseSingleInstanceLock();}
            catch (error) {console.error(`Plugin installed, but the GUI could not be refreshed: ${error.message}`);}
            return compiled;
        };
        const untilQuit = async operation => {
            const controller = new AbortController();
            const quit = event => {event.preventDefault();controller.abort();};
            app.on('before-quit', quit);
            try {return await operation(controller.signal);} finally {app.removeListener('before-quit', quit);}
        };
        result = await runFdoCli(cliArgs, {
            version: app.getVersion(), profile: cliProfile.name, compile, sign, validate,
            listProfiles: () => listCliProfiles(cliProfile.baseDirectory || getUserDataRoot(), cliProfile.name),
            test: async (directory, timeoutMs) => runPluginWorkspaceTests(await readCliWorkspaceFiles(directory), {timeoutMs}),
            logs: (id, lines) => readCliPluginLogs({profile: getUserDataRoot(), registryFile: PLUGINS_REGISTRY_FILE}, id, lines),
            followLogs: (id, lines) => untilQuit(signal => followCliPluginLogs({profile: getUserDataRoot(), registryFile: PLUGINS_REGISTRY_FILE}, id, {lines, signal})),
            dev: (directory, label) => {
                assertCliDeployAllowed(PLUGINS_REGISTRY_FILE, directory);
                return untilQuit(signal => watchPluginDirectory(directory, {deploy: target => deploy(target, label), signal}));
            },
            planDeployment: (directory, label) => planCliDeployment(directory, label, {registryFile: PLUGINS_REGISTRY_FILE, profile: getUserDataRoot(), validate,
                listCertificates: previewSigningCertificates, credentialStoreAvailable}),
            listCertificates: () => certificateStorage.list('root'),
            inspectPlugins: id => inspectCliPlugins({registryFile: PLUGINS_REGISTRY_FILE, configFile: USER_CONFIG_FILE, verifyPlugin: directory => Certs.verifyPlugin(directory)}, id),
            doctor: () => diagnoseCli({version: app.getVersion(), profile: getUserDataRoot(), registryFile: PLUGINS_REGISTRY_FILE, configFile: USER_CONFIG_FILE,
                installation: inspectCliInstallation, listCertificates: () => certificateStorage.list('root'),
                credentialStoreAvailable}),
            deploy,
        });
    } catch (error) {
        console.error(`Error: ${error.message || String(error)}`);
        result = {exitCode: Number.isInteger(error.exitCode) ? error.exitCode : 1, openGui: false};
    }
    if (!result.openGui) {
        cliFinished = true;
        try {closeCertificateStorage();}
        catch (error) {console.error(`Error closing certificate storage: ${error.message}`); result.exitCode = 1;}
        await flushCliOutput();
        if (process.platform === 'win32') {
            // Electron's Windows teardown can crash after a short CLI command.
            // The certificate database is already closed so later CLI processes
            // can open the same profile without SQLITE_BUSY.
            process.exit(result.exitCode);
        }
        app.exit(result.exitCode);
    }
}

// CLI processes never register GUI startup/quit handlers after requesting exit.
if (!cliFinished) {
// Note: Squirrel startup is already handled at the top of the file (line 177)

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('fdo-fiddle', process.execPath, [nodePath.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('fdo-fiddle')
}

const pendingCliDeployments = new Set();
let cliDeploymentReady = false;
const refreshCliDeployment = async id => {
    const plugin = new PluginORM(PLUGINS_REGISTRY_FILE).getPlugin(id);
    if (!plugin) throw new Error(`Deployed plugin "${id}" was not found in the registry.`);
    const active = PluginManager.getLoadedPlugin(id) || new UserORM(USER_CONFIG_FILE).getActivatedPlugins().includes(id);
    if (active) {
        await PluginManager.unLoadPlugin(id, {force: true});
        const loaded = await PluginManager.loadPlugin(id);
        if (!loaded?.success) throw new Error(loaded?.error || `Could not restart "${id}".`);
    }
    PluginManager.sendToMainWindow(PluginChannels.on_off.DEPLOY_FROM_EDITOR, id);
};
const reloadCliDeployment = async id => {
    if (!cliDeploymentReady) {pendingCliDeployments.add(id); return;}
    try {
        await refreshCliDeployment(id);
    } catch (error) {
        NotificationCenter.addNotification(failureNotification({source: 'builds', title: 'CLI deployment could not be loaded', message: 'The files were installed, but FDO could not refresh the plugin. Open Manage Plugins to review its status.', error}));
    }
};
app.on('second-instance', (_event, _commandLine, _workingDirectory, additionalData) => {
    const mainWindow = PluginManager.mainWindow;
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show(); mainWindow.focus();
    }
    if (typeof additionalData?.fdoCliDeploy === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(additionalData.fdoCliDeploy)) {
        void reloadCliDeployment(additionalData.fdoCliDeploy);
    }
});

const gotTheLock = allowE2EMultiInstance ? true : app.requestSingleInstanceLock()

debugLog(`[MAIN] Single instance lock: ${gotTheLock}`);

if (!gotTheLock) {
    debugLog('[MAIN] Another instance running, quitting...');
    app.quit();
}

debugLog('[MAIN] Reached end of top-level code, waiting for app.whenReady()');

const createWindow = async () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1024,
        height: 800,
        minWidth: 1024,
        minHeight: 800,
        show: false, // show when ready to avoid white flash and improve perceived performance
        backgroundColor: '#111111',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            backgroundThrottling: false,
            spellcheck: false,
        },
    });
    installAssistantWindowPolicy(mainWindow);
    recordE2EWindowLifecycle("window-created", {windowId: mainWindow.id});

    if (isDev) {
        // In dev, force fresh loads from dist output to avoid stale renderer bundles.
        mainWindow.webContents.session.clearCache().catch(() => {});
    }

    if (process.env.FDO_E2E === "1") {
        mainWindow.on("close", (event) => {
            recordE2EWindowLifecycle("window-close-requested", {windowId: mainWindow.id});
            if (isAppShuttingDown) {
                return;
            }
            // In E2E runs we occasionally receive unexpected close signals
            // that terminate the window mid-test. Ignore those closes unless
            // the app is actually shutting down.
            event.preventDefault();
            debugLog("[MAIN] Ignored unexpected window close in E2E mode.");
        });
        mainWindow.on("closed", () => {
            recordE2EWindowLifecycle("window-closed", {windowId: mainWindow.id});
        });
        mainWindow.webContents.on("render-process-gone", (_event, details) => {
            recordE2EWindowLifecycle("renderer-process-gone", {
                windowId: mainWindow.id,
                reason: details?.reason || "",
                exitCode: details?.exitCode ?? null,
            });
        });
        mainWindow.webContents.on("destroyed", () => {
            recordE2EWindowLifecycle("web-contents-destroyed", {windowId: mainWindow.id});
        });
        mainWindow.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
            if (isMainFrame) {
                recordE2EWindowLifecycle("navigation-started", {
                    windowId: mainWindow.id,
                    url: String(url || ""),
                    inPlace: !!isInPlace,
                });
            }
        });
        mainWindow.webContents.on("did-navigate", (_event, url) => {
            recordE2EWindowLifecycle("navigation-finished", {
                windowId: mainWindow.id,
                url: String(url || ""),
            });
        });
        mainWindow.webContents.on("unresponsive", () => {
            recordE2EWindowLifecycle("renderer-unresponsive", {windowId: mainWindow.id});
        });
        mainWindow.webContents.on("responsive", () => {
            recordE2EWindowLifecycle("renderer-responsive", {windowId: mainWindow.id});
        });
    }

    logMetric('window-created');

    debugLog(`[MAIN] Loading URL: ${MAIN_WINDOW_WEBPACK_ENTRY}`);

    // Track load failures
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        debugLog(`[MAIN] did-fail-load: ${errorCode} - ${errorDescription} - ${validatedURL}`);
        logStartupError('renderer-load-failed', new Error(errorDescription), { errorCode, validatedURL });
    });

    // Track renderer load completion
    mainWindow.webContents.on('did-finish-load', () => {
        debugLog('[MAIN] did-finish-load fired');
        logMetric('renderer-loaded');
        setTimeout(() => {
            if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                debugLog('[MAIN] did-finish-load fallback show fired');
                logMetric('window-visible-fallback');
                mainWindow.show();
            }
        }, 150);
    });

    // Capture renderer console warnings/errors.
    // Electron is deprecating the old variadic signature in favor of a single params object.
    mainWindow.webContents.on('console-message', (...args) => {
        let level;
        let message;
        let line;
        let sourceId;

        // New-style shape: (_, params)
        if (args.length >= 2 && args[1] && typeof args[1] === "object" && !Array.isArray(args[1])) {
            const params = args[1];
            level = Number(params.level || 0);
            message = String(params.message || "");
            line = Number(params.lineNumber || params.line || 0);
            sourceId = String(params.sourceId || params.source || "");
        } else {
            // Backward-compatible old shape: (event, level, message, line, sourceId)
            level = Number(args[1] || 0);
            message = String(args[2] || "");
            line = Number(args[3] || 0);
            sourceId = String(args[4] || "");
        }

        if (level >= 2) { // 2 = warning, 3 = error
            debugLog(`[RENDERER ${level === 2 ? 'WARN' : 'ERROR'}] ${message} (${sourceId}:${line})`);
        }
    });

    mainWindow.once('ready-to-show', () => {
        debugLog('[MAIN] ready-to-show fired');
        logMetric('window-visible');
        mainWindow.show();
        
        // Check if startup was slow and show warning
        checkSlowStartupWarning('window-visible');
    });

    // and load the index.html of the app.
    debugLog('[MAIN] Calling mainWindow.loadURL...');
    try {
        await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
        debugLog('[MAIN] loadURL completed successfully');
    } catch (error) {
        debugLog(`[MAIN] loadURL failed: ${error.message}`);
        logStartupError('window-load-url-failed', error);
        throw error;
    }

    nativeTheme.themeSource = 'dark';

    PluginManager.setMainWindow(mainWindow)

    return mainWindow
};

app.whenReady().then(async () => {
    if (!gotTheLock) return;
    debugLog('[MAIN] app.whenReady() fired!');
    try {initializeCertificateStorage();}
    catch (error) {
        dialog.showErrorBox('Could not open certificate storage', `${error.message}\nExisting certificates have been preserved. FDO will close so you can resolve the problem and retry.`);
        app.exit(1);
        return;
    }

    try {await initializeObservabilityStorage();}
    catch (error) {
        dialog.showErrorBox('Could not open observability storage', `${error.message}\nExisting data has been preserved. Resolve the problem and restart FDO.`);
        app.exit(1); return;
    }

    protocol.handle("static", async (req) => {
        try {
            const reqURL = new URL(req.url);
            const hostPart = reqURL.hostname && reqURL.hostname !== 'host' ? `${reqURL.hostname}/` : '';
            const pathPart = reqURL.pathname.replace(/^\/+/, '');
            const relativePath = decodeURIComponent(`${hostPart}${pathPart}`) || 'plugin_host.html';
            const normalizedRelativePath = nodePath.posix.normalize(relativePath);

            if (
                normalizedRelativePath.startsWith('..') ||
                normalizedRelativePath.includes('/../') ||
                normalizedRelativePath === '.'
            ) {
                return new Response('Forbidden', { status: 403 });
            }

            const rendererBasePath = isDev
                ? nodePath.join(__dirname, '..', '..', 'dist', 'renderer')
                : nodePath.join(process.resourcesPath, 'app.asar', 'dist', 'renderer');
            const resolvedPath = nodePath.join(rendererBasePath, normalizedRelativePath);
            const data = await readFile(resolvedPath);
            const mimeType = mime.getType(resolvedPath) || 'application/octet-stream';

            return new Response(data, {
                headers: {
                    'Content-Type': mimeType,
                    'Cache-Control': isDev || normalizedRelativePath.endsWith('.html') ? 'no-store, no-cache, must-revalidate' : 'public, max-age=31536000, immutable',
                },
            });
        } catch (err) {
            console.error('[STATIC PROTOCOL] Error:', err?.message, 'for URL:', req.url);
            return new Response('File not found', { status: 404 });
        }
    })

    protocol.handle('plugin', async (request) => {
        try {
            const url = new URL(request.url);
            let relativePath = url.pathname;

            console.log('[PLUGIN PROTOCOL] Request:', request.url, 'Path:', relativePath);

            // Normalize special cases
            if (!relativePath || relativePath === '/' || relativePath === '/index.html') {
                relativePath = '/plugin_host.html';
            } else if (relativePath === '/plugin_host.html/' || relativePath === '/plugin_host.html') {
                relativePath = '/plugin_host.html';
            } else if (relativePath === '/plugin_host/index.js') {
                relativePath = '/index.js';
            }

            if (url.hostname === 'plugin_host.html' && relativePath === '/') {
                relativePath = '/plugin_host.html';
            }

            const filePath = getPluginFilePath(relativePath);
            console.log('[PLUGIN PROTOCOL] Serving file:', filePath);
            const data = await readFile(filePath);
            const mimeType = mime.getType(filePath) || 'text/plain';

            return new Response(data, {
                headers: {
                    'Content-Type': mimeType,
                },
            });
        } catch (err) {
            console.error('[PLUGIN PROTOCOL] Error:', err.message, 'for URL:', request.url);
            if (err.code === 'ENOENT') {
                NotificationCenter.addNotification({
                    source: "plugins", title: "A plugin interface file is missing",
                    message: "FDO could not load part of a plugin interface. Reopen the plugin; if it still fails, review its installation in Manage Plugins.",
                    details: `Resource: ${request.url}`, groupKey: "plugin-host-resource",
                    type: 'warning'
                });
                return new Response('File not found', { status: 404 });
            }

            NotificationCenter.addNotification({
                source: "plugins", title: "A plugin interface could not be loaded",
                message: "FDO could not read a plugin interface resource. Reopen the plugin or review file access and disk space.",
                details: err.message, groupKey: "plugin-host-resource",
                type: 'warning'
            });
            return new Response('Internal error', { status: 500 });
        }
    });
    
    // Initialize paths that require app.getPath('userData')
    initializePaths();
    debugLog('[MAIN] Paths initialized');
    

    logMetric('app-ready');

    log.eventLogger.startLogging()
    
    debugLog('[MAIN] About to create window...');

    let mainWindow;
    app.setAboutPanelOptions({
        applicationName: app.getName(),
        applicationVersion: app.getVersion(),
        version: app.getVersion(),
        copyright: 'Copyright © AleXvWaN',
    });
    ipcMain.handle(SettingsChannels.updates.CHECK, async () => {
        const channel = settings.get('updates.channel', 'stable');
        try {
            const platform = {darwin: 'mac', win32: 'win', linux: 'linux'}[process.platform];
            const supportedArch = process.arch === 'arm64' || process.arch === 'x64';
            const platformKey = platform && supportedArch ? `${platform}-${process.arch}` : '';
            return await checkForFdoUpdate({channel, currentVersion: app.getVersion(), platform: platformKey});
        } catch (error) {
            return {success: false, error: error.message || 'Could not check for updates.'};
        }
    });
    ipcMain.handle(SettingsChannels.updates.GET_PREFERENCES, () => ({
        autoCheck: settings.get('updates.autoCheck', false),
        channel: settings.get('updates.channel', 'stable'),
    }));
    ipcMain.handle(SettingsChannels.updates.SAVE_PREFERENCES, (_event, preferences) => {
        if (!preferences || typeof preferences.autoCheck !== 'boolean' || !['stable', 'prerelease'].includes(preferences.channel)) {
            throw new Error('Invalid update preferences.');
        }
        settings.set('updates', {autoCheck: preferences.autoCheck, channel: preferences.channel});
        return {success: true};
    });
    try {
        mainWindow = await createWindow();
    } catch (error) {
        logStartupError('window-creation', error, {
            isDev,
            platform: process.platform,
            arch: process.arch,
        });
        
        // Show error dialog and retry
        const response = await dialog.showMessageBox({
            type: 'error',
            title: 'Startup Error',
            message: 'Failed to create application window',
            detail: `Error: ${error.message}\n\nWould you like to retry?`,
            buttons: ['Retry', 'Quit'],
            defaultId: 0,
            cancelId: 1,
        });
        
        if (response.response === 0) {
            // Retry window creation
            try {
                mainWindow = await createWindow();
            } catch (retryError) {
                logStartupError('window-creation-retry', retryError);
                app.quit();
                return;
            }
        } else {
            app.quit();
            return;
        }
    }

    const openSettings = (tab = 'general') => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('app:open-settings', {tab, checkNow: tab === 'updates'});
    };
    const appMenu = [
        ...(process.platform === 'darwin' ? [{
            label: app.getName(),
            submenu: [
                {role: 'about'},
                {type: 'separator'},
                {label: 'Check for Updates…', click: () => openSettings('updates')},
                {type: 'separator'},
                {label: 'Settings…', accelerator: 'Command+,', click: () => openSettings('general')},
                {type: 'separator'},
                {role: 'services'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'},
                {type: 'separator'}, {role: 'quit'},
            ],
        }] : []),
        {label: 'File', submenu: [{label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings('general')}, {type: 'separator'}, {role: 'close'}]},
        {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
        {label: 'View', submenu: [{role: 'reload'}, {role: 'forceReload'}, {role: 'toggleDevTools'}, {type: 'separator'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {type: 'separator'}, {role: 'togglefullscreen'}]},
        {label: 'Window', submenu: [{role: 'minimize'}, {role: 'zoom'}, {role: 'front'}]},
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));

    mainWindow.on('closed', () => {
        PluginManager.setMainWindow(null)
        mainWindow = null;
    });

    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
            PluginManager.setMainWindow(mainWindow)
        }
    })

    app.on('open-url', (event, url) => {
        dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
    })

    let lastPersistedRuntime = 0;
    const runtimeSessionId = crypto.randomUUID();
    runtimeMetricsTimer = setInterval(() => {
        const metrics = app.getAppMetrics(), date = Date.now();
        AppMetrics.push({date, metrics});
        if (AppMetrics.length > MAX_METRICS) AppMetrics.shift();
        if (date - lastPersistedRuntime >= 10000) {
            lastPersistedRuntime = date;
            const pluginsByPid = new Map(Object.entries(PluginManager.loadedPlugins || {}).map(([id, plugin]) => [plugin.instance?.pid, id]));
            recordRuntimeSamples({createdAt: date, sessionId: runtimeSessionId, metrics: metrics.map(metric => ({
                pluginId: pluginsByPid.get(metric.pid) || (metric.name?.startsWith('plugin-') ? metric.name.slice(7) : null),
                metric: {pid: metric.pid, type: metric.type, name: metric.name || '', cpu: metric.cpu, memory: metric.memory},
            }))});
        }
    }, 1000);

    registerNotificationHandlers();
    registerSettingsHandlers();
    registerHostServiceSettings({ipcMain, getMainWindow: () => PluginManager.mainWindow,
        getPlugins: () => new PluginORM(PLUGINS_REGISTRY_FILE).getAllPlugins()});
    const gitops = registerGitOpsHandlers({ipcMain, settings, safeStorage, getMainWindow: () => PluginManager.mainWindow,
        sync: async ({source, secret, pluginName, pruneOnly}) => {
            const {updatedPlugins, createdPlugins, ...result} = await syncCollection({source, secret, pluginName, pruneOnly, pluginsDir: PLUGINS_DIR, registryFile: PLUGINS_REGISTRY_FILE,
                fetchPlugin: readPluginRepository, build: buildUsingEsbuild, normalizeMetadata: normalizeAndValidatePluginMetadata,
                sign: (home, label) => Certs.signPlugin(home, label), verifySignature: home => Certs.verifyPlugin(home), runtime: PluginManager,
                activatedIds: () => new UserORM(USER_CONFIG_FILE).getActivatedPlugins(),
                removeActivated: ids => {
                    for (const id of ids) removeHostServices(id);
                    if (!ids.length) return;
                    const user = new UserORM(USER_CONFIG_FILE);
                    user.set('config', {...user.get('config'), plugins: user.getActivatedPlugins().filter(id => !ids.includes(id))});
                }});
            for (const plugin of [...createdPlugins.map(item => ({...item, imported:true})), ...updatedPlugins]) {
                // NotificationCenter reports storage failures independently of a successful plugin update.
                void NotificationCenter.addNotification({
                    title: `${pluginDisplayName(new PluginORM(PLUGINS_REGISTRY_FILE).getPlugin(plugin.id), plugin.name)} ${plugin.imported ? 'imported' : 'updated'} via GitOps`, type: 'success', source: 'gitops',
                    message: plugin.imported ? `Version ${plugin.version} was installed inactive with no granted capabilities. Review it in Manage Plugins before enabling it.`
                        : `Version ${plugin.version} is installed.${plugin.reloaded ? ' The running plugin was restarted with the update.' : ' Its activation state was preserved.'}`,
                    details: `Collection: ${source.manifest?.metadata?.displayName || source.manifest?.metadata?.name || source.url}\nVersion: ${plugin.version}\nRevision: ${plugin.targetRevision}\nCommit: ${plugin.commit}\nRepository: ${plugin.repository}`,
                    actions: [{kind: plugin.imported ? 'manage-plugin' : 'view-plugin', pluginId: plugin.id}, {kind: 'view-gitops', repositoryId: source.id},
                        {kind: 'open-repository', url: plugin.repository}],
                });
            }
            return result;
        },
        review: async ({source,pluginName,reviewId,decision,capabilities}) => {
            const result=await decideGitOpsUpdate({source,sourceId:source.id,pluginName,reviewId,decision,capabilities,
                registryFile:PLUGINS_REGISTRY_FILE,pluginsDir:PLUGINS_DIR,verifySignature:home=>Certs.verifyPlugin(home),runtime:PluginManager,
                activatedIds:()=>new UserORM(USER_CONFIG_FILE).getActivatedPlugins()});
            if(result.state!=='checking')void NotificationCenter.addNotification({source:'gitops',type:result.state==='synced'?'success':'info',status:'resolved',
                groupKey:`gitops-review:${source.id}:${result.plugin.id}`,
                title:`${pluginDisplayName(result.plugin)} update ${result.state==='synced'?'approved':'declined'}`,
                message:result.state==='synced'?`Version ${result.plugin.metadata.version} was applied with the explicitly approved permissions.`:'This version was declined. The previous version and its permissions were kept.',
                actions:[{kind:'view-gitops',repositoryId:source.id},{kind:'manage-plugin',pluginId:result.plugin.id}]});
            return {state:result.state,commit:result.state==='declined'?result.pending.commit:result.plugin.gitops.commit};
        },
        detach: id => detachCollection(PLUGINS_REGISTRY_FILE, id),
        report: notification => NotificationCenter.addNotification(notification),
        notify: () => {
            const window = PluginManager.mainWindow;
            if (!window || window.isDestroyed()) return;
            window.webContents.send(SettingsChannels.gitops.UPDATED);
        },
    });
    app.once('before-quit', () => gitops.stop());
    registerSystemHandlers();
    registerPluginHandlers();
    await registerAiUsageHandlers();
    observabilityHandlers = registerObservabilityHandlers({ipcMain});
    registerAiChatHandlers();
    registerAiCodingAgentHandlers();
    registerAiCodingActivityHandlers({rendererUrl: MAIN_WINDOW_WEBPACK_ENTRY});

    const skipE2ECertBootstrap = process.env.FDO_E2E === "1" && process.env.FDO_E2E_MULTI_INSTANCE === "1";
    if (!skipE2ECertBootstrap) {
        const allRoots = certificateStorage.list('root');
        const rootCert = allRoots.find(cert =>
            cert.label === 'root' &&
            cert.cert &&
            cert.hasPrivateKey
        );

        if (rootCert) {
            const days = Certs.daysUntilExpiry(rootCert.cert);

            if (days < Certs.EXPIRY_THRESHOLD_DAYS) {
                try {
                    await Certs.generateRootCA('root', true);
                } catch (e) {
                    log.warn('❌ Failed to regenerate "FDO Root Certificate":', e);
                    NotificationCenter.addNotification(failureNotification({source: 'security', title: 'The default signing certificate could not be renewed', message: 'FDO could not prepare its signing identity. Unlock your OS credential store or check disk access, then restart FDO.', error: e, actions: [{kind: 'view-settings', tab: 'certificates'}]}));
                    dialog.showErrorBox('Could not renew the signing certificate', e.message);
                    app.quit();
                }
            }
        } else {
            try {
                await Certs.generateRootCA('root', false, {onlyIfMissing: true});
            } catch (e) {
                log.warn('❌ Failed to generate "FDO Root Certificate":', e);
                NotificationCenter.addNotification(failureNotification({source: 'security', title: 'The default signing certificate could not be created', message: 'FDO could not prepare its signing identity. Unlock your OS credential store or check disk access, then restart FDO.', error: e, actions: [{kind: 'view-settings', tab: 'certificates'}]}));
                dialog.showErrorBox('Could not create the signing certificate', e.message);
                app.quit();
            }
        }
    }

    if (!existsSync(PLUGINS_DIR)) {
        mkdirSync(PLUGINS_DIR, {recursive: true});
    }

    PluginManager.setUserConfigFile(USER_CONFIG_FILE)
    PluginManager.setPluginsRegistryFile(PLUGINS_REGISTRY_FILE)
    await PluginManager.loadPlugins()
    cliDeploymentReady = true;
    for (const id of pendingCliDeployments) await reloadCliDeployment(id);
    pendingCliDeployments.clear();
    gitops.start();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    recordE2EWindowLifecycle("window-all-closed");
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let storageDrained = false;
let storageDrainStarted = false;
app.on('before-quit', () => {
    pluginTray.dispose();
    isAppShuttingDown = true;
    recordE2EWindowLifecycle("app-before-quit");
    interruptAllCodexAuthProcesses();
});

app.on("will-quit", (event) => {
    recordE2EWindowLifecycle("app-will-quit");
    if (storageDrained) closeCertificateStorage();
    // Windows can cancel quitting (for example, an unsaved editor). Keep the
    // stores usable until every window has accepted closing.
    if (!storageDrained) {
        event.preventDefault();
        if (storageDrainStarted) return;
        storageDrainStarted = true;
        clearInterval(runtimeMetricsTimer);
        Promise.resolve(observabilityHandlers?.stop()).then(async () => {
            await PluginManager.drainPluginWorkers();
            try {await usageLedger.flush();} catch (error) {console.error('Usage persistence failed:', error.message);}
            return Promise.allSettled([closeHostServices(), closeNotificationStorage(), closeChatStorage(), closeObservabilityStorage()]);
        }).then(results => {
            for (const result of results) if (result.status === 'rejected') console.error('Storage shutdown failed:', result.reason);
        })
            .finally(() => { storageDrained = true; app.quit(); });
    }
});

}
