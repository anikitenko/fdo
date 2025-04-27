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
import {getAllFilesWithIgnorance} from "./utils/getAllFilesWithIgnorance";
import ensureAndWrite from "./utils/ensureAndWrite";

import PluginORM from "./utils/PluginORM";
import generatePluginName from "./components/editor/utils/generatePluginName";
import {PluginChannels} from "./ipc/channels";
import {checkPathAccess} from "./utils/pathHelper";

import log from 'electron-log/main';
import {extractMetadata} from "./utils/extractMetadata";

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
        ? nodePath.join(process.resourcesPath, 'app.asar', '.webpack', 'renderer', 'plugin_host')
        : nodePath.join(__dirname, '..', 'renderer', 'plugin_host'); // dev mode fallback

    const safePath = decodeURIComponent(urlPath || '/index.html');
    return nodePath.join(baseDir, safePath);
}

export const PLUGINS_DIR = nodePath.join(app.getPath('userData'), 'plugins');
export const USER_CONFIG_FILE = nodePath.join(app.getPath('userData'), 'config.json');
export const PLUGINS_REGISTRY_FILE = nodePath.join(app.getPath('userData'), 'plugins.json');

export const AppMetrics = [];
export const MAX_METRICS = 86400;

let actionInProgress = false;
const SIGNAL_FILE = nodePath.join(app.getPath('userData'), 'deployment-finished.signal');
const FAIL_FILE = nodePath.join(app.getPath('userData'), 'deployment-failed.signal');

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

if (require('electron-squirrel-startup')) app.quit();

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

program.configureHelp(colorHelp);

program
    .command('open', {isDefault: true})
    .description('Open FDO application');

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
    .description('Manage plugin signing');

sign.configureHelp(colorHelp);

sign
    .command('list', {isDefault: true})
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

await program.parseAsync();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('fdo-fiddle', process.execPath, [nodePath.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('fdo-fiddle')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) app.quit()

const createWindow = async () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1024,
        height: 800,
        minWidth: 1024,
        minHeight: 800,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    });

    // and load the index.html of the app.
    await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    nativeTheme.themeSource = 'dark';

    PluginManager.setMainWindow(mainWindow)

    return mainWindow
};

app.whenReady().then(async () => {
    if (actionInProgress) {
        return
    }

    log.eventLogger.startLogging()

    let mainWindow = await createWindow();

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
        return net.fetch(nodeUrl.pathToFileURL(nodePath.join(app.getAppPath(), '.webpack', 'renderer', 'assets', reqURL.pathname)).toString())
    })

    protocol.handle('plugin', async (request) => {
        try {
            const url = new URL(request.url);
            let relativePath = url.pathname;

            // Normalize special cases
            if (relativePath === '/' || relativePath === '/index.html') {
                relativePath = '/index.html';
            } else if (relativePath === '/plugin_host/index.js') {
                relativePath = '/index.js';
            }

            const filePath = getPluginFilePath(relativePath);
            const data = await readFile(filePath);
            const mimeType = mime.getType(filePath) || 'text/plain';

            return new Response(data, {
                headers: {
                    'Content-Type': mimeType,
                },
            });
        } catch (err) {
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
