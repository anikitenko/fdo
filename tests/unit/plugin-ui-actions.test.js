import {invokePluginUiAction} from '../../src/utils/plugins/runtime/pluginUiActions';
test.each(['sidebar', 'quick-bar'])('%s dispatches the registered handler with action identity', async source => {
    const bridge = jest.fn(async () => ({ok: true}));
    await invokePluginUiAction('plugin-one', {id: 'copy', message_type: 'copyItem'}, source, bridge);
    expect(bridge).toHaveBeenCalledWith('plugin-one', {handler: 'copyItem', content: {source, actionId: 'copy'}});
});
test('surfaces handler failures', async () => {
    await expect(invokePluginUiAction('one', {message_type: 'copy'}, 'sidebar', async () => ({ok: false, error: 'Failed'}))).rejects.toThrow('Failed');
});
