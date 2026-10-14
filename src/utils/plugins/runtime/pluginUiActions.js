// Shared renderer dispatch for SDK quick actions and sidebar submenu actions.
export async function invokePluginUiAction(pluginId, action, source, bridge) {
    const handler = typeof action?.message_type === 'string' ? action.message_type.trim() : '';
    if (!handler || handler.startsWith('__') || handler.startsWith('fdo.')) throw new Error('This action must name a registered plugin handler.');
    const response = await bridge(pluginId, {handler, content: {source, actionId: action.id || action.name}});
    if (!response || response.ok === false || response.success === false || response.error) {
        throw new Error(response?.error || 'Plugin action returned no result.');
    }
    return response;
}
