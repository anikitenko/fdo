import {app, BrowserWindow} from "electron";
import path from "node:path";

const isDev = !app.isPackaged;

const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY = isDev
    ? path.join(__dirname, '..', '..', 'dist', 'main', 'preload.js')
    : path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'preload.js');

export const editorWindow = {
    window: null,

    createWindow() {
        this.window = new BrowserWindow({
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

        return this.window
    },

    nullWindow() {
        this.window = null
    },

    getWindow() {
        return this.window
    }
}