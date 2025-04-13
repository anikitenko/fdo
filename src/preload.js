import {contextBridge, ipcRenderer} from 'electron'
import {NotificationChannels, PluginChannels, SystemChannels} from "./ipc/channels";

contextBridge.exposeInMainWorld('electron', {
    versions: {
        node: () => process.versions.node,
        chrome: () => process.versions.chrome,
        electron: () => process.versions.electron
    },
    notifications: {
        get: () => ipcRenderer.invoke(NotificationChannels.GET_ALL),
        add: (title, body, type) => ipcRenderer.invoke(NotificationChannels.ADD, title, body, type),
        markAsRead: (id) => ipcRenderer.invoke(NotificationChannels.MARK_AS_READ, id),
        markAllAsRead: () => ipcRenderer.invoke(NotificationChannels.MARK_ALL_AS_READ),
        remove: (id) => ipcRenderer.invoke(NotificationChannels.REMOVE, id),
        removeAll: () => ipcRenderer.invoke(NotificationChannels.REMOVE_ALL),
    },
    system:{
        openExternal: (url) => ipcRenderer.send(SystemChannels.OPEN_EXTERNAL_LINK, url),
        getPluginMetric: (id, fromTime, toTime) => ipcRenderer.invoke(SystemChannels.GET_PLUGIN_METRIC, id, fromTime, toTime),
        openFileDialog: () => ipcRenderer.invoke(SystemChannels.OPEN_FILE_DIALOG),
        openEditorWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_EDITOR_WINDOW, data),
        openLiveUiWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_LIVE_UI_WINDOW, data),
        getModuleFiles: () => ipcRenderer.invoke(SystemChannels.GET_MODULE_FILES),
        getBabelPath: () => ipcRenderer.invoke(SystemChannels.GET_BABEL_PATH),
    },
    plugin: {
        getData: (filePath) => ipcRenderer.invoke(PluginChannels.GET_DATA, filePath),
        save: (content) => ipcRenderer.invoke(PluginChannels.SAVE, content),
        remove: (id) => ipcRenderer.invoke(PluginChannels.REMOVE, id),
        getAll: () => ipcRenderer.invoke(PluginChannels.GET_ALL),
        get: (data) => ipcRenderer.invoke(PluginChannels.GET, data),
        getActivated: () => ipcRenderer.invoke(PluginChannels.GET_ACTIVATED),
        activate: (id) => ipcRenderer.invoke(PluginChannels.ACTIVATE, id),
        deactivate: (id) => ipcRenderer.invoke(PluginChannels.DEACTIVATE, id),
        deactivateUsers: (id) => ipcRenderer.invoke(PluginChannels.DEACTIVATE_USERS, id),
        deactivateAll: () => ipcRenderer.invoke(PluginChannels.DEACTIVATE_ALL),
        on: {
            unloaded: (callback) =>
                ipcRenderer.on(PluginChannels.on_off.UNLOADED, (_, plugin) => callback(plugin)),
            ready: (callback) =>
                ipcRenderer.on(PluginChannels.on_off.READY, (_, id) => {callback(id)}),
            deployFromEditor: (callback) =>
                ipcRenderer.on(PluginChannels.on_off.DEPLOY_FROM_EDITOR, (_, id) => {callback(id)}),
            init: (callback) =>
                ipcRenderer.on(PluginChannels.on_off.INIT, (_, id) => {callback(id)}),
            render: (callback) =>
                ipcRenderer.once(PluginChannels.on_off.RENDER, (_, id) => {callback(id)}),
            uiMessage: (callback) =>
                ipcRenderer.once(PluginChannels.on_off.UI_MESSAGE, (_, id) => {callback(id)}),
        },
        off: {
            unloaded: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.UNLOADED, callback),
            ready: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.READY, callback),
            deployFromEditor: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.DEPLOY_FROM_EDITOR, callback),
            init: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.INIT, callback),
            render: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.RENDER, callback),
            uiMessage: (callback) =>
                ipcRenderer.removeListener(PluginChannels.on_off.UI_MESSAGE, callback),
        }
    },
    onConfirmEditorClose: (callback) => ipcRenderer.on('confirm-close', callback),
    onConfirmEditorReload: (callback) => ipcRenderer.on('confirm-reload', callback),
    confirmEditorCloseApproved: () => ipcRenderer.send('approve-editor-window-close'),
    confirmEditorReloadApproved: () => ipcRenderer.send('approve-editor-window-reload'),
    deployToMainFromEditor: (data) => ipcRenderer.invoke('deploy-to-main-from-editor', data),
    saveAndCloseFromEditor: (data) => ipcRenderer.invoke('save-and-close-from-editor', data),
    Build: (data) => ipcRenderer.invoke('build', data),
    pluginInit: (id) => ipcRenderer.invoke('plugin-init', id),
    pluginRender: (id) => ipcRenderer.invoke('plugin-render', id),
    pluginUiMessage: (id, content) => ipcRenderer.invoke('plugin-ui-message', id, content),
})
