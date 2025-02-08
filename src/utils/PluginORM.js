import JSONORM from "./JSONORM";

export default class PluginORM extends JSONORM {
    constructor(filePath) {
        super(filePath); // Call the base class
        if (!this.data.plugins) this.data.plugins = []; // Ensure array exists
    }

    // Add a plugin
    addPlugin(pluginName, metadata, path) {
        if (!this.data.plugins.includes(pluginName)) {
            this.data.plugins.push({id: pluginName, metadata: metadata, path: path});
            this._save();
        }
    }

    // Get all plugins
    getAllPlugins() {
        return this.data.plugins;
    }

    getPlugin(id) {
        return this.data.plugins.find(plugin => plugin.id === id);
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
