// Shared contract for SDK quick actions and sidebar submenu actions.
const text = value => typeof value === 'string' ? value.trim() : '';
const validHandler = value => !!text(value) && !text(value).startsWith('__') && !text(value).startsWith('fdo.');
export const pluginUiActionKey = (pluginId, action) => `plugin-action-${encodeURIComponent(JSON.stringify([pluginId, action.id || action.name, action.message_type]))}`;
export function normalizePluginUiExtensions({quickActions, sidePanelActions} = {}) {
    const normalize = (items, sidebar = false) => {
        const seen = new Set();
        return (Array.isArray(items) ? items : []).flatMap(action => {
            if (!text(action?.name) || !validHandler(action?.message_type)) return [];
            const normalized = {...action, name: text(action.name), message_type: text(action.message_type),
                id: text(action.id) || (sidebar ? text(action.message_type) : text(action.name)), subtitle: text(action.subtitle)};
            const identity = JSON.stringify(sidebar ? [normalized.id] : [normalized.id, normalized.message_type]);
            if (seen.has(identity)) return [];
            seen.add(identity);
            return [normalized];
        });
    };
    return {quickActions: normalize(quickActions), sidePanelActions: sidePanelActions && text(sidePanelActions.label)
        ? {...sidePanelActions, label: text(sidePanelActions.label), submenu_list: normalize(sidePanelActions.submenu_list, true)} : null};
}
export function assertPluginUiActionResponse(response) {
    const payload = response?.result;
    const failure = [response, payload].find(value => value && (value.ok === false || value.success === false || value.error));
    if (!response || failure) {
        const error = failure?.error;
        throw new Error(typeof error === 'string' ? error : error?.message || 'Plugin action failed.');
    }
    return response;
}
export async function invokePluginUiAction(pluginId, action, source, bridge) {
    if (!validHandler(action?.message_type)) throw new Error('This action must name a registered plugin handler.');
    if (action.disabled) throw new Error('This plugin action is currently unavailable.');
    return assertPluginUiActionResponse(await bridge(pluginId, {handler: text(action.message_type), content: {source, actionId: action.id || action.name}}));
}
