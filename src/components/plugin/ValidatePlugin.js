import {existsSync} from "node:fs";
import {FDO_SDK} from "@anikitenko/fdo-sdk";

export default function ValidatePlugin(filePath) {

    if (!existsSync(filePath)) {
        throw new Error(`Plugin file does not exist: ${filePath}`);
    }

    import("/Users/oleksandr.nykytenko-contractor/Library/Application Support/fdo/plugins/dhhjfhjfhc.js").then(pluginModule => {
        const PluginClass = pluginModule.default;
        const pluginInstance = new PluginClass();
        const sdk = new FDO_SDK();
        console.log("sdgsdfgsdffasdgdsa: " + pluginInstance.init(sdk));
        if (pluginInstance instanceof FDO_SDK) {
            return pluginInstance;
        } else {
            throw new Error(`Failed to load plugin: ${err.message}`)
        }
    }).catch(err => {
        throw new Error(`Failed to load plugin: ${err.message}`)
    });
}
