import {Tray, Menu, nativeImage} from 'electron';

export const PLUGIN_TRAY_HANDLER = 'fdo.tray.v1';
export const PLUGIN_TRAY_CAPABILITY = 'system.tray';

export function createPluginTrayService({Tray, Menu, nativeImage, platform = process.platform}) {
    const entries = new Map();
    let getPlugin = () => null;
    let invoke;
    let reportError = () => {};
    const remove = id => {
        const entry = entries.get(id);
        entries.delete(id);
        entry?.tray.destroy();
    };
    const fail = (code, error) => ({ok: false, code, error});
    return {
        configure(options) { ({getPlugin, invoke, reportError} = options); },
        remove,
        dispose() { [...entries.keys()].forEach(remove); },
        request(id, payload = {}) {
            const plugin = getPlugin(id);
            if (!plugin) return fail('PLUGIN_NOT_LOADED', 'The plugin is not running.');
            if (!plugin.grantedCapabilities?.includes(PLUGIN_TRAY_CAPABILITY)) {
                remove(id);
                return fail('CAPABILITY_DENIED', 'Grant system.tray to allow this plugin to use the system tray.');
            }
            if (payload?.operation === 'remove') { remove(id); return {ok: true}; }
            try {
                if (payload?.operation !== 'set') throw new Error('Tray operation must be set or remove.');
                if (typeof payload.icon !== 'string' || payload.icon.length > 180000
                    || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(payload.icon)) throw new Error('Tray icon must be a PNG data URL of at most 128 KiB.');
                const bytes = Buffer.from(payload.icon.split(',')[1], 'base64');
                if (bytes.length < 24 || bytes.length > 131072 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
                    || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1
                    || bytes.readUInt32BE(16) > 256 || bytes.readUInt32BE(20) > 256) throw new Error('Tray PNG dimensions must be between 1 and 256 pixels.');
                const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
                if (!text(payload.tooltip, 120)) throw new Error('Tray tooltip must contain 1–120 characters.');
                if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 20) throw new Error('Tray menu requires 1–20 items.');
                const ids = new Set();
                for (const item of payload.items) {
                    if (!text(item?.id, 80) || ids.has(item.id) || !text(item.label, 80)
                        || !text(item.handler, 120) || item.handler.startsWith('__') || item.handler.startsWith('fdo.')
                        || (item.enabled !== undefined && typeof item.enabled !== 'boolean')) throw new Error('Each tray item needs a unique id, label, and plugin handler.');
                    ids.add(item.id);
                }
                const image = nativeImage.createFromDataURL(payload.icon);
                if (image.isEmpty()) throw new Error('Tray icon could not be decoded.');
                const sizedImage = image.resize({width: platform === 'darwin' ? 18 : 24, height: platform === 'darwin' ? 18 : 24});
                if (platform === 'darwin') sizedImage.setTemplateImage(payload.template === true);
                const entry = {plugin, tray: entries.get(id)?.tray, busy: false};
                const menu = Menu.buildFromTemplate([
                    {label: id.replace(/&/g, '&&'), enabled: false},
                    {type: 'separator'},
                    ...payload.items.map(item => ({label: item.label.replace(/&/g, '&&'), enabled: item.enabled !== false,
                        click: async () => {
                            // Stale menus cannot reach a replacement runtime or survive revocation.
                            if (entries.get(id) !== entry || getPlugin(id) !== plugin || entry.busy) return;
                            if (!plugin.grantedCapabilities?.includes(PLUGIN_TRAY_CAPABILITY)) { remove(id); return; }
                            entry.busy = true;
                            try {
                                const result = await invoke(id, plugin, {handler: item.handler, content: {source: 'tray', actionId: item.id}});
                                if (!result || result.ok === false || result.success === false) throw new Error(result?.error || 'Plugin action returned no result.');
                            } catch (error) { reportError(id, error.message); }
                            finally { entry.busy = false; }
                        }})),
                ]);
                const created = !entry.tray;
                if (created) entry.tray = new Tray(sizedImage);
                try {
                    entry.tray.setImage(sizedImage);
                    entry.tray.setToolTip(`${id} — ${payload.tooltip}`);
                    entry.tray.setContextMenu(menu);
                    entries.set(id, entry);
                } catch (error) {
                    if (created) entry.tray.destroy();
                    throw error;
                }
                return {ok: true};
            } catch (error) { return fail('PLUGIN_TRAY_INVALID', error.message); }
        },
    };
}

export const pluginTray = createPluginTrayService({Tray, Menu, nativeImage});
