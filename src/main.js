import {app, BrowserWindow, dialog, nativeTheme, net, protocol, session} from 'electron';
import nodeUrl from 'node:url';
import started from 'electron-squirrel-startup';
import PluginManager from "./utils/PluginManager";
import fs, {existsSync, mkdirSync} from "node:fs";

import nodePath from "node:path";

import {styleText} from 'node:util';

import {settings} from "./utils/store";
import {Certs} from "./utils/certs";

import {registerNotificationHandlers} from "./ipc/notifications";
import {registerSystemHandlers} from "./ipc/system";
import {buildUsingEsbuild, registerPluginHandlers} from "./ipc/plugin";
import {registerSettingsHandlers} from "./ipc/settings";
import {NotificationCenter} from "./utils/NotificationCenter";
import {readFile} from "node:fs/promises";

import mime from 'mime';
import {Command} from 'commander';
import {getIgnoreInstance} from "./utils/getIgnoreInstance";
import { hasCliCommand, hasCliOnlyCommand, getCleanCliArgs } from "./utils/cliCommands.js";
import {getAllFilesWithIgnorance} from "./utils/getAllFilesWithIgnorance";
import ensureAndWrite from "./utils/ensureAndWrite";

import PluginORM from "./utils/PluginORM";
import generatePluginName from "./components/editor/utils/generatePluginName";
import {PluginChannels} from "./ipc/channels";
import {checkPathAccess} from "./utils/pathHelper";

import log from 'electron-log/main';
import {extractMetadata} from "./utils/extractMetadata";
import {initMetrics, logMetric, logStartupError, checkSlowStartupWarning} from "./utils/startupMetrics";
import {ipcMain} from 'electron';
import {StartupChannels} from "./ipc/channels";
import {registerAiChatHandlers} from "./ipc/ai/ai_chat";
import {registerAiCodingAgentHandlers} from "./ipc/ai_coding_agent";

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

// Initialize startup metrics (must be early)
initMetrics();

// IPC handler for renderer process metrics
ipcMain.on(StartupChannels.LOG_METRIC, (event, metricEvent, metadata) => {
    logMetric(metricEvent, metadata);
});

// Constants for electron-builder (replaces Forge webpack entries)
const isDev = !app.isPackaged;
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
export const getPluginsDir = () => nodePath.join(app.getPath('userData'), 'plugins');
export const getUserConfigFile = () => nodePath.join(app.getPath('userData'), 'config.json');
export const getPluginsRegistryFile = () => nodePath.join(app.getPath('userData'), 'plugins.json');

// For backwards compatibility, keep these as constants that will be initialized when used
// (they'll be calculated lazily on first access after app is ready)
export let PLUGINS_DIR;
export let USER_CONFIG_FILE;
export let PLUGINS_REGISTRY_FILE;

export const AppMetrics = [];
export const MAX_METRICS = 86400;

let actionInProgress = false;
let SIGNAL_FILE;
let FAIL_FILE;

// Initialize paths once app is ready
function initializePaths() {
    PLUGINS_DIR = getPluginsDir();
    USER_CONFIG_FILE = getUserConfigFile();
    PLUGINS_REGISTRY_FILE = getPluginsRegistryFile();
    SIGNAL_FILE = nodePath.join(app.getPath('userData'), 'deployment-finished.signal');
    FAIL_FILE = nodePath.join(app.getPath('userData'), 'deployment-failed.signal');
}

function getValidCommandFromArgs(args, knownCommands) {
    // Skip the first arg (binary) and any Electron flags
    const filtered = args.filter(arg => !arg.startsWith('--'));
    return knownCommands.find(cmd => filtered.includes(cmd)) || null;
}

async function compilePluginCLI(path) {
    console.log(styleText('bold', '🔧 Compiling plugin...'));
    console.log(styleText('cyan', `📂 Plugin path: ${path}`));
    console.log(styleText('italic', '🛠️  Preparing build environment...'));
    const ig = await getIgnoreInstance(path, []);

    const existingFiles = await getAllFilesWithIgnorance(path, (relativePath) => {
        return !ig.ignores(relativePath);
    });

    const virtualData = Object.fromEntries(
        existingFiles.map(filePath => {
            const content = fs.readFileSync(filePath, 'utf-8');
            const relativePath = '/' + nodePath.relative(path, filePath).replace(/\\/g, '/');
            return [relativePath, content];
        })
    );

    console.log(styleText('bold', '🏗️  Building...'));
    const result = await buildUsingEsbuild(virtualData)
    const srcJson = JSON.parse(virtualData["/package.json"])
    const entryPoint = srcJson.module || srcJson.main || "dist/index.cjs"
    const pathToPlugin = nodePath.join(path, entryPoint)
    await ensureAndWrite(pathToPlugin, result.outputFiles[0].text)
    console.log(styleText('green', `✅ Saved to: ${pathToPlugin}`));

    const sourceFile = srcJson.source || "index.ts"
    const sourceFileContent = virtualData[`/${sourceFile}`]
    const match = await extractMetadata(sourceFileContent)

    if (!match) return null;
    return {
        metadata: {
            name: match.name,
            version: match.version,
            author: match.author,
            description: match.description,
            icon: match.icon,
        },
        entryPoint: entryPoint,
        name: generatePluginName(srcJson.name)
    }
}

