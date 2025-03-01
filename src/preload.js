// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import {contextBridge, dialog, ipcRenderer} from 'electron'

contextBridge.exposeInMainWorld('electron', {
    versions: {
        node: () => process.versions.node,
        chrome: () => process.versions.chrome,
        electron: () => process.versions.electron
    },
    OpenFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    GetPluginData: (filePath) => ipcRenderer.invoke('get-plugin-data', filePath),
    SavePlugin: (content) => ipcRenderer.invoke('save-plugin', content),
    GetAllPlugins: () => ipcRenderer.invoke('get-all-plugins'),
    GetActivatedPlugins: () => ipcRenderer.invoke('get-activated-plugins'),
    ActivatePlugin: (id) => ipcRenderer.invoke('activate-plugin', id),
    DeactivatePlugin: (id) => ipcRenderer.invoke('deactivate-plugin', id),
    DeactivateAllPlugins: () => ipcRenderer.invoke('deactivate-all-plugins'),
    loadPlugin: (id) => ipcRenderer.send("load-plugin", id),
    onPluginLoaded: (callback) =>
        ipcRenderer.on("plugin-loaded", (_, plugin) => callback(plugin)),
    onPluginUnLoaded: (callback) =>
        ipcRenderer.on("plugin-unloaded", (_, plugin) => callback(plugin)),
    openEditorWindow: (data) => ipcRenderer.send('open-editor-window', data),
    GetModuleFiles: () => ipcRenderer.invoke('get-module-files'),
    onConfirmEditorClose: (callback) => ipcRenderer.on('confirm-close', callback),
    onConfirmEditorReload: (callback) => ipcRenderer.on('confirm-reload', callback),
    confirmEditorCloseApproved: () => ipcRenderer.send('approve-editor-window-close'),
    confirmEditorReloadApproved: () => ipcRenderer.send('approve-editor-window-reload')
})
