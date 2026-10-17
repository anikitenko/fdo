export const NOTIFICATION_SOURCES = ['gitops', 'builds', 'plugins', 'security', 'ai', 'observability', 'system'];
export const DEFAULT_NOTIFICATION_PREFERENCES = {
    successToasts: true, failureToasts: true, infoToasts: false, retentionDays: 0,
    mutedSources: [],
};

export function notificationSource(notification) {
    if (NOTIFICATION_SOURCES.includes(notification.source)) return notification.source;
    if (/certificate|signature|permission/i.test(notification.title)) return 'security';
    if (/langfuse|observability|trace export/i.test(notification.title)) return 'observability';
    if (/AI |conversation|assistant/i.test(notification.title)) return 'ai';
    if (/gitops/i.test(notification.title)) return 'gitops';
    if (/build|test|export plugin/i.test(notification.title)) return 'builds';
    if (/plugin/i.test(notification.title)) return 'plugins';
    return 'system';
}

export function notificationPresentation(notification, plugins = []) {
    if (notification.message) return notification;
    const match = /^(?:Plugin )?(.+) is ready$/.exec(notification.title);
    if (!match) return notification;
    const id = match[1];
    const plugin = plugins.find(item => item.id === id);
    const declaredName = /^gitops_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_(.+)$/i.exec(id)?.[1];
    const name = plugin?.metadata?.name || plugin?.name || declaredName || 'Plugin';
    return {...notification, title: `${name} started`, source: 'plugins',
        details: [notification.details, `Plugin ID: ${id}`].filter(Boolean).join('\n')};
}

export function notificationPreferences(value = {}) {
    const result = {...DEFAULT_NOTIFICATION_PREFERENCES};
    for (const key of ['successToasts', 'failureToasts', 'infoToasts']) if (typeof value[key] === 'boolean') result[key] = value[key];
    if ([0, 30, 90].includes(value.retentionDays)) result.retentionDays = value.retentionDays;
    if (Array.isArray(value.mutedSources)) result.mutedSources = NOTIFICATION_SOURCES.filter(source => value.mutedSources.includes(source));
    return result;
}

export function shouldAlert(notification, preferences) {
    if (preferences.mutedSources.includes(notificationSource(notification))) return false;
    if (notification.type === 'success') return preferences.successToasts;
    if (['warning', 'danger'].includes(notification.type)) return preferences.failureToasts;
    return preferences.infoToasts;
}

// Only data and recognized navigation actions are persisted; notifications never carry executable code.
export function notificationMetadata(input = {}) {
    const result = {source: notificationSource(input)};
    for (const key of ['summary', 'details', 'groupKey']) if (typeof input[key] === 'string') result[key] = input[key].slice(0, key === 'details' ? 30000 : 2000);
    if (input.status === 'resolved') result.status = 'resolved';
    if (Array.isArray(input.actions)) result.actions = input.actions.slice(0, 3).flatMap(action => {
        if (!action || !['view-plugin', 'manage-plugin', 'open-plugin-logs', 'view-settings', 'view-gitops', 'open-repository', 'retry-gitops'].includes(action.kind)) return [];
        const clean = {kind: action.kind};
        for (const key of ['pluginId', 'repositoryId', 'pluginName', 'url', 'tab']) if (typeof action[key] === 'string') clean[key] = action[key].slice(0, 2000);
        if (clean.kind === 'view-settings' && !['general', 'certificates', 'observability', 'ai', 'gitops'].includes(clean.tab)) return [];
        if (clean.kind === 'open-repository') {
            try {const url = new URL(clean.url); if (url.protocol !== 'https:' || url.username || url.password) return [];}
            catch {return [];}
        }
        return [clean];
    });
    return result;
}
