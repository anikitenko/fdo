import {app, BrowserWindow, session, net, ipcMain, nativeTheme} from 'electron';
import path from 'node:path';
import nodeUrl from 'node:url';
import started from 'electron-squirrel-startup';
import PluginManager from "./utils/PluginManager";
import {existsSync, mkdirSync} from "node:fs";

import  WebSocket from "ws";
import { spawn } from "child_process";

export const PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins');
export const USER_CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
export const PLUGINS_REGISTRY_FILE = path.join(app.getPath('userData'), 'plugins.json');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const getDefaultShell = () => {
  if (process.platform === "win32") {
    return "powershell.exe"; // Use PowerShell on Windows
  } else {
    return process.env.SHELL || "/bin/bash"; // Use default shell on Linux/macOS
  }
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  global.PLUGIN_MANAGER = new PluginManager(mainWindow, USER_CONFIG_FILE, PLUGINS_REGISTRY_FILE)

  ipcMain.on('open-editor-window', (_event, data) => {
    if (global.editorWindow) return; // Prevent multiple windows

    global.editorWindow = new BrowserWindow({
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
    global.editorWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/editor?data=${encodedData}`);

    const wss = new WebSocket.Server({ noServer: true });

    // Attach WebSocket to Electron’s internal HTTP request handling
    global.editorWindow.webContents.session.on("upgrade", (request, socket, head) => {
      console.log("Intercepting WebSocket connection attempt...");
      if (request.url === "/terminal") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    });

    wss.on("connection", (ws) => {
      console.log("WebSocket connected");

      const shell = spawn(getDefaultShell(), [], { shell: true });

      shell.stdout.on("data", (data) => ws.send(data.toString()));
      shell.stderr.on("data", (data) => ws.send(data.toString()));
      shell.on("close", () => ws.close());

      ws.on("message", (msg) => shell.stdin.write(msg + "\n"));

      ws.on("close", () => {
        console.log("WebSocket disconnected");
        shell.kill();
      });
    });

    /*global.editorWindow.on('close', (event) => {
      event.preventDefault();
      global.editorWindow.webContents.send('confirm-close'); // Send event to React
    });
    global.editorWindow.webContents.on('before-input-event', (event, input) => {
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        global.editorWindow.webContents.send('confirm-reload');
      }
    });
    global.editorWindow.on('closed', () => (global.editorWindow = null));*/
  });

  session.defaultSession.protocol.handle("static", (req) => {
    const reqURL = new URL(req.url)
    return net.fetch(nodeUrl.pathToFileURL(path.join(app.getAppPath(), '.webpack/renderer', 'assets', reqURL.pathname)).toString())
  })

};

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
  });

  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, {recursive: true});
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

import './cross.process.exports'
