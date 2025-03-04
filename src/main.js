import {app, BrowserWindow, dialog, ipcMain, nativeTheme, net, session} from 'electron';
import path from 'node:path';
import nodeUrl from 'node:url';
import started from 'electron-squirrel-startup';
import PluginManager from "./utils/PluginManager";
import {existsSync, mkdirSync} from "node:fs";

export const PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins');
export const USER_CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
export const PLUGINS_REGISTRY_FILE = path.join(app.getPath('userData'), 'plugins.json');

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

const getDefaultShell = () => {
    if (process.platform === "win32") {
        return "powershell.exe"; // Use PowerShell on Windows
    } else {
        return process.env.SHELL || "/bin/bash"; // Use default shell on Linux/macOS
    }
};

let mainWindow;
let editorWindow;

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
        // the commandLine is array of strings in which last element is deep link url
        dialog.showErrorBox('Welcome Back', `You arrived from: ${commandLine.pop()}`)
    })

    // Create mainWindow, load the rest of the app, etc...
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.whenReady().then(() => {
        createWindow();

        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        })

        session.defaultSession.protocol.handle("static", (req) => {
            const reqURL = new URL(req.url)
            return net.fetch(nodeUrl.pathToFileURL(path.join(app.getAppPath(), '.webpack/renderer', 'assets', reqURL.pathname)).toString())
        })
    });

    app.on('open-url', (event, url) => {
        dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
    })
}

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        icon: 'assets/desktop_icon.png',
        width: 1024,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    });

    // and load the index.html of the app.
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    nativeTheme.themeSource = 'dark';

    PluginManager.setMainWindow(mainWindow)
    PluginManager.setUserConfigFile(USER_CONFIG_FILE)
    PluginManager.setPluginsRegistryFile(PLUGINS_REGISTRY_FILE)
    PluginManager.loadPlugins()
};

const createEditorWindow = (data) => {
    editorWindow = new BrowserWindow({
        width: 1024,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    });

    const encodedData = encodeURIComponent(JSON.stringify(data));
    editorWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/editor?data=${encodedData}`);
}


app.on('open-url', (event, url) => {
    dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
})

if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, {recursive: true});
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('open-editor-window', (_event, data) => {
    createEditorWindow(data)

    /*const wss = new WebSocket.Server({noServer: true});

    // Attach WebSocket to Electron’s internal HTTP request handling
    editorWindow.webContents.session.on("upgrade", (request, socket, head) => {
        console.log("Intercepting WebSocket connection attempt...");
        if (request.url === "/terminal") {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request);
            });
        }
    });

    wss.on("connection", (ws) => {
        console.log("WebSocket connected");

        const shell = spawn(getDefaultShell(), [], {shell: true});

        shell.stdout.on("data", (data) => ws.send(data.toString()));
        shell.stderr.on("data", (data) => ws.send(data.toString()));
        shell.on("close", () => ws.close());

        ws.on("message", (msg) => shell.stdin.write(msg + "\n"));

        ws.on("close", () => {
            console.log("WebSocket disconnected");
            shell.kill();
        });
    });*/

    /*editorWindow.on('close', (event) => {
      event.preventDefault();
      editorWindow.webContents.send('confirm-close'); // Send event to React
    });
    editorWindow.webContents.on('before-input-event', (event, input) => {
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        editorWindow.webContents.send('confirm-reload');
      }
    });
    editorWindow.on('closed', () => (global.editorWindow = null));*/
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

import './cross.process.exports'