function signPluginCLI(path, label) {
    console.log(styleText('italic', `🔏 Signing plugin at ${path} with certificate "${label}"`));
    Certs.signPlugin(path, label)
}

// Early exit for Windows installer events (squirrel)
// The 'started' variable was imported from 'electron-squirrel-startup' at the top
debugLog(`[MAIN] Squirrel started: ${started}`);
if (started) {
    debugLog('[MAIN] Quitting due to squirrel startup');
    app.quit();
}

const program = new Command();

const colorHelp = {
    styleTitle: (str) => styleText('bold', str),
    styleCommandText: (str) => styleText('cyan', str),
    styleCommandDescription: (str) => styleText('magenta', str),
    styleDescriptionText: (str) => styleText('italic', str),
    styleOptionText: (str) => styleText('green', str),
    styleArgumentText: (str) => styleText('yellow', str),
    styleSubcommandText: (str) => styleText('blue', str),
}

program
    .name('fdo')
    .description('FlexDevOps (FDO) Application CLI')
    .version(app.getVersion())
    .allowUnknownOption(true); // Allow macOS arguments like -psn_X_XXXXX

program.configureHelp(colorHelp);

program
    .command('open')
    .description('Open FDO application')
    .action(() => {
        // This action will be executed when 'open' is explicitly called
        // If we reach here, we want to open the GUI (do nothing, let normal flow continue)
        debugLog('[MAIN] Open command called, will launch GUI');
    });

program
    .command('compile <path>')
    .description('Compile a plugin at the given path')
    .action(async (path) => {
        actionInProgress = true;

        try {
            const { resolvedPath, isProtected, platform } = await checkPathAccess(path);

            if (isProtected) {
                console.log(styleText('yellow', `⚠️ Accessing a protected directory on ${platform}:`));
                console.log(styleText('yellow', `   ${resolvedPath}`));
            }

            await compilePluginCLI(resolvedPath);
        } catch (e) {
            console.error(styleText('red', `❌ ${e.stack || e.toString()}`));
        }

        app.exit(0);
    });

program
    .command('deploy <path>')
    .description('Sign plugin with certificate label and deploy at the given path')
    .option('-l, --label <label>', 'Certificate label to use', 'root')
    .action(async (path, options) => {
        actionInProgress = true;
        const { label } = options;
        try {
            const { resolvedPath, isProtected, platform } = await checkPathAccess(path);

            if (isProtected) {
                console.log(styleText('yellow', `⚠️ Accessing a protected directory on ${platform}:`));
                console.log(styleText('yellow', `   ${resolvedPath}`));
            }

            const metadata = await compilePluginCLI(resolvedPath)
            signPluginCLI(resolvedPath, label)
            console.log(styleText('bold', '\n🚀 Starting deployment...'));
            console.log(styleText('italic', '🧷 Extracting plugin metadata...'));
            if (!metadata) {
                console.error(styleText('red', `❌ No metadata found`));
                fs.writeFileSync(FAIL_FILE, 'failed');
                app.exit(1);
            } else if (!metadata.name) {
                console.error(styleText('red', `❌ Cannot get name from package.json`));
                fs.writeFileSync(FAIL_FILE, 'failed');
                app.exit(1);
            } else if (!metadata.entryPoint) {
                console.error(styleText('red', `❌ Cannot get entrypoint from package.json`));
                fs.writeFileSync(FAIL_FILE, 'failed');
                app.exit(1);
            }

            console.log(styleText('italic', '🧩 Adding plugin to configuration...'));
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            pluginORM.addPlugin(metadata.name, metadata.metadata, resolvedPath, metadata.entryPoint, true)

            fs.writeFileSync(SIGNAL_FILE, metadata.name);

            console.log(styleText('green', '✅ Deployment completed successfully!'));
        } catch (e) {
            fs.writeFileSync(FAIL_FILE, 'failed');
            console.error(styleText('red', `❌ ${e.stack || e.toString()}`));
        }
        app.exit(0);
    });

