import {validatePluginMetadata} from "@anikitenko/fdo-sdk";

export function normalizeAndValidatePluginMetadata(metadata) {
    return validatePluginMetadata({
        ...metadata,
        icon: typeof metadata?.icon === "string" ? metadata.icon.toLowerCase() : metadata?.icon,
    });
}
