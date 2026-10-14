# Plugin tray, sidebar, and quick actions

Quick actions and sidebar items use the SDK's existing `QuickActionMixin` and
`SidePanelMixin`. Their `message_type` names a handler registered with
`PluginRegistry.registerHandler`. FDO now invokes that handler, selects the
plugin, refreshes its rendered view after success, and reports failures through a toast. Repeat clicks on an in-flight
action are ignored. Registration is replaced on init and removed on unload.
The host restores registrations when its UI mounts after plugin initialization.

```ts
import {FDO_SDK, PluginRegistry, QuickActionMixin, SidePanelMixin} from '@anikitenko/fdo-sdk';

class Tools extends SidePanelMixin(QuickActionMixin(FDO_SDK)) {
    // Also provide your plugin metadata and render() implementation.
    defineQuickActions() {
        return [{name: 'Copy snippet', message_type: 'copySnippet', icon: 'clipboard'}];
    }
    defineSidePanel() {
        return {icon: 'clipboard', label: 'Snippet tools', submenu_list: [
            {id: 'copy', name: 'Copy snippet', message_type: 'copySnippet'},
        ]};
    }
    init() {
        PluginRegistry.registerHandler('copySnippet', async ({source, actionId}) => {
            // Perform your action here. Existing clipboard permissions still apply.
            return {success: true};
        });
    }
}
```

Handlers receive `{source: 'quick-bar' | 'sidebar' | 'tray', actionId: string}`.
Quick actions without an id use their name as `actionId`. Register ordinary
plugin handlers; host-reserved names (`fdo.*` and `__*`) are not action targets.

## System tray

Declare `system.tray` with `declareCapabilities() { return ['system.tray']; }`
and grant it under Manage
Plugins → Capabilities. This permission permits one native icon per running
plugin. It grants no filesystem, clipboard, network, or process access.

Both the plugin runtime and its iframe can call the existing host bridge; no
SDK package change or direct Electron import is necessary:

```ts
const response = await window.createBackendReq('UI_MESSAGE', {
    handler: 'fdo.tray.v1',
    content: {
        operation: 'set',
        icon: pngDataUrl, // data:image/png;base64,...; bundle your own icon
        tooltip: 'Snippets ready',
        template: true, // macOS only: black/transparent artwork adapts to the menu bar
        items: [
            {id: 'copy', label: 'Copy latest snippet', handler: 'copySnippet'},
            {id: 'clear', label: 'Clear snippets', handler: 'clearSnippets', enabled: false},
        ],
    },
});
if (!response.ok) throw new Error(response.error);
```

Call `set` again with the complete configuration to update the same icon/menu.
PNG images must be at most 128 KiB and 256×256 pixels; URLs and filesystem paths
are not accepted. Use a tooltip of 1–120 characters and 1–20 menu items with
unique ids. Labels are limited to 80 characters. The menu identifies its owning
plugin. Menu actions run without opening a window and use the same serialized
backend dispatch as other host UI actions. Failures appear in FDO notifications.

```ts
await window.createBackendReq('UI_MESSAGE', {
    handler: 'fdo.tray.v1', content: {operation: 'remove'},
});
```

Icons are removed on plugin unload/crash, capability revocation, and app exit.
Stale menus cannot invoke a replacement plugin runtime. The AI coding-agent tray
is independent of plugin trays. Windows may place icons in overflow; Linux needs
a desktop with system tray support. This feature does not keep a stopped plugin
running or automatically activate it at application startup.

The executable integration fixture is `tests/fixtures/plugin-ui-surfaces.ts`;
`tests/e2e/plugin-ui-surfaces.spec.js` exercises all three surfaces in Electron.
