// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import {contextBridge, ipcRenderer} from 'electron'

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
    GetPlugin: (data) => ipcRenderer.invoke('get-plugin', data),
    GetActivatedPlugins: () => ipcRenderer.invoke('get-activated-plugins'),
    ActivatePlugin: (id) => ipcRenderer.invoke('activate-plugin', id),
    DeactivatePlugin: (id) => ipcRenderer.invoke('deactivate-plugin', id),
    DeactiveUserPlugin: (id) => ipcRenderer.invoke('deactivate-user-plugin', id),
    DeactivateAllPlugins: () => ipcRenderer.invoke('deactivate-all-plugins'),
    loadPlugin: (id) => ipcRenderer.send("load-plugin", id),
    onPluginLoaded: (callback) =>
        ipcRenderer.on("plugin-loaded", (_, plugin) => {callback(plugin)}),
    offPluginLoaded: (callback) =>
        ipcRenderer.removeListener('plugin-loaded', callback),
    onPluginUnLoaded: (callback) =>
        ipcRenderer.on("plugin-unloaded", (_, plugin) => callback(plugin)),
    offPluginUnLoaded: (callback) =>
        ipcRenderer.removeListener('plugin-unloaded', callback),
    openEditorWindow: (data) => ipcRenderer.send('open-editor-window', data),
    GetModuleFiles: () => ipcRenderer.invoke('get-module-files'),
    onConfirmEditorClose: (callback) => ipcRenderer.on('confirm-close', callback),
    onConfirmEditorReload: (callback) => ipcRenderer.on('confirm-reload', callback),
    confirmEditorCloseApproved: () => ipcRenderer.send('approve-editor-window-close'),
    confirmEditorReloadApproved: () => ipcRenderer.send('approve-editor-window-reload'),
    getEsbuildWasmPath: () => ipcRenderer.invoke('get-esbuild-wasm-path'),
    deployToMainFromEditor: (data) => ipcRenderer.invoke('deploy-to-main-from-editor', data),
    onDeployFromEditor: (callback) =>
        ipcRenderer.on("deploy-from-editor", (_, id) => {callback(id)}),
    offDeployFromEditor: (callback) =>
        ipcRenderer.removeListener('deploy-from-editor', callback),
    Build: (data) => ipcRenderer.invoke('build', data),
})
