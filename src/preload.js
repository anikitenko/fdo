import {contextBridge, ipcRenderer} from 'electron'
import {NotificationChannels, PluginChannels, SettingsChannels, SystemChannels, StartupChannels, AiChatChannels, AiCodingAgentChannels} from "./ipc/channels";

const pluginListenerWrappers = {
    unloaded: new WeakMap(),
    ready: new WeakMap(),
    deployFromEditor: new WeakMap(),
    init: new WeakMap(),
    render: new WeakMap(),
    uiMessage: new WeakMap(),
};
const pluginListenerRegistry = {
    unloaded: new Set(),
    ready: new Set(),
    deployFromEditor: new Set(),
    init: new Set(),
    render: new Set(),
    uiMessage: new Set(),
};

function addPluginListener(key, channel, callback, projector = (value) => value) {
    const existing = pluginListenerWrappers[key].get(callback);
    if (existing) {
        ipcRenderer.removeListener(channel, existing);
        pluginListenerRegistry[key].delete(existing);
    }
    const wrapped = (_, payload) => {
        callback(projector(payload));
    };
    pluginListenerWrappers[key].set(callback, wrapped);
    pluginListenerRegistry[key].add(wrapped);
    ipcRenderer.on(channel, wrapped);
}

function removePluginListener(key, channel, callback) {
    const wrapped = pluginListenerWrappers[key].get(callback);
    if (!wrapped) {
        // Fallback cleanup for cross-context callback identity mismatches.
        // This prevents listener leaks (duplicate event delivery) in long-running sessions.
        for (const listener of pluginListenerRegistry[key]) {
            ipcRenderer.removeListener(channel, listener);
        }
        pluginListenerRegistry[key].clear();
        pluginListenerWrappers[key] = new WeakMap();
        return;
    }
    ipcRenderer.removeListener(channel, wrapped);
    pluginListenerWrappers[key].delete(callback);
    pluginListenerRegistry[key].delete(wrapped);
}

