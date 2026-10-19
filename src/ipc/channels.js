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
    MARK_AS_UNREAD: 'mark-unread',
    UNDO: 'undo',
    GET_PREFERENCES: 'get-preferences',
    SAVE_PREFERENCES: 'save-preferences',
    MARK_ALL_AS_READ: 'mark-read-all',
    REMOVE: 'remove',
    REMOVE_ALL: 'remove-all',
    on_off: {
        UPDATED: 'updated',
        ALERT: 'alert',
        PREFERENCES: 'preferences'
    }
});

export const SettingsChannels = withPrefix('settings', {
    updates: {CHECK: 'check-updates', GET_PREFERENCES: 'get-update-preferences', SAVE_PREFERENCES: 'save-update-preferences'},
    observability: {GET: 'get', SAVE: 'save', TEST: 'test', RETRY: 'retry', TRACE: 'trace'},
    gitops: {LIST: 'list', SAVE: 'save', VERIFY: 'verify', REMOVE: 'remove', SYNC: 'sync', SYNC_PLUGIN: 'sync-plugin', REVIEW_UPDATE: 'review-update', SET_INTERVAL: 'set-interval', SET_AUTO_SYNC: 'set-auto-sync', UPDATED: 'updated'},
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
        GET_PROVIDER_INSTRUCTIONS: 'get-provider-instructions',
        SET_PROVIDER_INSTRUCTIONS: 'set-provider-instructions',
        MCP_SIGN_IN: 'mcp-sign-in',
        MCP_SIGN_OUT: 'mcp-sign-out',
        MCP_CANCEL_SIGN_IN: 'mcp-cancel-sign-in',
        CHECK_CODEX_MCP: 'check-codex-mcp',
        UPDATE_CODEX_MCP: 'update-codex-mcp',
        REMOVE_CODEX_MCP: 'remove-codex-mcp',
        ADD_CODEX_HOOK: 'add-codex-hook',
        UPDATE_CODEX_HOOK: 'update-codex-hook',
        REMOVE_CODEX_HOOK: 'remove-codex-hook',
        TEST_CODEX_HOOK: 'test-codex-hook',
        GET_EXTENSIONS: 'get-ai-extensions',
        IMPORT_CODEX_SKILL: 'import-codex-skill',
        UPDATE_CODEX_SKILL: 'update-codex-skill',
        REMOVE_CODEX_SKILL: 'remove-codex-skill',
        ADD: 'add',
        REMOVE: 'remove',
        SET_DEFAULT: 'set-default',
        GET_AVAILABLE_MODELS: 'get-available-models',
        GET_INPUT_CAPABILITIES: 'get-input-capabilities',
        CODEX_AUTH_STATUS: 'codex-auth-status',
        CODEX_AUTH_LOGIN: 'codex-auth-login',
        CODEX_AUTH_LOGOUT: 'codex-auth-logout',
        CODEX_AUTH_CANCEL: 'codex-auth-cancel',
        on_off: {
            UPDATED: 'updated',
            EXTENSIONS_UPDATED: 'extensions-updated',
        }
    }
})

export const AiChatChannels = withPrefix('ai-chat', {
    SESSIONS_GET: 'sessions-get',
    SESSIONS_LIST: 'sessions-list',
    SESSION_GET: 'session-get',
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
    GET_GENERATION_CHECKPOINT: 'ai-coding-generation-checkpoint-get',
    DISCARD_GENERATION_CHECKPOINT: 'ai-coding-generation-checkpoint-discard',
    REVIEW_SKILL: 'ai-coding-review-skill',
    CANCEL_REQUEST: 'cancel-request',
    RECORD_LIFECYCLE: 'record-lifecycle',
    SET_ACTIVITY: 'set-activity',
    OPEN_ACTIVITY: 'open-activity',
    on_off: {
        STREAM_DELTA: 'stream-delta',
        STREAM_DONE: 'stream-done',
        STREAM_ERROR: 'stream-error',
        STREAM_CANCELLED: 'stream-cancelled',
    }
})

export const LiveUiChannels = withPrefix('live-ui', {
    OPEN: 'open', PUBLISH: 'publish', READ: 'read', PREVIEW: 'preview', FOCUS_IDE: 'focus-ide', UPDATED: 'updated',
    PROPOSE: 'propose', APPLY: 'apply', APPLY_REQUEST: 'apply-request', APPLIED: 'applied', CAN_COMMIT: 'can-commit',
    REVEAL: 'reveal', REVEAL_SOURCE: 'reveal-source',
    EDIT_WITH_AI: 'edit-with-ai', AI_SELECTION: 'ai-selection',
    RESTORE_DRAFT: 'restore-draft', DISCARD_DRAFT: 'discard-draft',
});

