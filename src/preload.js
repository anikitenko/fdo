import {contextBridge, ipcRenderer} from 'electron'
import {NotificationChannels, PluginChannels, SettingsChannels, SystemChannels} from "./ipc/channels";

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
        on: {
            updated: (callback) => ipcRenderer.on(NotificationChannels.on_off.UPDATED, callback)
        },
        off: {
            updated: (callback) => ipcRenderer.removeListener(NotificationChannels.on_off.UPDATED, callback),
        }
    },
    settings: {
        certificates: {
            getRoot: () => ipcRenderer.invoke(SettingsChannels.certificates.GET_ROOT),
            create: () => ipcRenderer.invoke(SettingsChannels.certificates.CREATE),
            rename: (id, newName) => ipcRenderer.invoke(SettingsChannels.certificates.RENAME, id, newName),
            export: (id) => ipcRenderer.invoke(SettingsChannels.certificates.EXPORT, id),
            import: (file) => ipcRenderer.invoke(SettingsChannels.certificates.IMPORT, file),
            delete: (file) => ipcRenderer.invoke(SettingsChannels.certificates.DELETE, file),
            renew: (label) => ipcRenderer.invoke(SettingsChannels.certificates.RENEW, label),
        }
    },
    system:{
        openExternal: (url) => ipcRenderer.send(SystemChannels.OPEN_EXTERNAL_LINK, url),
        getPluginMetric: (id, fromTime, toTime) => ipcRenderer.invoke(SystemChannels.GET_PLUGIN_METRIC, id, fromTime, toTime),
        openFileDialog: (params) => ipcRenderer.invoke(SystemChannels.OPEN_FILE_DIALOG, params),
        openEditorWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_EDITOR_WINDOW, data),
        openLiveUiWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_LIVE_UI_WINDOW, data),
        getModuleFiles: () => ipcRenderer.invoke(SystemChannels.GET_MODULE_FILES),
        getBabelPath: () => ipcRenderer.invoke(SystemChannels.GET_BABEL_PATH),
        confirmEditorCloseApproved: () => ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED),
        confirmEditorReloadApproved: () => ipcRenderer.send(SystemChannels.EDITOR_RELOAD_APPROVED),
        openPluginInEditor: (editor, pluginID) => ipcRenderer.invoke(SystemChannels.OPEN_PLUGIN_IN_EDITOR, editor, pluginID),
        on: {
            confirmEditorClose: (callback) => ipcRenderer.on(SystemChannels.on_off.CONFIRM_CLOSE, callback),
            confirmEditorReload: (callback) => ipcRenderer.on(SystemChannels.on_off.CONFIRM_RELOAD, callback),
        },
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
        deployToMainFromEditor: (data) => ipcRenderer.invoke(PluginChannels.DEPLOY_FROM_EDITOR, data),
        saveAndCloseFromEditor: (data) => ipcRenderer.invoke(PluginChannels.SAVE_FROM_EDITOR, data),
        build: (data) => ipcRenderer.invoke(PluginChannels.BUILD, data),
        init: (id) => ipcRenderer.invoke(PluginChannels.INIT, id),
        render: (id) => ipcRenderer.invoke(PluginChannels.RENDER, id),
        uiMessage: (id, content) => ipcRenderer.invoke(PluginChannels.UI_MESSAGE, id, content),
        verifySignature: (id) => ipcRenderer.invoke(PluginChannels.VERIFY_SIGNATURE, id),
        sign: (id, signerLabel) => ipcRenderer.invoke(PluginChannels.SIGN, id, signerLabel),
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
})
