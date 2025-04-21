import {BrowserWindow} from "electron";

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