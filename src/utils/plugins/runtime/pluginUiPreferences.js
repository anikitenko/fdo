// Presentation preferences only: these never grant capabilities or activate plugins.
export const PLUGIN_UI_PREFERENCES_KEY = 'fdo.plugin-ui-preferences.v1';
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0))] : [];
export function normalizePluginUiPreferences(value = {}) {
    return {version: 1, pinnedActionIds: ids(value?.pinnedActionIds), sidebarOrder: ids(value?.sidebarOrder), hiddenSidebarIds: ids(value?.hiddenSidebarIds)};
}
export function readPluginUiPreferences(storage) {
    try { return normalizePluginUiPreferences(JSON.parse(storage.getItem(PLUGIN_UI_PREFERENCES_KEY))); }
    catch { return normalizePluginUiPreferences(); }
}
export function orderPluginUiItems(items, order) {
    const ranks = new Map(order.map((id, index) => [id, index]));
    return [...items].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}
export function movePluginUiItem(items, order, id, direction) {
    const ordered = orderPluginUiItems(items, order).map(item => item.id);
    const index = ordered.indexOf(id), next = index + direction;
    if (index < 0 || next < 0 || next >= ordered.length) return order;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    // Retain preferences for temporarily inactive plugins.
    return [...ordered, ...order.filter(item => !ordered.includes(item))];
}
