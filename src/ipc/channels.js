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
    }
})

export const SystemChannels = withPrefix('system', {
    OPEN_EXTERNAL_LINK: 'open-external-link',
    GET_PLUGIN_METRIC: 'get-plugin-metric',
    OPEN_FILE_DIALOG: 'open-file-dialog',
    GET_MODULE_FILES: 'get-module-files',
    GET_FDO_SDK_TYPES: 'get-fdo-sdk-path',
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
    ACTIVATE: 'activate',
    DEACTIVATE: 'deactivate',
    DEACTIVATE_USERS: 'deactivate-users',
    GET_ACTIVATED: 'get-activated',
    DEACTIVATE_ALL: 'deactivate-all',
    INIT: 'init',
    RENDER: 'render',
    UI_MESSAGE: 'ui-message',
    BUILD: 'build',
    DEPLOY_FROM_EDITOR: 'deploy-from-editor',
    SAVE_FROM_EDITOR: 'save-from-editor',
    VERIFY_SIGNATURE: 'verify-signature',
    SIGN: 'sign',
    EXPORT: 'export',
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