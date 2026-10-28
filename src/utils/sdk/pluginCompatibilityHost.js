import fs from 'node:fs';
import path from 'node:path';
import {pluginAuthoringHost} from './pluginAuthoringContract';
import {defaultPluginRequirements, evaluatePluginCompatibility, normalizePluginRequirements, readPluginBuildCompatibility} from './pluginCompatibility';

export function pluginCompatibilityHost() {
    return pluginAuthoringHost();
}

export function inspectPluginCompatibility(packageText, bundle = '', host = pluginCompatibilityHost()) {
    try {
        const pkg = JSON.parse(packageText);
        return evaluatePluginCompatibility({declaration: pkg.fdo?.compatibility, artifact: readPluginBuildCompatibility(bundle)}, host);
    } catch (error) {
        return {status: 'incompatible', supportedFdo: 'Invalid declaration', currentFdo: host.fdo, currentSdk: host.sdk,
            issues: [error.message], summary: 'Plugin compatibility information could not be read.', remediation: 'Reinstall a valid plugin or ask its maintainer to rebuild it.'};
    }
}

export function inspectSourcePluginCompatibility(packageText, host = pluginCompatibilityHost()) {
    try {
        const pkg = JSON.parse(packageText);
        const declaration = pkg.fdo?.compatibility;
        if (declaration === null) return inspectPluginCompatibility(packageText, '', host);
        return evaluatePluginCompatibility({declaration: declaration === undefined ? defaultPluginRequirements(host)
            : {...defaultPluginRequirements(host), ...normalizePluginRequirements(declaration)}}, host);
    } catch {
        return inspectPluginCompatibility(packageText, '', host);
    }
}

function unreadablePluginCompatibility(message) {
    return {status: 'incompatible', supportedFdo: 'Unavailable', issues: [message],
        summary: 'Plugin compatibility could not be checked.', remediation: 'Reinstall the plugin from a complete export.'};
}

export function installedPluginCompatibility(home, entry) {
    try {
        const root = path.resolve(home), runtime = path.resolve(root, entry);
        const relative = path.relative(root, runtime);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            return unreadablePluginCompatibility('Plugin runtime must be inside the plugin folder.');
        }
        const descriptor = fs.openSync(runtime, 'r');
        let header;
        try {
            const buffer = Buffer.alloc(16385);
            header = buffer.subarray(0, fs.readSync(descriptor, buffer, 0, buffer.length, 0)).toString('utf8');
        } finally {fs.closeSync(descriptor);}
        const packagePath = path.join(root, 'package.json');
        return inspectPluginCompatibility(fs.existsSync(packagePath) ? fs.readFileSync(packagePath, 'utf8') : '{}', header);
    } catch (error) {
        return unreadablePluginCompatibility(error.message);
    }
}