const sign = new Command('sign')
    .description('Manage plugin signing')
    .action(() => {
        // If sign is called without subcommand, show help
        sign.help();
    });

sign.configureHelp(colorHelp);

sign
    .command('list')
    .description('List available signing certificates')
    .action(() => {
        actionInProgress = true;
        console.log(styleText('bold', '📜 Available certificates:'));
        try {
            const certificates = settings.get('certificates.root') || []
            for (const cert of certificates) {
                console.log(`  - ${cert.label} (${cert.id})`);
            }
        } catch (e) {
            console.error(styleText('red', `❌ ${e.stack || e.toString()}`));
        }
        app.exit(0);
    });

sign
    .command('plugin <path>')
    .description('Sign a plugin at the given path using specified cert')
    .option('-l, --label <label>', 'Certificate label to use', 'root')
    .action(async (path, options) => {
        actionInProgress = true;
        const { label } = options;
        try {
            const {resolvedPath, isProtected, platform} = await checkPathAccess(path);

            if (isProtected) {
                console.log(styleText('yellow', `⚠️ Accessing a protected directory on ${platform}:`));
                console.log(styleText('yellow', `   ${resolvedPath}`));
            }

            signPluginCLI(resolvedPath, label)
        } catch (e) {
            console.error(styleText('red', `❌ ${e.stack || e.toString()}`));
        }
        app.exit(0);
    });

program.addCommand(sign);

// Get CLI arguments (excluding electron/node and script path)
const cliArgs = getCleanCliArgs(process.argv);

// Check if we have CLI commands
const hasCommand = hasCliCommand(cliArgs);
const isCliOnlyCommand = hasCliOnlyCommand(cliArgs);

// In dev mode, also check if we're running via terminal (not GUI)
const isTerminalLaunch = process.stdin.isTTY || process.argv.includes('--cli');

debugLog(`[MAIN] CLI args: ${JSON.stringify(cliArgs)}`);
debugLog(`[MAIN] hasCommand: ${hasCommand}, isTerminalLaunch: ${isTerminalLaunch}, isCliOnlyCommand: ${isCliOnlyCommand}`);

if (hasCommand && (isTerminalLaunch || app.isPackaged)) {
    // Parse CLI only when we have explicit commands
    debugLog('[MAIN] Parsing CLI arguments...');
    
    // In packaged apps, process.argv includes the .asar path which commander
    // interprets as a command. We need to construct proper argv for commander.
    // Format: [executable, 'fdo', ...actualArgs]
    let commanderArgv;
    if (app.isPackaged) {
        // Packaged: process.argv = [executable, app.asar, ...args]
        // Commander needs: [executable, 'fdo', ...args]
        commanderArgv = [process.argv[0], 'fdo', ...process.argv.slice(2)];
    } else {
        // Dev: process.argv = [electron, app-path, ...args]
        // Commander can use default or we construct: [electron, 'fdo', ...args]
        commanderArgv = [process.argv[0], 'fdo', ...process.argv.slice(2)];
    }
    
    debugLog(`[MAIN] Commander argv: ${JSON.stringify(commanderArgv)}`);
    await program.parseAsync(commanderArgv);
    debugLog('[MAIN] CLI parsing complete');
    
    // If this was a CLI-only command, exit now without creating GUI
    if (isCliOnlyCommand) {
        debugLog('[MAIN] CLI-only command executed, exiting...');
        app.exit(0);
    }
} else if (cliArgs.length === 0) {
    // No arguments provided - default to opening GUI
    debugLog('[MAIN] No CLI arguments, will open GUI');
}

