jest.mock('electron', () => ({}));
import {createPluginTrayService} from '../../src/utils/plugins/runtime/pluginTray';
import icons from '../../src/utils/ai/assistant/fdoAiTrayIcons.json';

const config = {operation: 'set', icon: icons.color[1].dataURL, tooltip: 'Tools ready',
    items: [{id: 'copy', label: 'Copy item', handler: 'copyItem'}]};
function setup(platform = 'darwin') {
    const trays = [];
    const Tray = jest.fn(() => {
        const tray = {setImage: jest.fn(), setToolTip: jest.fn(), setContextMenu: jest.fn(), destroy: jest.fn()};
        trays.push(tray);
        return tray;
    });
    const image = {isEmpty: () => false, resize: jest.fn(), setTemplateImage: jest.fn()};
    image.resize.mockReturnValue(image);
    const nativeImage = {createFromDataURL: jest.fn(() => image)};
    const service = createPluginTrayService({Tray, Menu: {buildFromTemplate: items => items}, nativeImage, platform});
    const plugins = {one: {grantedCapabilities: ['system.tray']}, two: {grantedCapabilities: ['system.tray']}};
    const invoke = jest.fn(async () => ({ok: true}));
    const reportError = jest.fn();
    service.configure({getPlugin: id => plugins[id], invoke, reportError});
    return {service, plugins, trays, Tray, invoke, reportError, nativeImage, image};
}
test.each(['darwin', 'win32', 'linux'])('%s supports independent plugin trays and updates without duplicate icons', async platform => {
    const {service, trays, Tray, invoke, plugins} = setup(platform);
    expect(service.request('one', config)).toEqual({ok: true});
    expect(service.request('two', config)).toEqual({ok: true});
    const oldClick = trays[0].setContextMenu.mock.calls[0][0][2].click;
    expect(service.request('one', {...config, tooltip: 'Updated'})).toEqual({ok: true});
    expect(Tray).toHaveBeenCalledTimes(2);
    await oldClick();
    expect(invoke).not.toHaveBeenCalled();
    await trays[0].setContextMenu.mock.calls[1][0][2].click();
    expect(invoke).toHaveBeenCalledWith('one', plugins.one, {handler: 'copyItem', content: {source: 'tray', actionId: 'copy'}});
    service.request('one', {operation: 'remove'});
    expect(trays[0].destroy).toHaveBeenCalledTimes(1);
    expect(trays[1].destroy).not.toHaveBeenCalled();
    service.dispose();
    expect(trays[1].destroy).toHaveBeenCalledTimes(1);
});
test('denies missing grants and unloaded plugins before touching native APIs', () => {
    const {service, plugins, Tray} = setup();
    plugins.one.grantedCapabilities = [];
    expect(service.request('one', config).code).toBe('CAPABILITY_DENIED');
    expect(service.request('unknown', config).code).toBe('PLUGIN_NOT_LOADED');
    expect(Tray).not.toHaveBeenCalled();
});
test('stale menus cannot invoke a replacement runtime or use revoked permission', async () => {
    const {service, plugins, trays, invoke} = setup();
    service.request('one', config);
    const click = trays[0].setContextMenu.mock.calls[0][0][2].click;
    const original = plugins.one;
    plugins.one = {...original};
    await click();
    expect(invoke).not.toHaveBeenCalled();
    plugins.one = original;
    original.grantedCapabilities = [];
    await click();
    expect(trays[0].destroy).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
});
test.each([
    {icon: 'https://example.com/icon.png'}, {items: []}, {items: Array(21).fill(config.items[0])},
    {items: [config.items[0], config.items[0]]}, {items: [{id: 'x', label: 'x', handler: '__host.privilegedAction'}]},
    {tooltip: 'x'.repeat(121)}, {operation: 'unknown'},
])('rejects malformed registration before native creation: %j', patch => {
    const {service, Tray} = setup();
    expect(service.request('one', {...config, ...patch}).ok).toBe(false);
    expect(Tray).not.toHaveBeenCalled();
});
test('suppresses repeated clicks in flight and reports handler errors', async () => {
    const {service, trays, invoke, reportError} = setup();
    let finish;
    invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    service.request('one', config);
    const click = trays[0].setContextMenu.mock.calls[0][0][2].click;
    const pending = click();
    await click();
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ok: false, error: 'Copy failed'});
    await pending;
    expect(reportError).toHaveBeenCalledWith('one', 'Copy failed');
});
