// Only host lifecycle metadata crosses this bridge. Never include plugin source,
// form values, handler results or credentials in diagnostics.
export function reportPluginUiLifecycle(pluginId, event, reason, attempt = 0) {
    try {
        const result = window.electron?.plugin?.recordUiLifecycle?.(pluginId, {event, reason, attempt});
        Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostics must not interrupt the interface. */ }
}

export function requestPluginUiRender(pluginId, {replace = false} = {}) {
    return window.electron.plugin.render(pluginId, {replace});
}
