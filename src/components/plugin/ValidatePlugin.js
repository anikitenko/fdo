import { existsSync } from 'fs';

function isValidPlugin(pluginInstance) {
    return (
        pluginInstance &&
        typeof pluginInstance.init === "function" &&
        typeof pluginInstance.render === "function" &&
        pluginInstance.metadata &&
        typeof pluginInstance.metadata.name === "string"
    );
}

export default async function ValidatePlugin(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Plugin file does not exist: ${filePath}`);
    }

    try {
        const pluginModule = await import(/* webpackIgnore: true */ filePath);
        const PluginClass = pluginModule.default;
        const pluginInstance = new PluginClass();
        throw new Error(`In testing.,.`);
        return isValidPlugin(pluginInstance) ? pluginInstance : null
    } catch (err) {
        throw new Error(`Failed to load plugin: ${err.message}`);
    }
}
