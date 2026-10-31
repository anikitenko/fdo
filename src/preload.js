import {createPluginEventRegistry} from './utils/plugins/runtime/pluginEventRegistry';
import {HostServiceSettingsChannels} from './ipc/channels';
import {contextBridge, ipcRenderer} from 'electron'
import {NotificationChannels, PluginChannels, SettingsChannels, SystemChannels, StartupChannels, AiChatChannels, AiCodingAgentChannels, AiUsageChannels, LiveUiChannels} from "./ipc/channels";

const {add: addPluginListener, remove: removePluginListener} = createPluginEventRegistry(ipcRenderer);
const subscribeSystemEvent = (channel, callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('electron', {
    toolSettings: {inspect: () => ipcRenderer.invoke(HostServiceSettingsChannels.TOOLS_STATE, {})},
    credentialSettings: {
        checkX11: pluginId => ipcRenderer.invoke(HostServiceSettingsChannels.CHECK_X11, {pluginId}),
        terminalView: (pluginId, leaseId, active) => ipcRenderer.invoke(HostServiceSettingsChannels.TERMINAL_VIEW, {pluginId, leaseId, active}),
        fetchHostKey: (pluginId, host, port) => ipcRenderer.invoke(HostServiceSettingsChannels.FETCH_HOST_KEY, {pluginId, host, port}),
        setGitEnabled: (pluginId, enabled) => ipcRenderer.invoke(HostServiceSettingsChannels.SET_GIT_ENABLED, {pluginId, enabled}),
        state: pluginId => ipcRenderer.invoke(HostServiceSettingsChannels.STATE, {pluginId}),
        saveSecret: (pluginId, key, value) => ipcRenderer.invoke(HostServiceSettingsChannels.SAVE_SECRET, {pluginId, key, value}),
        deleteSecret: (pluginId, key) => ipcRenderer.invoke(HostServiceSettingsChannels.DELETE_SECRET, {pluginId, key}),
        saveProfile: (pluginId, profile, trustConfirmed) => ipcRenderer.invoke(HostServiceSettingsChannels.SAVE_PROFILE, {pluginId, profile, trustConfirmed}),
        deleteProfile: (pluginId, id) => ipcRenderer.invoke(HostServiceSettingsChannels.DELETE_PROFILE, {pluginId, id}),
    },
    liveUi: {
        open: data => ipcRenderer.invoke(LiveUiChannels.OPEN, data),
        publish: (session, data) => ipcRenderer.invoke(LiveUiChannels.PUBLISH, session, data),
        read: session => ipcRenderer.invoke(LiveUiChannels.READ, session),
        preview: (session, revision) => ipcRenderer.invoke(LiveUiChannels.PREVIEW, session, revision),
        focusIde: session => ipcRenderer.invoke(LiveUiChannels.FOCUS_IDE, session),
        propose: (session, request) => ipcRenderer.invoke(LiveUiChannels.PROPOSE, session, request),
        restoreDraft: session => ipcRenderer.invoke(LiveUiChannels.RESTORE_DRAFT, session),
        discardDraft: (session, draftId) => ipcRenderer.invoke(LiveUiChannels.DISCARD_DRAFT, session, draftId),
        apply: (session, draftId, options) => ipcRenderer.invoke(LiveUiChannels.APPLY, session, draftId, options),
        canCommit: (session, requestId) => ipcRenderer.invoke(LiveUiChannels.CAN_COMMIT, session, requestId),
        applied: (session, requestId, result) => ipcRenderer.invoke(LiveUiChannels.APPLIED, session, requestId, result),
        reveal: (session, revision, elementId, target) => ipcRenderer.invoke(LiveUiChannels.REVEAL, session, revision, elementId, target),
        editWithAi: (session, revision, elementId) => ipcRenderer.invoke(LiveUiChannels.EDIT_WITH_AI, session, revision, elementId),
        onAiSelection: callback => {
            const listener = (_, selection) => callback(selection);
            ipcRenderer.on(LiveUiChannels.AI_SELECTION, listener);
            return () => ipcRenderer.removeListener(LiveUiChannels.AI_SELECTION, listener);
        },
        onApply: callback => {
            const listener = (_, request) => callback(request);
            ipcRenderer.on(LiveUiChannels.APPLY_REQUEST, listener);
            return () => ipcRenderer.removeListener(LiveUiChannels.APPLY_REQUEST, listener);
        },
        onReveal: callback => {
            const listener = (_, location) => callback(location);
            ipcRenderer.on(LiveUiChannels.REVEAL_SOURCE, listener);
            return () => ipcRenderer.removeListener(LiveUiChannels.REVEAL_SOURCE, listener);
        },
        subscribe: callback => {
            const listener = (_, state) => callback(state);
            ipcRenderer.on(LiveUiChannels.UPDATED, listener);
            return () => ipcRenderer.removeListener(LiveUiChannels.UPDATED, listener);
        },
    },
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
        add: (title, body, type, metadata) => ipcRenderer.invoke(NotificationChannels.ADD, title, body, type, metadata),
        markAsRead: (id) => ipcRenderer.invoke(NotificationChannels.MARK_AS_READ, id),
        markAsUnread: id => ipcRenderer.invoke(NotificationChannels.MARK_AS_UNREAD, id),
        undo: token => ipcRenderer.invoke(NotificationChannels.UNDO, token),
        getPreferences: () => ipcRenderer.invoke(NotificationChannels.GET_PREFERENCES),
        savePreferences: value => ipcRenderer.invoke(NotificationChannels.SAVE_PREFERENCES, value),
        onAlert: callback => {
            const listener = (_, notification) => callback(notification);
            ipcRenderer.on(NotificationChannels.on_off.ALERT, listener);
            return () => ipcRenderer.removeListener(NotificationChannels.on_off.ALERT, listener);
        },
        onPreferences: callback => {
            const listener = (_, preferences) => callback(preferences);
            ipcRenderer.on(NotificationChannels.on_off.PREFERENCES, listener);
            return () => ipcRenderer.removeListener(NotificationChannels.on_off.PREFERENCES, listener);
        },
        markAllAsRead: () => ipcRenderer.invoke(NotificationChannels.MARK_ALL_AS_READ),
        remove: (id) => ipcRenderer.invoke(NotificationChannels.REMOVE, id),
        removeAll: () => ipcRenderer.invoke(NotificationChannels.REMOVE_ALL),
        onOpen: callback => {
            const listener = () => callback();
            ipcRenderer.on(NotificationChannels.OPEN, listener);
            return () => ipcRenderer.removeListener(NotificationChannels.OPEN, listener);
        },
        on: {
            updated: (callback) => ipcRenderer.on(NotificationChannels.on_off.UPDATED, callback)
        },
        off: {
            updated: (callback) => ipcRenderer.removeListener(NotificationChannels.on_off.UPDATED, callback),
        }
    },
    aiUsage: {
        get: filter => ipcRenderer.invoke(AiUsageChannels.GET, filter),
        rates: () => ipcRenderer.invoke(AiUsageChannels.RATES),
        saveRate: data => ipcRenderer.invoke(AiUsageChannels.SAVE_RATE, data),
        subscribe: callback => {
            const listener = () => callback();
            ipcRenderer.on(AiUsageChannels.UPDATED, listener);
            return () => ipcRenderer.removeListener(AiUsageChannels.UPDATED, listener);
        },
    },
    aiChat: {
        getSessions: () => ipcRenderer.invoke(AiChatChannels.SESSIONS_GET),
        listSessions: () => ipcRenderer.invoke(AiChatChannels.SESSIONS_LIST),
        getSession: id => ipcRenderer.invoke(AiChatChannels.SESSION_GET, id),
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
        setActivity: (active, progress) => ipcRenderer.send(AiCodingAgentChannels.SET_ACTIVITY, active === true, progress),
        onOpenActivity: callback => {
            const listener = () => callback();
            ipcRenderer.on(AiCodingAgentChannels.OPEN_ACTIVITY, listener);
            return () => ipcRenderer.removeListener(AiCodingAgentChannels.OPEN_ACTIVITY, listener);
        },
        routeJudge: (data) => ipcRenderer.invoke(AiCodingAgentChannels.ROUTE_JUDGE, data),
        generateCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.GENERATE_CODE, data),
        editCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.EDIT_CODE, data),
        explainCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.EXPLAIN_CODE, data),
        fixCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.FIX_CODE, data),
        smartMode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.SMART_MODE, data),
        planCode: (data) => ipcRenderer.invoke(AiCodingAgentChannels.PLAN_CODE, data),
        getGenerationCheckpoint: data => ipcRenderer.invoke(AiCodingAgentChannels.GET_GENERATION_CHECKPOINT, data),
        discardGenerationCheckpoint: data => ipcRenderer.invoke(AiCodingAgentChannels.DISCARD_GENERATION_CHECKPOINT, data),
        reviewSkill: (data) => ipcRenderer.invoke(AiCodingAgentChannels.REVIEW_SKILL, data),
        cancelRequest: (data) => ipcRenderer.invoke(AiCodingAgentChannels.CANCEL_REQUEST, data),
        recordLifecycle: (data) => ipcRenderer.invoke(AiCodingAgentChannels.RECORD_LIFECYCLE, data),
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
        updates: {
            check: channel => ipcRenderer.invoke(SettingsChannels.updates.CHECK, channel),
            getPreferences: () => ipcRenderer.invoke(SettingsChannels.updates.GET_PREFERENCES),
            savePreferences: preferences => ipcRenderer.invoke(SettingsChannels.updates.SAVE_PREFERENCES, preferences),
            install: () => ipcRenderer.invoke(SettingsChannels.updates.INSTALL),
        },
        onOpen: callback => {
            const listener = (_, tab) => callback(tab);
            ipcRenderer.on('app:open-settings', listener);
            return () => ipcRenderer.removeListener('app:open-settings', listener);
        },
        observability: {
            get: () => ipcRenderer.invoke(SettingsChannels.observability.GET),
            save: config => ipcRenderer.invoke(SettingsChannels.observability.SAVE, config),
            test: config => ipcRenderer.invoke(SettingsChannels.observability.TEST, config),
            retry: () => ipcRenderer.invoke(SettingsChannels.observability.RETRY),
            trace: id => ipcRenderer.invoke(SettingsChannels.observability.TRACE, id),
        },
        gitops: {
            list: () => ipcRenderer.invoke(SettingsChannels.gitops.LIST),
            save: repository => ipcRenderer.invoke(SettingsChannels.gitops.SAVE, repository),
            verify: id => ipcRenderer.invoke(SettingsChannels.gitops.VERIFY, id),
            remove: id => ipcRenderer.invoke(SettingsChannels.gitops.REMOVE, id),
            sync: id => ipcRenderer.invoke(SettingsChannels.gitops.SYNC, id),
            syncPlugin: (id, pluginName) => ipcRenderer.invoke(SettingsChannels.gitops.SYNC_PLUGIN, {id, pluginName}),
            reviewUpdate: (id, review) => ipcRenderer.invoke(SettingsChannels.gitops.REVIEW_UPDATE, {id,...review}),
            setInterval: (id, minutes) => ipcRenderer.invoke(SettingsChannels.gitops.SET_INTERVAL, {id, minutes}),
            setAutoSync: (id, enabled) => ipcRenderer.invoke(SettingsChannels.gitops.SET_AUTO_SYNC, {id, enabled}),
            onUpdated: callback => {
                const listener = () => callback();
                ipcRenderer.on(SettingsChannels.gitops.UPDATED, listener);
                return () => ipcRenderer.removeListener(SettingsChannels.gitops.UPDATED, listener);
            },
        },
        certificates: {
            getRoot: () => ipcRenderer.invoke(SettingsChannels.certificates.GET_ROOT),
            create: label => ipcRenderer.invoke(SettingsChannels.certificates.CREATE, label),
            rename: (id, newName) => ipcRenderer.invoke(SettingsChannels.certificates.RENAME, id, newName),
            export: (id) => ipcRenderer.invoke(SettingsChannels.certificates.EXPORT, id),
            import: (file) => ipcRenderer.invoke(SettingsChannels.certificates.IMPORT, file),
            delete: (file) => ipcRenderer.invoke(SettingsChannels.certificates.DELETE, file),
            renew: (label) => ipcRenderer.invoke(SettingsChannels.certificates.RENEW, label),
        },
        ai: {
            getAssistants: () => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET),
            getProviderInstructions: () => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET_PROVIDER_INSTRUCTIONS),
            setProviderInstructions: (instructions) => ipcRenderer.invoke(SettingsChannels.ai_assistants.SET_PROVIDER_INSTRUCTIONS, instructions),
            signInMcp: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.MCP_SIGN_IN, {id}),
            signOutMcp: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.MCP_SIGN_OUT, {id}),
            cancelMcpSignIn: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.MCP_CANCEL_SIGN_IN, {id}),
            checkCodexMcp: server => ipcRenderer.invoke(SettingsChannels.ai_assistants.CHECK_CODEX_MCP, server),
            updateCodexMcp: server => ipcRenderer.invoke(SettingsChannels.ai_assistants.UPDATE_CODEX_MCP, server),
            removeCodexMcp: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.REMOVE_CODEX_MCP, {id}),
            addCodexHook: hook => ipcRenderer.invoke(SettingsChannels.ai_assistants.ADD_CODEX_HOOK, hook),
            updateCodexHook: hook => ipcRenderer.invoke(SettingsChannels.ai_assistants.UPDATE_CODEX_HOOK, hook),
            removeCodexHook: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.REMOVE_CODEX_HOOK, {id}),
            testCodexHook: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.TEST_CODEX_HOOK, {id}),
            getExtensions: () => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET_EXTENSIONS),
            importCodexSkill: () => ipcRenderer.invoke(SettingsChannels.ai_assistants.IMPORT_CODEX_SKILL),
            updateCodexSkill: skill => ipcRenderer.invoke(SettingsChannels.ai_assistants.UPDATE_CODEX_SKILL, skill),
            removeCodexSkill: id => ipcRenderer.invoke(SettingsChannels.ai_assistants.REMOVE_CODEX_SKILL, {id}),
            addAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.ADD, data),
            setDefaultAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.SET_DEFAULT, data),
            removeAssistant: (data) => ipcRenderer.invoke(SettingsChannels.ai_assistants.REMOVE, data),
            getAvailableModels: (provider, apiKey, baseUrl, accountId, executablePath) => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET_AVAILABLE_MODELS, provider, apiKey, baseUrl, accountId, executablePath),
            getInputCapabilities: config => ipcRenderer.invoke(SettingsChannels.ai_assistants.GET_INPUT_CAPABILITIES, config),
            getCodexAuthStatus: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_STATUS, assistantId),
            startCodexLogin: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_LOGIN, assistantId),
            codexLogout: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_LOGOUT, assistantId),
            cancelCodexAuth: (assistantId) => ipcRenderer.invoke(SettingsChannels.ai_assistants.CODEX_AUTH_CANCEL, assistantId),
            on: {
                updated: (cb) => ipcRenderer.on(SettingsChannels.ai_assistants.on_off.UPDATED, cb),
                extensionsUpdated: cb => ipcRenderer.on(SettingsChannels.ai_assistants.on_off.EXTENSIONS_UPDATED, cb),
            },
            off: {
                updated: (cb) => ipcRenderer.off(SettingsChannels.ai_assistants.on_off.UPDATED, cb),
                extensionsUpdated: cb => ipcRenderer.off(SettingsChannels.ai_assistants.on_off.EXTENSIONS_UPDATED, cb),
            }
        }
    },
    system:{
        openExternal: (url) => ipcRenderer.send(SystemChannels.OPEN_EXTERNAL_LINK, url),
        openPluginLogs: (pluginId = "") => ipcRenderer.invoke(SystemChannels.OPEN_PLUGIN_LOGS, pluginId),
        getPluginMetric: (id, fromTime, toTime) => ipcRenderer.invoke(SystemChannels.GET_PLUGIN_METRIC, id, fromTime, toTime),
        openFileDialog: (params, multiple) => ipcRenderer.invoke(SystemChannels.OPEN_FILE_DIALOG, params, multiple),
        openEditorWindow: (data) => ipcRenderer.send(SystemChannels.OPEN_EDITOR_WINDOW, data),
        focusEditorWindow: () => ipcRenderer.invoke(SystemChannels.FOCUS_EDITOR_WINDOW),
        getModuleFiles: () => ipcRenderer.invoke(SystemChannels.GET_MODULE_FILES),
        getFdoSdkTypes: () => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_TYPES),
        getFdoSdkEditorSupport: () => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_EDITOR_SUPPORT),
        getFdoSdkEditorMonacoPolicy: (options) => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_EDITOR_MONACO_POLICY, options),
        getFdoSdkRenderOnLoadTemplates: () => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATES),
        getFdoSdkRenderOnLoadTemplate: (id) => ipcRenderer.invoke(SystemChannels.GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATE, id),
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
            confirmEditorClose: (callback) => subscribeSystemEvent(SystemChannels.on_off.CONFIRM_CLOSE, callback),
            confirmEditorReload: (callback) => subscribeSystemEvent(SystemChannels.on_off.CONFIRM_RELOAD, callback),
        },
        off: {
            confirmEditorClose: (callback) => ipcRenderer.removeListener(SystemChannels.on_off.CONFIRM_CLOSE, callback),
            confirmEditorReload: (callback) => ipcRenderer.removeListener(SystemChannels.on_off.CONFIRM_RELOAD, callback),
        },
    },
    plugin: {
        getDoctorPresentation: (diagnostics, options) => ipcRenderer.invoke(PluginChannels.GET_DOCTOR_PRESENTATION, diagnostics, options),
        inspectFolder: (directory) => ipcRenderer.invoke(PluginChannels.INSPECT_FOLDER, directory),
        installFolder: (data) => ipcRenderer.invoke(PluginChannels.INSTALL_FOLDER, data),
        checkDraftRelease: (id) => ipcRenderer.invoke(PluginChannels.CHECK_DRAFT_RELEASE, id),
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
        typecheck: (data) => ipcRenderer.invoke(PluginChannels.TYPECHECK, data),
        build: (data) => ipcRenderer.invoke(PluginChannels.BUILD, data),
        runTests: (data) => ipcRenderer.invoke(PluginChannels.RUN_TESTS, data),
        init: (id) => ipcRenderer.invoke(PluginChannels.INIT, id),
        render: (id) => ipcRenderer.invoke(PluginChannels.RENDER, id),
        uiMessage: (id, content) => ipcRenderer.invoke(PluginChannels.UI_MESSAGE, id, content),
        verifySignature: (id) => ipcRenderer.invoke(PluginChannels.VERIFY_SIGNATURE, id),
        sign: (id, signerLabel) => ipcRenderer.invoke(PluginChannels.SIGN, id, signerLabel),
        export: (id) => ipcRenderer.invoke(PluginChannels.EXPORT, id),
        previewExport: (id) => ipcRenderer.invoke(PluginChannels.EXPORT_PREVIEW, id),
        exportAs: (id, options) => ipcRenderer.invoke(PluginChannels.EXPORT_AS, id, options),
        setCapabilities: (id, capabilities) => ipcRenderer.invoke(PluginChannels.SET_CAPABILITIES, id, capabilities),
        getPrivilegedAudit: (id, options) => ipcRenderer.invoke(PluginChannels.GET_PRIVILEGED_AUDIT, id, options),
        getLogTail: (id, options) => ipcRenderer.invoke(PluginChannels.GET_LOG_TAIL, id, options),
        getLogTrace: (id, options) => ipcRenderer.invoke(PluginChannels.GET_LOG_TRACE, id, options),
        on: {
            capabilitiesChanged: (callback) =>
                addPluginListener("capabilitiesChanged", PluginChannels.on_off.CAPABILITIES_CHANGED, callback),
            unloaded: (callback) =>
                addPluginListener("unloaded", PluginChannels.on_off.UNLOADED, callback),
            ready: (callback) =>
                addPluginListener("ready", PluginChannels.on_off.READY, callback),
            deployProgress: (callback) =>
                addPluginListener("deployProgress", PluginChannels.on_off.DEPLOY_PROGRESS, callback),
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
            capabilitiesChanged: (callback) =>
                removePluginListener("capabilitiesChanged", PluginChannels.on_off.CAPABILITIES_CHANGED, callback),
            unloaded: (callback) =>
                removePluginListener("unloaded", PluginChannels.on_off.UNLOADED, callback),
            ready: (callback) =>
                removePluginListener("ready", PluginChannels.on_off.READY, callback),
            deployProgress: (callback) =>
                removePluginListener("deployProgress", PluginChannels.on_off.DEPLOY_PROGRESS, callback),
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
