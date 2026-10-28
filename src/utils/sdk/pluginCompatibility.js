import {valid, validRange, satisfies, major} from 'semver';
import {HOST_PLUGIN_MANIFEST_SCHEMA_VERSION, HOST_SUPPORTED_PLUGIN_MANIFEST_SCHEMAS} from './pluginHostContract';

export const PLUGIN_COMPATIBILITY_PREFIX = '// FDO_PLUGIN_COMPATIBILITY:';
const OPTIONS = {};

function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePluginRequirements(value) {
    if (!object(value)) throw new Error('fdo.compatibility must be an object.');
    const unknown = Object.keys(value).find(key => !['fdo', 'sdk', 'api', 'features'].includes(key));
    if (unknown) throw new Error(`Unknown fdo.compatibility field: ${unknown}. Use fdo, sdk, api, or features.`);
    const result = {};
    for (const key of ['fdo', 'sdk', 'api']) {
        if (key !== 'fdo' && value[key] === undefined) continue;
        if (typeof value[key] !== 'string' || value[key].length > 200 || !value[key].trim() || !validRange(value[key])) {
            throw new Error(`fdo.compatibility.${key} must be a valid version range.`);
        }
        result[key] = value[key].trim();
    }
    if (value.features !== undefined && (!Array.isArray(value.features) || value.features.length > 100
        || value.features.some(flag => typeof flag !== 'string' || !/^[a-zA-Z][a-zA-Z0-9.:-]{0,99}$/.test(flag)))) {
        throw new Error('fdo.compatibility.features must be a list of feature names.');
    }
    result.features = [...new Set(value.features || [])];
    return result;
}

export function readPluginBuildCompatibility(bundle = '') {
    const firstLine = String(bundle).split('\n', 1)[0];
    if (!firstLine.startsWith(PLUGIN_COMPATIBILITY_PREFIX)) return null;
    if (firstLine.length > 16384) throw new Error('Plugin compatibility manifest is too large.');
    const artifact = JSON.parse(firstLine.slice(PLUGIN_COMPATIBILITY_PREFIX.length));
    if (!object(artifact) || !HOST_SUPPORTED_PLUGIN_MANIFEST_SCHEMAS.includes(artifact.schemaVersion) || !object(artifact.builtWith)
        || !['fdo', 'sdk', 'api'].every(key => valid(artifact.builtWith[key]))) {
        throw new Error('Plugin build compatibility manifest is invalid or unsupported.');
    }
    return {schemaVersion: artifact.schemaVersion, requirements: normalizePluginRequirements(artifact.requirements),
        builtWith: Object.fromEntries(['fdo', 'sdk', 'api'].map(key => [key, artifact.builtWith[key]]))};
}

export function evaluatePluginCompatibility({declaration, artifact} = {}, host) {
    try {
        const declared = declaration === undefined ? null : normalizePluginRequirements(declaration);
        // Enforce both: editing package.json cannot weaken the compiled artifact's requirements.
        const requirements = [declared, artifact?.requirements].filter(Boolean);
        const issues = [];
        for (const requirement of requirements) {
            for (const key of ['fdo', 'sdk', 'api']) {
                if (requirement[key] && !satisfies(host[key], requirement[key], OPTIONS)) {
                    issues.push(`Requires ${key === 'fdo' ? 'FDO' : key === 'sdk' ? 'SDK' : 'host API'} ${requirement[key]}; this installation provides ${host[key]}.`);
                }
            }
            for (const feature of requirement.features || []) {
                if (host.features?.[feature] !== true) issues.push(`Required host/SDK feature is unavailable: ${feature}.`);
            }
        }
        const supportedFdo = [...new Set(requirements.map(item => item.fdo))].join(' and ') || 'Not declared';
        const status = issues.length ? 'incompatible' : requirements.length ? 'compatible' : 'unverified';
        return {status, supportedFdo, currentFdo: host.fdo, currentSdk: host.sdk, builtWith: artifact?.builtWith || null,
            issues: [...new Set(issues)], summary: status === 'incompatible' ? 'This plugin cannot run on this FDO installation.'
                : status === 'unverified' ? 'Supported FDO versions are not declared.' : 'This FDO installation meets the plugin requirements.',
            remediation: status === 'incompatible' ? 'Install a supported FDO version or ask the plugin maintainer for a compatible build.'
                : status === 'unverified' ? 'Ask the maintainer for a build with compatibility information. Legacy plugins may still run.' : ''};
    } catch (error) {
        return {status: 'incompatible', supportedFdo: 'Invalid declaration', currentFdo: host.fdo, currentSdk: host.sdk,
            issues: [error.message], summary: 'Plugin compatibility information is invalid.', remediation: 'Ask the maintainer to correct the compatibility declaration and rebuild the plugin.'};
    }
}

export function assertPluginCompatibility(report) {
    if (report?.status === 'incompatible') {
        const error = new Error([report.summary, ...report.issues, report.remediation].join(' '));
        error.code = 'PLUGIN_HOST_INCOMPATIBLE';
        error.compatibility = report;
        throw error;
    }
    return report;
}

export function defaultPluginRequirements(host) {
    return {
        fdo: `>=${host.fdo} <${major(host.fdo) + 1}.0.0`,
        sdk: `>=${host.sdk} <${major(host.sdk) + 1}.0.0`,
        api: `^${host.api}`, features: [],
    };
}

export function pluginCompatibilityBanner(declaration, host) {
    const requirements = declaration === undefined ? defaultPluginRequirements(host)
        : {...defaultPluginRequirements(host), ...normalizePluginRequirements(declaration)};
    const artifact = {schemaVersion: HOST_PLUGIN_MANIFEST_SCHEMA_VERSION, requirements, builtWith: {fdo: host.fdo, sdk: host.sdk, api: host.api}};
    assertPluginCompatibility(evaluatePluginCompatibility({artifact}, host));
    return PLUGIN_COMPATIBILITY_PREFIX + JSON.stringify(artifact);
}
