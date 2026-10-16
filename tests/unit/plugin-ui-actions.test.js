import {invokePluginUiAction} from '../../src/utils/plugins/runtime/pluginUiActions';
test.each(['sidebar', 'quick-bar'])('%s dispatches the registered handler with action identity', async source => {
    const bridge = jest.fn(async () => ({ok: true}));
    await invokePluginUiAction('plugin-one', {id: 'copy', message_type: 'copyItem'}, source, bridge);
    expect(bridge).toHaveBeenCalledWith('plugin-one', {handler: 'copyItem', content: {source, actionId: 'copy'}});
});
test('surfaces handler failures', async () => {
    await expect(invokePluginUiAction('one', {message_type: 'copy'}, 'sidebar', async () => ({ok: false, error: 'Failed'}))).rejects.toThrow('Failed');
});

test.each([{ok: true, result: {success: false, error: 'Rejected by plugin'}}, {ok: true, result: {ok: false, error: {message: 'Rejected by plugin'}}}])('surfaces failures inside successful transport envelopes', async response => {
    await expect(invokePluginUiAction('one', {message_type: 'copy'}, 'sidebar', async () => response)).rejects.toThrow('Rejected by plugin');
});
test.each(['__sdk.getDiagnostics', 'fdo.tray.v1', ''])('refuses reserved or empty handlers: %s', async handler => {
    const bridge = jest.fn();
    await expect(invokePluginUiAction('one', {message_type: handler}, 'sidebar', bridge)).rejects.toThrow('registered plugin handler');
    expect(bridge).not.toHaveBeenCalled();
});

const {normalizePluginUiExtensions, pluginUiActionKey} = require('../../src/utils/plugins/runtime/pluginUiActions');
test('normalizes registrations, rejects malformed/reserved actions and deduplicates sidebar identities', () => {
    const registration = normalizePluginUiExtensions({quickActions: [null, {name: 'Bad', message_type: '__sdk.getDiagnostics'},
        {name: ' Inspect ', message_type: ' inspect '}, {name: 'Inspect', message_type: 'inspect'}],
        sidePanelActions: {label: ' Tools ', submenu_list: [{id: 'one', name: 'One', message_type: 'one'}, {id: 'one', name: 'Duplicate', message_type: 'two'}]}});
    expect(registration.quickActions).toEqual([{id: 'Inspect', name: 'Inspect', message_type: 'inspect', subtitle: ''}]);
    expect(registration.sidePanelActions.label).toBe('Tools');
    expect(registration.sidePanelActions.submenu_list).toHaveLength(1);
});
test('action identities preserve Unicode and punctuation and do not collide after slugging', () => {
    expect(pluginUiActionKey('one', {name: 'A+B', message_type: 'run'})).not.toBe(pluginUiActionKey('one', {name: 'AB', message_type: 'run'}));
    expect(pluginUiActionKey('one', {id: 'stable', name: 'Before', message_type: 'run'})).toBe(pluginUiActionKey('one', {id: 'stable', name: 'After', message_type: 'run'}));
});
