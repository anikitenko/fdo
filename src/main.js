import {app, BrowserWindow, dialog, nativeTheme, net, session} from 'electron';
import path from 'node:path';
import nodeUrl from 'node:url';
import started from 'electron-squirrel-startup';
import PluginManager from "./utils/PluginManager";
import {existsSync, mkdirSync} from "node:fs";

import {settings} from "./utils/store";
import {Certs} from "./utils/certs";

import {registerNotificationHandlers} from "./ipc/notifications";
import {registerSystemHandlers} from "./ipc/system";
import {registerPluginHandlers} from "./ipc/plugin";

export const PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins');
export const USER_CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
export const PLUGINS_REGISTRY_FILE = path.join(app.getPath('userData'), 'plugins.json');

export const AppMetrics = [];
export const MAX_METRICS = 86400;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('fdo-fiddle', process.execPath, [path.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('fdo-fiddle')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) app.quit()

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        icon: 'assets/desktop_icon.png',
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
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).then(() => {});

    nativeTheme.themeSource = 'dark';

    PluginManager.setMainWindow(mainWindow)

    return mainWindow
};

app.whenReady().then(() => {
    const mainWindow = createWindow();

    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    })

    app.on('second-instance', (event, commandLine) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
        // the commandLine is array of strings in which last element is deep link url
        dialog.showErrorBox('Welcome Back', `You arrived from: ${commandLine.pop()}`)
    })

    app.on('open-url', (event, url) => {
        dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
    })

    session.defaultSession.protocol.handle("static", (req) => {
        const reqURL = new URL(req.url)
        return net.fetch(nodeUrl.pathToFileURL(path.join(app.getAppPath(), '.webpack/renderer', 'assets', reqURL.pathname)).toString())
    })

    setInterval(() => {
        const metrics = app.getAppMetrics();
        AppMetrics.push({ date: Date.now(), metrics });

        if (AppMetrics.length > MAX_METRICS) {
            AppMetrics.shift();
        }
    }, 1000);

    registerNotificationHandlers();
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
            console.warn(`⚠️ "FDO Root Certificate" is expiring in ${Math.floor(days)} days. Regenerating...`);
            try {
                Certs.generateRootCA('root', true);
            } catch (e) {
                console.warn('❌ Failed to regenerate "FDO Root Certificate":', e);
                app.quit();
            }
        } else {
            console.log(`✔ "FDO Root Certificate" is valid for ${Math.floor(days)} more days.`);
        }
    } else {
        console.warn('❌ "FDO Root Certificate" not found. Generating new...');
        try {
            Certs.generateRootCA('root');
        } catch (e) {
            console.warn('❌ Failed to generate "FDO Root Certificate":', e);
            app.quit();
        }
    }

    if (!existsSync(PLUGINS_DIR)) {
        mkdirSync(PLUGINS_DIR, {recursive: true});
    }

    PluginManager.setUserConfigFile(USER_CONFIG_FILE)
    PluginManager.setPluginsRegistryFile(PLUGINS_REGISTRY_FILE)
    PluginManager.loadPlugins()
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
