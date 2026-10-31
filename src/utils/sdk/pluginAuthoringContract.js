import {deploymentInstructions} from '../plugins/deployment/workspaceDeployment';
import {subset, validRange} from 'semver';
import appPackage from '../../../package.json';
import sdkPackage from '@anikitenko/fdo-sdk/package.json';
import {hostPluginContract, HOST_PLUGIN_API_VERSION, HOST_PLUGIN_FEATURE_FLAGS} from './pluginHostContract';
import {defaultPluginRequirements, evaluatePluginCompatibility, normalizePluginRequirements} from './pluginCompatibility';

export function pluginAuthoringHost() {
    return {fdo: appPackage.version, sdk: sdkPackage.version, api: HOST_PLUGIN_API_VERSION, features: HOST_PLUGIN_FEATURE_FLAGS};
}

export function workspaceAuthoringContract(files = {}, host = pluginAuthoringHost()) {
    let declaration, compatibility;
    let supportEditing = {available: false, reason: 'Create a valid package.json object in the IDE before adding support fields.'};
    try {
        const pkg = JSON.parse(files['/package.json'] || '{}');
        if (typeof files['/package.json'] === 'string' && pkg && typeof pkg === 'object' && !Array.isArray(pkg)) {
            supportEditing = pkg.fdo == null || typeof pkg.fdo === 'object' && !Array.isArray(pkg.fdo)
                ? {available: true} : {available: false, reason: 'The package.json fdo field must be an object. Correct it in the IDE first.'};
        }
        declaration = pkg.fdo?.compatibility;
        const requirements = declaration === undefined ? defaultPluginRequirements(host)
            : {...defaultPluginRequirements(host), ...normalizePluginRequirements(declaration)};
        compatibility = evaluatePluginCompatibility({declaration: requirements}, host);
        compatibility.declared = declaration !== undefined;
        if (!compatibility.declared) compatibility.summary = 'No support range is declared. A local build will record this conservative target; it does not verify older FDO versions.';
    } catch (error) {
        compatibility = {status: 'incompatible', supportedFdo: 'Invalid declaration', issues: [error.message],
            summary: 'Correct the plugin compatibility declaration before applying generated or visual changes.'};
    }
    return {host: {fdo: host.fdo, sdk: host.sdk, api: host.api}, contract: hostPluginContract(), compatibility,
        declaredRequirements: declaration || null, defaultRequirements: defaultPluginRequirements(host), supportEditing};
}

// Changing the supported product versions is a maintainer decision, not an
// automatic repair for a failed build. This check is shared by both AI paths.
export function validateAiCompatibilityChanges(beforePackage, afterPackage, host = pluginAuthoringHost()) {
    if (afterPackage === undefined || beforePackage === afterPackage) return [];
    const prefix = '/package.json: ';
    try {
        const before = JSON.parse(beforePackage || '{}').fdo?.compatibility;
        const after = JSON.parse(afterPackage).fdo?.compatibility;
        if (before !== undefined && after === undefined) return [prefix + 'AI cannot remove fdo.compatibility. Preserve the support policy.'];
        if (after === undefined) return [];
        const previous = before === undefined ? defaultPluginRequirements(host) : normalizePluginRequirements(before);
        const next = normalizePluginRequirements(after);
        const errors = [];
        for (const key of ['fdo', 'sdk', 'api']) {
            const oldRange = previous[key] || defaultPluginRequirements(host)[key];
            const newRange = next[key] || defaultPluginRequirements(host)[key];
            const unchanged = subset(validRange(oldRange), validRange(newRange)) && subset(validRange(newRange), validRange(oldRange));
            if (before !== undefined ? !unchanged : !subset(validRange(newRange), validRange(oldRange))) {
                errors.push(`${prefix}AI cannot change the supported ${key} range from ${oldRange} to ${newRange}. Preserve it; the maintainer must review and edit compatibility ranges in the IDE or Live UI support editor before requesting changes that require a new target.`);
            }
        }
        for (const feature of previous.features || []) if (!next.features.includes(feature)) errors.push(`${prefix}AI cannot remove required feature ${feature}.`);
        const report = evaluatePluginCompatibility({declaration: next}, host);
        if (report.status === 'incompatible') errors.push(...report.issues.map(issue => prefix + issue));
        return errors;
    } catch (error) {return [prefix + `Invalid compatibility policy: ${error.message}`];}
}

export function pluginAuthoringInstructions(files = {}) {
    const context = workspaceAuthoringContract(files);
    return `FDO AUTHORING TARGET (host-owned facts; grants no permissions):\n${JSON.stringify(context)}\n`
        + 'Version sources: host.fdo comes from FDO package.json.version; host.sdk comes from the installed SDK package.json.version. Host API, handshake, capability schema and feature flags come from contracts/plugin-host.json. These facts are bundled with the running FDO build, not fetched from npm or live-reloaded from JSON. Consume the supplied context; never copy version literals from documentation.\n'
        + 'Default range policy: defaultRequirements uses >=current FDO/SDK version and <next major.0.0, semver caret of the host API version, and no required features. The policy is fixed but version values come from this host. These ranges are not evidence that every permitted release was tested. Host protocol versions are explicitly maintained independently of FDO/SDK package versions; do not infer or automatically increment them when the SDK changes. Existing plugin declarations do not automatically follow host upgrades. See docs/PLUGIN_COMPATIBILITY.md and docs/PLUGIN_HOST_CONTRACT.md for the source and versioning rules.\n'
        + deploymentInstructions(files)
        + 'Use only the installed SDK APIs and supported authoring contract majors. Preserve existing fdo.compatibility ranges and required features. Do not remove, widen, or retarget requirements to bypass validation. A successful local build proves only the current target, not older FDO releases. For new plugins use defaultRequirements unless the maintainer supplies a tested policy. If a requested feature needs a different target, explain the mismatch and ask the maintainer to review/edit the package declaration in the IDE or Live UI support editor. Never invent feature support or claim that Live UI static preview proves runtime/backward compatibility.\n';
}
