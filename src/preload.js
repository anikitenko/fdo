// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import {contextBridge, ipcRenderer} from 'electron'

contextBridge.exposeInMainWorld('electron', {
    versions: {
        node: () => process.versions.node,
        chrome: () => process.versions.chrome,
        electron: () => process.versions.electron
    },
    OpenExternal: (url) => ipcRenderer.send("open-external-link", url),
    GetPluginMetric: (id, fromTime, toTime) => ipcRenderer.invoke('get-plugin-metric', id, fromTime, toTime),
    OpenFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    GetPluginData: (filePath) => ipcRenderer.invoke('get-plugin-data', filePath),
    SavePlugin: (content) => ipcRenderer.invoke('save-plugin', content),
    RemovePlugin: (id) => ipcRenderer.invoke('remove-plugin', id),
    GetAllPlugins: () => ipcRenderer.invoke('get-all-plugins'),
    GetPlugin: (data) => ipcRenderer.invoke('get-plugin', data),
    GetActivatedPlugins: () => ipcRenderer.invoke('get-activated-plugins'),
    ActivatePlugin: (id) => ipcRenderer.invoke('activate-plugin', id),
    DeactivatePlugin: (id) => ipcRenderer.invoke('deactivate-plugin', id),
    DeactivateUserPlugin: (id) => ipcRenderer.invoke('deactivate-user-plugin', id),
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
    GetBabelPath: () => ipcRenderer.invoke('get-babel-path'),
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
    onPluginReady: (callback) =>
        ipcRenderer.on("plugin-ready", (_, id) => {callback(id)}),
    offPluginReady: (callback) =>
        ipcRenderer.removeListener("plugin-ready", callback),
    pluginInit: (id) => ipcRenderer.invoke('plugin-init', id),
    pluginRender: (id) => ipcRenderer.invoke('plugin-render', id),
    onPluginInit: (callback) =>
        ipcRenderer.on("on-plugin-init", (_, id) => {callback(id)}),
    offPluginInit: (callback) =>
        ipcRenderer.removeListener("on-plugin-init", callback),
    onPluginRender: (callback) =>
        ipcRenderer.once("on-plugin-render", (_, id) => {callback(id)}),
    offPluginRender: (callback) =>
        ipcRenderer.removeListener("on-plugin-render", callback),
    pluginUiMessage: (id, content) => ipcRenderer.invoke('plugin-ui-message', id, content),
    onPluginUiMessage: (callback) =>
        ipcRenderer.once("on-plugin-ui-message", (_, id) => {callback(id)}),
    offPluginUiMessage: (callback) =>
        ipcRenderer.removeListener("on-plugin-ui-message", callback),
    openLiveUiWindow: (data) => ipcRenderer.send('open-live-ui-window', data),
})
