import JSONORM from "./JSONORM";
import {normalizeCapabilityList} from "./pluginCapabilities";

export default class PluginORM extends JSONORM {
    constructor(filePath) {
        super(filePath); // Call the base class
        if (!this.data.plugins) this.data.plugins = []; // Ensure array exists
    }

    // Add a plugin
    normalizePluginRecord(plugin) {
        if (!plugin || typeof plugin !== "object") {
            return plugin;
        }
        return {
            ...plugin,
            capabilities: normalizeCapabilityList(plugin.capabilities),
        };
    }

    addPlugin(pluginName, metadata, home, entry, overwrite = false, capabilities = []) {
        if (overwrite) {
            this.removePlugin(pluginName);
        }
        if (!this.data.plugins.includes(pluginName)) {
            this.data.plugins.push(this.normalizePluginRecord({
                id: pluginName,
                metadata: metadata,
                home,
                entry,
                capabilities,
            }));
            this._save();
        }
    }

    // Get all plugins
    getAllPlugins() {
        return this.data.plugins.map((plugin) => this.normalizePluginRecord(plugin));
    }

    getPlugin(id) {
        const plugin = this.data.plugins.find(plugin => plugin.id === id);
        return this.normalizePluginRecord(plugin);
    }

    setPluginCapabilities(pluginName, capabilities = []) {
        const index = this.data.plugins.findIndex((plugin) => plugin.id === pluginName);
        if (index < 0) {
            return {success: false, error: `Plugin "${pluginName}" not found.`};
        }
        const normalized = normalizeCapabilityList(capabilities);
        this.data.plugins[index] = this.normalizePluginRecord({
            ...this.data.plugins[index],
            capabilities: normalized,
        });
        this._save();
        return {success: true, capabilities: normalized};
    }

    // Remove a plugin
    removePlugin(pluginName) {
        this.data.plugins = this.data.plugins.filter(p => p.id !== pluginName);
        this._save();
    }

    // Check if a plugin is installed
    isInstalled(pluginName) {
        if (this.data.plugins.length === 0) return false;
        return this.data.plugins.some(p => p.id === pluginName);
    }
}