export const SystemChannels = withPrefix('system', {
    OPEN_EXTERNAL_LINK: 'open-external-link',
    OPEN_PLUGIN_LOGS: 'open-plugin-logs',
    GET_PLUGIN_METRIC: 'get-plugin-metric',
    OPEN_FILE_DIALOG: 'open-file-dialog',
    GET_MODULE_FILES: 'get-module-files',
    GET_FDO_SDK_TYPES: 'get-fdo-sdk-path',
    GET_FDO_SDK_EDITOR_SUPPORT: 'get-fdo-sdk-editor-support',
    GET_FDO_SDK_EDITOR_MONACO_POLICY: 'get-fdo-sdk-editor-monaco-policy',
    GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATES: 'get-fdo-sdk-render-on-load-templates',
    GET_FDO_SDK_RENDER_ON_LOAD_TEMPLATE: 'get-fdo-sdk-render-on-load-template',
    GET_FDO_SDK_DOM_METADATA: 'get-fdo-sdk-dom-metadata',
    GET_FDO_SDK_KNOWLEDGE: 'get-fdo-sdk-knowledge',
    GET_EXTERNAL_REFERENCE_KNOWLEDGE: 'get-external-reference-knowledge',
    GET_BABEL_PATH: 'get-babel-path',
    OPEN_EDITOR_WINDOW: 'open-editor-window',
    EDITOR_CLOSE_APPROVED: 'editor-close-approved',
    EDITOR_RELOAD_APPROVED: 'editor-reload-approved',
    FOCUS_EDITOR_WINDOW: 'system:focus-editor-window',
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
    INSPECT_FOLDER: 'inspect-folder',
    INSTALL_FOLDER: 'install-folder',
    CHECK_DRAFT_RELEASE: 'check-draft-release',
    SAVE: 'save',
    REMOVE: 'remove',
    GET_ALL: 'get-all',
    GET: 'get',
    GET_SCOPE_POLICIES: 'get-scope-policies',
    GET_SHARED_PROCESS_SCOPES: 'get-shared-process-scopes',
    UPSERT_SHARED_PROCESS_SCOPE: 'upsert-shared-process-scope',
    DELETE_SHARED_PROCESS_SCOPE: 'delete-shared-process-scope',
    GET_SHARED_FILESYSTEM_SCOPES: 'get-shared-filesystem-scopes',
    UPSERT_SHARED_FILESYSTEM_SCOPE: 'upsert-shared-filesystem-scope',
    DELETE_SHARED_FILESYSTEM_SCOPE: 'delete-shared-filesystem-scope',
    GET_PLUGIN_CUSTOM_PROCESS_SCOPES: 'get-plugin-custom-process-scopes',
    UPSERT_PLUGIN_CUSTOM_PROCESS_SCOPE: 'upsert-plugin-custom-process-scope',
    DELETE_PLUGIN_CUSTOM_PROCESS_SCOPE: 'delete-plugin-custom-process-scope',
    ALLOW_PLUGIN_PROCESS_SCOPE_CWD_ROOT: 'allow-plugin-process-scope-cwd-root',
    ALLOW_PLUGIN_PROCESS_SCOPE_ARGUMENT: 'allow-plugin-process-scope-argument',
    ALLOW_PLUGIN_PROCESS_SCOPE_ENV_KEY: 'allow-plugin-process-scope-env-key',
    GET_PLUGIN_CUSTOM_FILESYSTEM_SCOPES: 'get-plugin-custom-filesystem-scopes',
    UPSERT_PLUGIN_CUSTOM_FILESYSTEM_SCOPE: 'upsert-plugin-custom-filesystem-scope',
    DELETE_PLUGIN_CUSTOM_FILESYSTEM_SCOPE: 'delete-plugin-custom-filesystem-scope',
    GET_CUSTOM_PROCESS_SCOPES: 'get-custom-process-scopes',
    UPSERT_CUSTOM_PROCESS_SCOPE: 'upsert-custom-process-scope',
    DELETE_CUSTOM_PROCESS_SCOPE: 'delete-custom-process-scope',
    GET_RUNTIME_STATUS: 'get-runtime-status',
    GET_DOCTOR_PRESENTATION: 'get-doctor-presentation',
    ACTIVATE: 'activate',
    DEACTIVATE: 'deactivate',
    DEACTIVATE_USERS: 'deactivate-users',
    GET_ACTIVATED: 'get-activated',
    DEACTIVATE_ALL: 'deactivate-all',
    INIT: 'init',
    RENDER: 'render',
    UI_MESSAGE: 'ui-message',
    TYPECHECK: 'plugin-typecheck',
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
        CAPABILITIES_CHANGED: 'capabilities-changed',
        UNLOADED: 'unloaded',
        READY: 'ready',
        DEPLOY_FROM_EDITOR: 'deploy-from-editor',
        DEPLOY_PROGRESS: 'plugin-deploy-progress',
        INIT: 'init',
        RENDER: 'render',
        UI_MESSAGE: 'ui-message',
    }
})

export const StartupChannels = withPrefix('startup', {
    LOG_METRIC: 'log-metric'
})

export const AiUsageChannels = withPrefix("ai-usage", {GET: "get", UPDATED: "updated", RATES: "rates", SAVE_RATE: "save-rate"});
export const HostServiceSettingsChannels = withPrefix('host-service-settings', {
    TOOLS_STATE: 'tools-state', TERMINAL_VIEW: 'terminal-view', CHECK_X11: 'check-x11',
    STATE: 'state', FETCH_HOST_KEY: 'fetch-host-key', SET_GIT_ENABLED: 'set-git-enabled', SAVE_SECRET: 'save-secret', DELETE_SECRET: 'delete-secret', SAVE_PROFILE: 'save-profile', DELETE_PROFILE: 'delete-profile',
});
