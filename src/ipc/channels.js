function withPrefix(prefix, obj) {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            result[key] = `${prefix}:${value}`;
        } else if (typeof value === 'object' && value !== null) {
            result[key] = withPrefix(`${prefix}:${key}`, value); // recursively prefix nested keys
        } else {
            throw new Error(`Unsupported value type for key "${key}": ${typeof value}`);
        }
    }

    return result;
}

export const NotificationChannels = withPrefix('notifications', {
    GET_ALL: 'get-all',
    ADD: 'add',
    MARK_AS_READ: 'mark-read',
    MARK_ALL_AS_READ: 'mark-read-all',
    REMOVE: 'remove',
    REMOVE_ALL: 'remove-all',
    on_off: {
        UPDATED: 'updated'
    }
});

export const SettingsChannels = withPrefix('settings', {
    certificates: {
        GET_ROOT: 'get-root',
        CREATE: 'create',
        RENAME: 'rename',
        EXPORT: 'export',
        IMPORT: 'import',
        DELETE: 'delete',
        RENEW: 'renew'
    },
    ai_assistants: {
        GET: 'get',
        ADD: 'add',
        REMOVE: 'remove',
        SET_DEFAULT: 'set-default',
        GET_AVAILABLE_MODELS: 'get-available-models',
        CODEX_AUTH_STATUS: 'codex-auth-status',
        CODEX_AUTH_LOGIN: 'codex-auth-login',
        CODEX_AUTH_LOGOUT: 'codex-auth-logout',
        CODEX_AUTH_CANCEL: 'codex-auth-cancel',
    }
})

export const AiChatChannels = withPrefix('ai-chat', {
    SESSIONS_GET: 'sessions-get',
    SESSION_CREATE: 'session-create',
    SESSION_RENAME: 'session-rename',
    SEND_MESSAGE: 'send-message',
    GET_CAPABILITIES: 'get-capabilities',
    GET_PREFERENCES: 'get-preferences',
    SAVE_PREFERENCES: 'save-preferences',
    DETECT_ATTACHMENT_TYPE: 'detect-attachment-type',
    on_off: {
        STREAM_DELTA: 'stream-delta',
        STREAM_DONE: 'stream-done',
        STREAM_ERROR: 'stream-error',
        STATS_UPDATE: 'stats-update',
        COMPRESSION_START: 'compression-start',
        COMPRESSION_DONE: 'compression-done',
    }
})

export const AiCodingAgentChannels = withPrefix('ai-coding-agent', {
    ROUTE_JUDGE: 'route-judge',
    GENERATE_CODE: 'generate-code',
    EDIT_CODE: 'edit-code',
    EXPLAIN_CODE: 'explain-code',
    FIX_CODE: 'fix-code',
    SMART_MODE: 'smart-mode',
    PLAN_CODE: 'plan-code',
    CANCEL_REQUEST: 'cancel-request',
    on_off: {
        STREAM_DELTA: 'stream-delta',
        STREAM_DONE: 'stream-done',
        STREAM_ERROR: 'stream-error',
        STREAM_CANCELLED: 'stream-cancelled',
    }
})

export const SystemChannels = withPrefix('system', {
    OPEN_EXTERNAL_LINK: 'open-external-link',
    OPEN_PLUGIN_LOGS: 'open-plugin-logs',
    GET_PLUGIN_METRIC: 'get-plugin-metric',
    OPEN_FILE_DIALOG: 'open-file-dialog',
    GET_MODULE_FILES: 'get-module-files',
    GET_FDO_SDK_TYPES: 'get-fdo-sdk-path',
    GET_FDO_SDK_DOM_METADATA: 'get-fdo-sdk-dom-metadata',
    GET_FDO_SDK_KNOWLEDGE: 'get-fdo-sdk-knowledge',
    GET_EXTERNAL_REFERENCE_KNOWLEDGE: 'get-external-reference-knowledge',
    GET_BABEL_PATH: 'get-babel-path',
    OPEN_EDITOR_WINDOW: 'open-editor-window',
    OPEN_LIVE_UI_WINDOW: 'open-live-ui-window',
    EDITOR_CLOSE_APPROVED: 'editor-close-approved',
    EDITOR_RELOAD_APPROVED: 'editor-reload-approved',
    OPEN_PLUGIN_IN_EDITOR: 'open-plugin-in-editor',
    IS_FDO_IN_PATH: 'is-fdo-in-path',
    ADD_FDO_IN_PATH: 'add-fdo-in-path',
    REMOVE_FDO_FROM_PATH: 'remove-fdo-from-path',
    on_off: {
        CONFIRM_CLOSE: 'confirm-close',
        CONFIRM_RELOAD: 'confirm-reload'
    }
})

export const PluginChannels = withPrefix('plugin', {
    GET_DATA: 'get-data',
    SAVE: 'save',
    REMOVE: 'remove',
    GET_ALL: 'get-all',
    GET: 'get',
    GET_SCOPE_POLICIES: 'get-scope-policies',
    GET_SHARED_PROCESS_SCOPES: 'get-shared-process-scopes',
    UPSERT_SHARED_PROCESS_SCOPE: 'upsert-shared-process-scope',
    DELETE_SHARED_PROCESS_SCOPE: 'delete-shared-process-scope',
    GET_PLUGIN_CUSTOM_PROCESS_SCOPES: 'get-plugin-custom-process-scopes',
    UPSERT_PLUGIN_CUSTOM_PROCESS_SCOPE: 'upsert-plugin-custom-process-scope',
    DELETE_PLUGIN_CUSTOM_PROCESS_SCOPE: 'delete-plugin-custom-process-scope',
    GET_CUSTOM_PROCESS_SCOPES: 'get-custom-process-scopes',
    UPSERT_CUSTOM_PROCESS_SCOPE: 'upsert-custom-process-scope',
    DELETE_CUSTOM_PROCESS_SCOPE: 'delete-custom-process-scope',
    GET_RUNTIME_STATUS: 'get-runtime-status',
    ACTIVATE: 'activate',
    DEACTIVATE: 'deactivate',
    DEACTIVATE_USERS: 'deactivate-users',
    GET_ACTIVATED: 'get-activated',
    DEACTIVATE_ALL: 'deactivate-all',
    INIT: 'init',
    RENDER: 'render',
    UI_MESSAGE: 'ui-message',
    BUILD: 'build',
    RUN_TESTS: 'run-tests',
    DEPLOY_FROM_EDITOR: 'deploy-from-editor',
    SAVE_FROM_EDITOR: 'save-from-editor',
    VERIFY_SIGNATURE: 'verify-signature',
    SIGN: 'sign',
    EXPORT: 'export',
    SET_CAPABILITIES: 'set-capabilities',
    GET_PRIVILEGED_AUDIT: 'get-privileged-audit',
    GET_LOG_TAIL: 'get-log-tail',
    GET_LOG_TRACE: 'get-log-trace',
    on_off: {
        UNLOADED: 'unloaded',
        READY: 'ready',
        DEPLOY_FROM_EDITOR: 'deploy-from-editor',
        INIT: 'init',
        RENDER: 'render',
        UI_MESSAGE: 'ui-message',
    }
})

export const StartupChannels = withPrefix('startup', {
    LOG_METRIC: 'log-metric'
})
