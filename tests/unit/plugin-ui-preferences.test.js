import {movePluginUiItem, normalizePluginUiPreferences, orderPluginUiItems, readPluginUiPreferences} from '../../src/utils/plugins/runtime/pluginUiPreferences';

test('invalid saved data falls back to defaults; only unique string identities survive', () => {
    expect(readPluginUiPreferences({getItem: () => '{broken'})).toEqual(normalizePluginUiPreferences());
    expect(normalizePluginUiPreferences({pinnedActionIds: ['one', null, 'one'], sidebarOrder: 42}).pinnedActionIds).toEqual(['one']);
});
test('saved order survives missing plugins and reactivation without mutating registration order', () => {
    const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const order = movePluginUiItem(items, ['inactive', 'b', 'a'], 'c', -1);
    expect(order).toEqual(['b', 'c', 'a', 'inactive']);
    expect(orderPluginUiItems([...items, {id: 'inactive'}], order).map(item => item.id)).toEqual(order);
    expect(items.map(item => item.id)).toEqual(['a', 'b', 'c']);
});
