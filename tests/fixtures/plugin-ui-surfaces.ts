import {FDO_SDK, PluginRegistry, QuickActionMixin, SidePanelMixin} from '@anikitenko/fdo-sdk';
import icons from '../../src/utils/ai/assistant/fdoAiTrayIcons.json';

class SurfacePlugin extends SidePanelMixin(QuickActionMixin(FDO_SDK)) {
    private lastAction = 'none';
    get metadata() { return {name: 'UI Surfaces', version: '1.0.0', author: 'FDO', description: 'Local UI action regression', icon: 'cog'}; }
    declareCapabilities() { return ['system.tray']; }
    defineQuickActions() { return [{name: 'Surface quick action', message_type: 'quick', icon: 'cog'}]; }
    defineSidePanel() { return {icon: 'cog', label: 'Surface sidebar', submenu_list: [{id: 'side', name: 'Surface side action', message_type: 'side'}]}; }
    init() {
        const events: string[] = [];
        for (const name of ['quick', 'side', 'tray']) PluginRegistry.registerHandler(name, () => { this.lastAction = name; events.push(name); return {events}; });
        PluginRegistry.registerHandler('events', () => ({events}));
        PluginRegistry.registerHandler('exitFixture', () => { setTimeout(() => process.exit(1), 200); return {ok: true}; });
        PluginRegistry.registerHandler('registerTray', () => window.createBackendReq('UI_MESSAGE', {handler: 'fdo.tray.v1', content: {
            operation: 'set', icon: icons.color[1].dataURL, tooltip: 'Surface fixture',
            items: [{id: 'tray', label: 'Surface tray action', handler: 'tray'}],
        }}));
    }
    render() { return `<div>Last action: ${this.lastAction}</div>`; }
}
new SurfacePlugin();