contextBridge.exposeInMainWorld('electron', {
    versions: {
        node: () => process.versions.node,
        chrome: () => process.versions.chrome,
        electron: () => process.versions.electron
    },
    startup: {
        logMetric: (event, metadata) => ipcRenderer.send(StartupChannels.LOG_METRIC, event, metadata)
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
    aiChat: {
        getSessions: () => ipcRenderer.invoke(AiChatChannels.SESSIONS_GET),
        createSession: (name) => ipcRenderer.invoke(AiChatChannels.SESSION_CREATE, name),
        renameSession: (id, name) => ipcRenderer.invoke(AiChatChannels.SESSION_RENAME, id, name),
        sendMessage: (data) => ipcRenderer.invoke(AiChatChannels.SEND_MESSAGE, data),
        getCapabilities: (model, provider, assistantId) => ipcRenderer.invoke(AiChatChannels.GET_CAPABILITIES, model, provider, assistantId),
        getPreferences: () => ipcRenderer.invoke(AiChatChannels.GET_PREFERENCES),
        savePreferences: (data) => ipcRenderer.invoke(AiChatChannels.SAVE_PREFERENCES, data),
        detectAttachmentType: (data) => ipcRenderer.invoke(AiChatChannels.DETECT_ATTACHMENT_TYPE, data),
        on: {
            streamDelta: (callback) => ipcRenderer.on(AiChatChannels.on_off.STREAM_DELTA, (_, data) => callback(data)),
            streamDone: (callback) => ipcRenderer.on(AiChatChannels.on_off.STREAM_DONE, (_, data) => callback(data)),
            streamError: (callback) => ipcRenderer.on(AiChatChannels.on_off.STREAM_ERROR, (_, data) => callback(data)),
            statsUpdate: (cb) => ipcRenderer.on(AiChatChannels.on_off.STATS_UPDATE, (_, data) => cb(data)),
            compressionStart: (cb) => ipcRenderer.on(AiChatChannels.on_off.COMPRESSION_START, (_, data) => cb(data)),
            compressionDone: (cb) => ipcRenderer.on(AiChatChannels.on_off.COMPRESSION_DONE, (_, data) => cb(data)),
        },
        off: {
            streamDelta: (callback) => ipcRenderer.removeListener(AiChatChannels.on_off.STREAM_DELTA, callback),
            streamDone: (callback) => ipcRenderer.removeListener(AiChatChannels.on_off.STREAM_DONE, callback),
            streamError: (callback) => ipcRenderer.removeListener(AiChatChannels.on_off.STREAM_ERROR, callback),
            statsUpdate: (cb) => ipcRenderer.removeListener(AiChatChannels.on_off.STATS_UPDATE, cb),
            compressionStart: (cb) => ipcRenderer.removeListener(AiChatChannels.on_off.COMPRESSION_START, cb),
            compressionDone: (cb) => ipcRenderer.removeListener(AiChatChannels.on_off.COMPRESSION_DONE, cb),
        }
    },
    aiCodingAgent: {
        routeJudge: (data) => ipcRenderer.invoke(AiCodingAgentChannels.ROUTE_JUDGE, data),
        generateCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.GENERATE_CODE, data),
        editCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.EDIT_CODE, data),
        explainCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.EXPLAIN_CODE, data),
        fixCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.FIX_CODE, data),
        smartMode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.SMART_MODE, data),
        planCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.PLAN_CODE, data),
        cancelRequest: (data) => ipcRenderer.invoke(AiCodingAgentChannels.CANCEL_REQUEST, data),
        on: {
            streamDelta: (callback) => ipcRenderer.on(AiCodingAgentChannels.on_off.STREAM_DELTA, (_, data) => callback(data)),
            streamDone: (callback) => ipcRenderer.on(AiCodingAgentChannels.on_off.STREAM_DONE, (_, data) => callback(data)),
            streamError: (callback) => ipcRenderer.on(AiCodingAgentChannels.on_off.STREAM_ERROR, (_, data) => callback(data)),
            streamCancelled: (callback) => ipcRenderer.on(AiCodingAgentChannels.on_off.STREAM_CANCELLED, (_, data) => callback(data)),
        },
        off: {
            streamDelta: (callback) => ipcRenderer.removeListener(AiCodingAgentChannels.on_off.STREAM_DELTA, callback),
            streamDone: (callback) => ipcRenderer.removeListener(AiCodingAgentChannels.on_off.STREAM_DONE, callback),
            streamError: (callback) => ipcRenderer.removeListener(AiCodingAgentChannels.on_off.STREAM_ERROR, callback),
            streamCancelled: (callback) => ipcRenderer.removeListener(AiCodingAgentChannels.on_off.STREAM_CANCELLED, callback),
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
        },
        ai: {
            getAssistants: () => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET),
            addAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.ADD, data),
            setDefaultAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.SET_DEFAULT, data),
            removeAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.REMOVE, data),
            getAvailableModels: (provider, apiKey) => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET_AVAILABLE_MODELS, provider, apiKey),
            getCodexAuthStatus: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_STATUS, assistantId),
            startCodexLogin: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_LOGIN, assistantId),
            codexLogout: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_LOGOUT, assistantId),
            cancelCodexAuth: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_CANCEL, assistantId),
        }
    },
    system:{
        openExternal: (url) => ipcRenderer.send(SystemChannels.OPEN_EXTERNAL_LINK, url),
        openPluginLogs: (pluginId = "") => ipcRenderer.invoke(SystemChannels.OPEN_PLUGIN_LOGS, pluginId),
        getPluginMetric: (id, fromTime, toTime) => ipcRenderer.invoke(SystemChannels.GET_PLUGIN_METRIC, id, fromTime, toTime),
        openFileDialog: (params, multiple) => ipcRenderer.invoke(SystemChannels.OPEN_FILE_DIALOG, params, multiple),
        openEditorWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_EDITOR_WINDOW, data),
        openLiveUiWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_LIVE_UI_WINDOW, data),
        getModuleFiles: () => ipcRenderer.invoke(SystemChannels.GET_MODULE_FILES),
        getFdoSdkTypes: () => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_TYPES),
        getFdoSdkDomMetadata: () => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_DOM_METADATA),
        getFdoSdkKnowledge: (query, limit) => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_KNOWLEDGE, query, limit),
        getExternalReferenceKnowledge: (query, limit) => ipcRenderer.invoke(SystemChannels.GET_EXTERNAL_REFERENCE_KNOWLEDGE, query, limit),
        getBabelPath: () => ipcRenderer.invoke(SystemChannels.GET_BABEL_PATH),
        confirmEditorCloseApproved: () => ipcRenderer.send(SystemChannels.EDITOR_CLOSE_APPROVED),
        confirmEditorReloadApproved: () => ipcRenderer.send(SystemChannels.EDITOR_RELOAD_APPROVED),
        openPluginInEditor: (editor, pluginID) => ipcRenderer.invoke(SystemChannels.OPEN_PLUGIN_IN_EDITOR, editor, pluginID),
        isFdoInPath: () => ipcRenderer.invoke(SystemChannels.IS_FDO_IN_PATH),
        addFdoInPath: () => ipcRenderer.invoke(SystemChannels.ADD_FDO_IN_PATH),
        removeFdoFromPath: () => ipcRenderer.invoke(SystemChannels.REMOVE_FDO_FROM_PATH),
        on: {
            confirmEditorClose: (callback) => ipcRenderer.on(SystemChannels.on_off.CONFIRM_CLOSE, callback),
            confirmEditorReload: (callback) => ipcRenderer.on(SystemChannels.on_off.CONFIRM_RELOAD, callback),
        },
        off: {
            confirmEditorClose: (callback) => ipcRenderer.removeListener(SystemChannels.on_off.CONFIRM_CLOSE, callback),
            confirmEditorReload: (callback) => ipcRenderer.removeListener(SystemChannels.on_off.CONFIRM_RELOAD, callback),
        },
    },
    plugin: {
        getData: (filePath) => ipcRenderer.invoke(PluginChannels.GET_DATA, filePath),
        save: (content) => ipcRenderer.invoke(PluginChannels.SAVE, content),
        remove: (id) => ipcRenderer.invoke(PluginChannels.REMOVE, id),
        getAll: () => ipcRenderer.invoke(PluginChannels.GET_ALL),
        get: (data) => ipcRenderer.invoke(PluginChannels.GET, data),
        getScopePolicies: (pluginId) => ipcRenderer.invoke(PluginChannels.GET_SCOPE_POLICIES, pluginId),
        getSharedProcessScopes: () => ipcRenderer.invoke(PluginChannels.GET_SHARED_PROCESS_SCOPES),
        upsertSharedProcessScope: (scope) => ipcRenderer.invoke(PluginChannels.UPSERT_SHARED_PROCESS_SCOPE, scope),
        deleteSharedProcessScope: (scopeId) => ipcRenderer.invoke(PluginChannels.DELETE_SHARED_PROCESS_SCOPE, scopeId),
        getSharedFilesystemScopes: () => ipcRenderer.invoke(PluginChannels.GET_SHARED_FILESYSTEM_SCOPES),
        upsertSharedFilesystemScope: (scope) => ipcRenderer.invoke(PluginChannels.UPSERT_SHARED_FILESYSTEM_SCOPE, scope),
        deleteSharedFilesystemScope: (scopeId) => ipcRenderer.invoke(PluginChannels.DELETE_SHARED_FILESYSTEM_SCOPE, scopeId),
        getPluginCustomProcessScopes: (pluginId) => ipcRenderer.invoke(PluginChannels.GET_PLUGIN_CUSTOM_PROCESS_SCOPES, pluginId),
        upsertPluginCustomProcessScope: (pluginId, scope) => ipcRenderer.invoke(PluginChannels.UPSERT_PLUGIN_CUSTOM_PROCESS_SCOPE, pluginId, scope),
        deletePluginCustomProcessScope: (pluginId, scopeId) => ipcRenderer.invoke(PluginChannels.DELETE_PLUGIN_CUSTOM_PROCESS_SCOPE, pluginId, scopeId),
        allowPluginProcessScopeCwdRoot: (pluginId, scopeId, cwdRoot) => ipcRenderer.invoke(PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_CWD_ROOT, pluginId, scopeId, cwdRoot),
        allowPluginProcessScopeArgument: (pluginId, scopeId, argument, executableName = "") => ipcRenderer.invoke(PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_ARGUMENT, pluginId, scopeId, argument, executableName),
        allowPluginProcessScopeEnvKey: (pluginId, scopeId, envKey) => ipcRenderer.invoke(PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_ENV_KEY, pluginId, scopeId, envKey),
        getPluginCustomFilesystemScopes: (pluginId) => ipcRenderer.invoke(PluginChannels.GET_PLUGIN_CUSTOM_FILESYSTEM_SCOPES, pluginId),
        upsertPluginCustomFilesystemScope: (pluginId, scope) => ipcRenderer.invoke(PluginChannels.UPSERT_PLUGIN_CUSTOM_FILESYSTEM_SCOPE, pluginId, scope),
        deletePluginCustomFilesystemScope: (pluginId, scopeId) => ipcRenderer.invoke(PluginChannels.DELETE_PLUGIN_CUSTOM_FILESYSTEM_SCOPE, pluginId, scopeId),
        getCustomProcessScopes: () => ipcRenderer.invoke(PluginChannels.GET_SHARED_PROCESS_SCOPES),
        upsertCustomProcessScope: (scope) => ipcRenderer.invoke(PluginChannels.UPSERT_SHARED_PROCESS_SCOPE, scope),
        deleteCustomProcessScope: (scopeId) => ipcRenderer.invoke(PluginChannels.DELETE_SHARED_PROCESS_SCOPE, scopeId),
        getRuntimeStatus: (ids) => ipcRenderer.invoke(PluginChannels.GET_RUNTIME_STATUS, ids),
        getActivated: () => ipcRenderer.invoke(PluginChannels.GET_ACTIVATED),
        activate: (id) => ipcRenderer.invoke(PluginChannels.ACTIVATE, id),
        deactivate: (id) => ipcRenderer.invoke(PluginChannels.DEACTIVATE, id),
        deactivateUsers: (id) => ipcRenderer.invoke(PluginChannels.DEACTIVATE_USERS, id),
        deactivateAll: () => ipcRenderer.invoke(PluginChannels.DEACTIVATE_ALL),
        deployToMainFromEditor: (data) => ipcRenderer.invoke(PluginChannels.DEPLOY_FROM_EDITOR, data),
        saveAndCloseFromEditor: (data) => ipcRenderer.invoke(PluginChannels.SAVE_FROM_EDITOR, data),
        build: (data) => ipcRenderer.invoke(PluginChannels.BUILD, data),
        runTests: (data) => ipcRenderer.invoke(PluginChannels.RUN_TESTS, data),
        init: (id) => ipcRenderer.invoke(PluginChannels.INIT, id),
        render: (id) => ipcRenderer.invoke(PluginChannels.RENDER, id),
        uiMessage: (id, content) => ipcRenderer.invoke(PluginChannels.UI_MESSAGE, id, content),
        verifySignature: (id) => ipcRenderer.invoke(PluginChannels.VERIFY_SIGNATURE, id),
        sign: (id, signerLabel) => ipcRenderer.invoke(PluginChannels.SIGN, id, signerLabel),
        export: (id) => ipcRenderer.invoke(PluginChannels.EXPORT, id),
        setCapabilities: (id, capabilities) => ipcRenderer.invoke(PluginChannels.SET_CAPABILITIES, id, capabilities),
        getPrivilegedAudit: (id, options) => ipcRenderer.invoke(PluginChannels.GET_PRIVILEGED_AUDIT, id, options),
        getLogTail: (id, options) => ipcRenderer.invoke(PluginChannels.GET_LOG_TAIL, id, options),
        getLogTrace: (id, options) => ipcRenderer.invoke(PluginChannels.GET_LOG_TRACE, id, options),
        on: {
            unloaded: (callback) =>
                addPluginListener("unloaded", PluginChannels.on_off.UNLOADED, callback),
            ready: (callback) =>
                addPluginListener("ready", PluginChannels.on_off.READY, callback),
            deployFromEditor: (callback) =>
                addPluginListener("deployFromEditor", PluginChannels.on_off.DEPLOY_FROM_EDITOR, callback),
            init: (callback) =>
                addPluginListener("init", PluginChannels.on_off.INIT, callback),
            render: (callback) =>
                addPluginListener("render", PluginChannels.on_off.RENDER, callback),
            uiMessage: (callback) =>
                addPluginListener("uiMessage", PluginChannels.on_off.UI_MESSAGE, callback),
        },
        off: {
            unloaded: (callback) =>
                removePluginListener("unloaded", PluginChannels.on_off.UNLOADED, callback),
            ready: (callback) =>
                removePluginListener("ready", PluginChannels.on_off.READY, callback),
            deployFromEditor: (callback) =>
                removePluginListener("deployFromEditor", PluginChannels.on_off.DEPLOY_FROM_EDITOR, callback),
            init: (callback) =>
                removePluginListener("init", PluginChannels.on_off.INIT, callback),
            render: (callback) =>
                removePluginListener("render", PluginChannels.on_off.RENDER, callback),
            uiMessage: (callback) =>
                removePluginListener("uiMessage", PluginChannels.on_off.UI_MESSAGE, callback),
        }
    },
})
