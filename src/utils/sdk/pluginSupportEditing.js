import {subset} from 'semver';
import {pluginAuthoringHost, workspaceAuthoringContract} from './pluginAuthoringContract';
import {defaultPluginRequirements, evaluatePluginCompatibility, normalizePluginRequirements} from './pluginCompatibility';

const PACKAGE = '/package.json';
const fields = ['fdo', 'sdk', 'api', 'features'];
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function readPackage(source) {
    if (typeof source !== 'string') throw new Error('A package.json file is required. Create it in the IDE first.');
    const pkg = JSON.parse(source);
    if (!isObject(pkg)) throw new Error('package.json must contain an object.');
    if (pkg.fdo != null && !isObject(pkg.fdo)) throw new Error('package.json fdo must be an object. Correct it in the IDE first.');
    return pkg;
}

function withoutSupport(pkg) {
    const copy = {...pkg};
    if (copy.fdo == null) delete copy.fdo;
    else {
        const {compatibility, ...rest} = copy.fdo;
        if (Object.keys(rest).length) copy.fdo = rest;
        else delete copy.fdo;
    }
    return copy;
}

// Used on both sides of IPC. A reviewed version edit may bypass a runtime build
// only because its entire write scope is verified to be this one metadata field.
export function reviewPluginSupportChange(beforeFiles, afterFiles, host = pluginAuthoringHost()) {
    const changed = [...new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])]
        .filter(file => beforeFiles[file] !== afterFiles[file]);
    if (changed.some(file => file !== PACKAGE)) throw new Error('A support-only edit cannot change source, scripts, or other files.');
    const before = readPackage(beforeFiles[PACKAGE]), after = readPackage(afterFiles[PACKAGE]);
    if (!changed.length) return {requirements: before.fdo?.compatibility || defaultPluginRequirements(host),
        compatibility: workspaceAuthoringContract(beforeFiles, host).compatibility, warnings: [], requiresAcknowledgement: false};
    if (JSON.stringify(withoutSupport(before)) !== JSON.stringify(withoutSupport(after))) {
        throw new Error('A support-only edit may change only package.json fdo.compatibility.');
    }
    const declaration = after.fdo?.compatibility;
    if (!isObject(declaration) || fields.some(field => !Object.hasOwn(declaration, field))) {
        throw new Error('Include the FDO, SDK, API and features support fields. Use the host defaults for missing fields.');
    }
    const requirements = normalizePluginRequirements(declaration);
    const compatibility = evaluatePluginCompatibility({declaration: requirements}, host);
    const warnings = [];
    try {
        const previous = before.fdo?.compatibility === undefined ? null : normalizePluginRequirements(before.fdo.compatibility);
        for (const field of ['fdo', 'sdk', 'api']) {
            if (!previous?.[field]) continue;
            if (!subset(requirements[field], previous[field])) warnings.push(`The supported ${field} range is widened. This host cannot verify compatibility with other installations.`);
            if (!subset(previous[field], requirements[field])) warnings.push(`The supported ${field} range is narrowed; some previously supported installations may be excluded.`);
        }
        for (const feature of previous?.features || []) if (!requirements.features.includes(feature)) warnings.push(`Required feature ${feature} is removed. Verify that the plugin no longer needs it.`);
    } catch {warnings.push('This replaces an invalid support declaration. Review the complete package.json diff.');}
    if (compatibility.status === 'incompatible') warnings.push(...compatibility.issues, 'The declaration can be saved, but this host cannot build or run that target. Visual editing will remain paused.');
    warnings.push('A support declaration is a maintainer claim, not proof that older hosts were tested. Rebuild and redeploy to update the installed plugin.');
    return {requirements, compatibility, warnings, requiresAcknowledgement: true};
}

export function planPluginSupportEdit(files, request, host = pluginAuthoringHost()) {
    const before = files[PACKAGE], pkg = readPackage(before);
    if (request.mode !== undefined && request.mode !== 'missing') throw new Error('Unknown support edit mode.');
    const requirements = normalizePluginRequirements(request.mode === 'missing'
        ? {...defaultPluginRequirements(host), ...(pkg.fdo?.compatibility || {})} : request.requirements);
    // The editor writes all fields, including optional fields omitted by legacy
    // plugins. Defaults come from the actual host, never UI version literals.
    const complete = {...defaultPluginRequirements(host), ...requirements};
    let existing;
    try {existing = normalizePluginRequirements(pkg.fdo?.compatibility);} catch { /* An invalid declaration can be corrected. */ }
    if (fields.every(field => Object.hasOwn(pkg.fdo?.compatibility || {}, field))
        && JSON.stringify(existing) === JSON.stringify(complete)) return null;
    pkg.fdo = {...(pkg.fdo || {}), compatibility: complete};
    const indent = before.match(/\n([\t ]+)"/)?.[1] || 2;
    const after = JSON.stringify(pkg, null, indent) + (before.endsWith('\n') ? '\n' : '');
    reviewPluginSupportChange(files, {...files, [PACKAGE]: after}, host);
    return {file: PACKAGE, before, after, start: 0, end: before.length, removed: before, added: after,
        description: 'plugin support requirements', affected: 1};
}