// Note: Squirrel startup is already handled at the top of the file (line 177)

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('fdo-fiddle', process.execPath, [nodePath.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('fdo-fiddle')
}

const gotTheLock = app.requestSingleInstanceLock()

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
    });

    // Capture renderer console errors
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
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
    debugLog('[MAIN] app.whenReady() fired!');
    
    // Initialize paths that require app.getPath('userData')
    initializePaths();
    debugLog('[MAIN] Paths initialized');
    
    if (actionInProgress) {
        debugLog('[MAIN] actionInProgress=true, returning early');
        return
    }

    logMetric('app-ready');

    log.eventLogger.startLogging()
    
    debugLog('[MAIN] About to create window...');

    let mainWindow;
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

    app.on('second-instance', (event, commandLine) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }

        const knownCommands = program.commands.map(cmd => cmd.name());
        const matchedCommand = getValidCommandFromArgs(commandLine, knownCommands);

        if (matchedCommand === 'deploy') {
            let attempts = 0;
            const maxAttempts = 60; // 60 * 500 ms = 30 seconds

            const interval = setInterval(() => {
                attempts++;

                if (fs.existsSync(SIGNAL_FILE)) {
                    const pluginName = fs.readFileSync(SIGNAL_FILE, 'utf-8');
                    clearInterval(interval);
                    fs.unlinkSync(SIGNAL_FILE); // clean up

                    mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, pluginName);

                } else if (fs.existsSync(FAIL_FILE)) {
                    clearInterval(interval);
                    fs.unlinkSync(FAIL_FILE);

                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                }

            }, 500);
        } else {
            // the commandLine is array of strings in which last element is deep link url
            dialog.showErrorBox('Welcome Back', `You arrived from: ${commandLine.pop()}`)
        }
    })

    app.on('open-url', (event, url) => {
        dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
    })

    session.defaultSession.protocol.handle("static", (req) => {
        const reqURL = new URL(req.url)
        const assetsPath = isDev
            ? nodePath.join(__dirname, '..', '..', 'dist', 'renderer', 'assets', reqURL.pathname)
            : nodePath.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'assets', reqURL.pathname);
        return net.fetch(nodeUrl.pathToFileURL(assetsPath).toString())
    })

    protocol.handle('plugin', async (request) => {
        try {
            const url = new URL(request.url);
            let relativePath = url.pathname;
            
            console.log('[PLUGIN PROTOCOL] Request:', request.url, 'Path:', relativePath);

            // Normalize special cases
            if (relativePath === '/' || relativePath === '/index.html') {
                relativePath = '/plugin_host.html';
            } else if (relativePath === '/plugin_host/index.js') {
                relativePath = '/index.js';
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
                    title: `Plugin loading`,
                    message: `Plugin file not found: ${request.url}`,
                    type: 'warning'
                });
                return new Response('File not found', { status: 404 });
            }

            NotificationCenter.addNotification({
                title: `Plugin loading`,
                message: `Unexpected error in plugin protocol handler: ${err.message}`,
                type: 'warning'
            });
            return new Response('Internal error', { status: 500 });
        }
    });

    setInterval(() => {
        const metrics = app.getAppMetrics();
        AppMetrics.push({date: Date.now(), metrics});

        if (AppMetrics.length > MAX_METRICS) {
            AppMetrics.shift();
        }
    }, 1000);

    registerNotificationHandlers();
    registerSettingsHandlers();
    registerSystemHandlers();
    registerPluginHandlers();
    registerAiChatHandlers();
    registerAiCodingAgentHandlers();

    const allRoots = settings.get('certificates.root') || [];
    const rootCert = allRoots.find(cert =>
        cert.label === 'root' &&
        cert.cert &&
        cert.key
    );

    if (rootCert) {
        const days = Certs.daysUntilExpiry(rootCert.cert);

        if (days < Certs.EXPIRY_THRESHOLD_DAYS) {
            NotificationCenter.addNotification({
                title: `FDO Root Certificate`,
                message: `⚠️ Expiring in ${Math.floor(days)} days. Regenerating...`,
                type: 'warning'
            });
            try {
                Certs.generateRootCA('root', true);
            } catch (e) {
                log.warn('❌ Failed to regenerate "FDO Root Certificate":', e);
                app.quit();
            }
        } else {
            NotificationCenter.addNotification({
                title: `FDO Root Certificate`,
                message: `✔ Valid for ${Math.floor(days)} more days.`
            });
        }
    } else {
        NotificationCenter.addNotification({
            title: `FDO Root Certificate`,
            message: `❌ Not found. Generating new...`,
            type: 'warning'
        });
        try {
            Certs.generateRootCA('root');
        } catch (e) {
            log.warn('❌ Failed to generate "FDO Root Certificate":', e);
            app.quit();
        }
    }

    if (!existsSync(PLUGINS_DIR)) {
        mkdirSync(PLUGINS_DIR, {recursive: true});
    }

    PluginManager.setUserConfigFile(USER_CONFIG_FILE)
    PluginManager.setPluginsRegistryFile(PLUGINS_REGISTRY_FILE)
    await PluginManager.loadPlugins()
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
