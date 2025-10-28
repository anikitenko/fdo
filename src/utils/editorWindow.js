import {app, BrowserWindow} from "electron";
import path from "node:path";

const isDev = !app.isPackaged;

const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY = isDev
    ? path.join(__dirname, '..', '..', 'dist', 'main', 'preload.js')
    : path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'preload.js');

/**
 * Validates if a window reference is valid and not destroyed
 * @param {BrowserWindow|null} window - The window instance to validate
 * @returns {boolean} True if window is valid and not destroyed
 */
export function isWindowValid(window) {
    return window !== null && !window.isDestroyed();
}

/**
 * Cleans up window-related resources including IPC handlers and timeouts
 * @param {object} options - Cleanup options
 * @param {NodeJS.Timeout} options.timeoutId - Timeout ID to clear (optional)
 * @param {Function[]} options.ipcHandlers - Array of IPC handler removal functions (optional)
 */
export function cleanupWindowResources(options = {}) {
    const { timeoutId, ipcHandlers } = options;
    
    // Clear any active timeouts
    if (timeoutId) {
        clearTimeout(timeoutId);
    }
    
    // Remove IPC handlers
    if (ipcHandlers && Array.isArray(ipcHandlers)) {
        ipcHandlers.forEach(removeHandler => {
            if (typeof removeHandler === 'function') {
                removeHandler();
            }
        });
    }
}

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
    },

    /**
     * Validates the current editor window
     * @returns {boolean} True if current window is valid
     */
    isValid() {
        return isWindowValid(this.window);
    }
}