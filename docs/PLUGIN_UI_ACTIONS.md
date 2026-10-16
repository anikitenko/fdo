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

## Discovering and customizing shortcuts

Activate the plugin first. Its quick actions appear in command search (header
search field, Ctrl+K / ⌘K), grouped under the plugin name. Search matches action
names, descriptions, and plugin names. Sidebar menus appear in the right sidebar;
use **Show right sidebar** in the header if it is hidden. Sidebar buttons have
accessible names matching their labels, and the selected plugin is highlighted.
When the window is short, **More plugins** contains the same submenu actions.

Use **Customize plugin shortcuts** in the header to:

- Pin quick actions to **Pinned plugin actions** at the top of command search.
- Arrange pinned actions with the up/down controls.
- Show/hide plugin sidebar menus and arrange their order.
- Restore the defaults with **Reset shortcuts**.

Preferences apply immediately and are saved locally on this device. They survive
window reloads and plugin deactivation/reactivation. Only running plugins expose
live actions; pinning does not activate a plugin or grant permissions. System
sidebar entries remain visible and keep their order. A storage failure is reported
in the dialog; in that case changes last only for the current window.

While an action runs, other shortcuts for that plugin are unavailable. An action
failure produces an error toast and can be retried by selecting the action again.
FDO refreshes the view only after a successful handler response; it also reports a
failed render request. Confirmed unloads/redeployments invalidate pending view
refreshes. An ignored stale unload event does not erase live shortcuts.

## Example to try

Use the installed SDK's **04-ui-extensions-plugin.ts** example at
`node_modules/@anikitenko/fdo-sdk/examples/04-ui-extensions-plugin.ts`.
It already provides three quick actions (Search Plugin Data, Create New Item,
Plugin Settings) and the UI Extensions sidebar with Dashboard, Reports, and
Settings. No external service or AI provider is needed.

After deploying and activating it:

1. Open command search and select **Search Plugin Data**. The plugin opens its
   Search View without an additional Render click.
2. Show the right sidebar, open **UI Extensions**, and select **Reports**.
3. Pin Search Plugin Data and Create New Item in Plugin shortcuts, change their
   order, then reopen command search to see them first.
4. Hide the UI Extensions sidebar entry, reload FDO, and confirm the choice is
   retained. Re-enable it in Plugin shortcuts.
5. Deactivate and reactivate the plugin: registrations disappear and return,
   while your shortcut preferences remain.

Run the native example test (including real host-control clicks, saved
preferences, lifecycle cleanup, and handler failures):

```sh
npx playwright test tests/e2e/sdk-example-04-ui-extensions-plugin.spec.js --workers=1
```

Build the application first if the source has changed. The separate
`plugin-ui-surfaces.spec.js` also covers native tray registration and revocation.
