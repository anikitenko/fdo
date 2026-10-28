'use strict';
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

function validateHostContractEvolution(previous, current) {
    if (!current.featureFlags || typeof current.featureFlags !== 'object' || Array.isArray(current.featureFlags)
        || Object.entries(current.featureFlags).some(([name, value]) => !/^[A-Za-z][A-Za-z0-9.:-]*$/.test(name) || typeof value !== 'boolean')) {
        throw new Error('Host feature flags must be a map of feature names to booleans.');
    }
    for (const key of ['contractVersion', 'apiVersion', 'capabilitySchemaVersion']) {
        if (!semver.valid(current[key]) || semver.lt(current[key], previous[key])) throw new Error(`${key} must be a valid, nondecreasing semantic version.`);
    }
    const breakingApi = semver.major(current.apiVersion) > semver.major(previous.apiVersion);
    const additiveApi = breakingApi || semver.minor(current.apiVersion) > semver.minor(previous.apiVersion);
    for (const key of ['contractVersion', 'capabilitySchemaVersion']) {
        if (semver.major(current[key]) > semver.major(previous[key]) && !breakingApi) {
            throw new Error(`${key} major changes require a coordinated API major: this host has no multi-major adapter for that protocol.`);
        }
    }
    const oldFeatures = Object.keys(previous.featureFlags).filter(key => previous.featureFlags[key]);
    const removed = oldFeatures.filter(key => current.featureFlags?.[key] !== true);
    if (removed.length && !breakingApi) throw new Error(`Removing stable host features requires an API major version and migration: ${removed.join(', ')}.`);
    const added = Object.keys(current.featureFlags || {}).filter(key => current.featureFlags[key] && !previous.featureFlags[key]);
    if (added.length && !additiveApi) throw new Error(`New host features require at least an API minor version: ${added.join(', ')}.`);
    if (!Array.isArray(current.requiredSdkFeatureFlags) || current.requiredSdkFeatureFlags.some(flag => current.featureFlags?.[flag] !== true)) throw new Error('Required SDK flags must be implemented host features.');
    const newRequirements = current.requiredSdkFeatureFlags.filter(flag => !previous.requiredSdkFeatureFlags.includes(flag));
    if (newRequirements.length && !breakingApi) throw new Error('Making optional SDK features mandatory breaks older plugins and requires an API major version.');
    const readers = current.supportedPluginManifestSchemaVersions;
    if (!Number.isInteger(current.pluginManifestSchemaVersion) || current.pluginManifestSchemaVersion < previous.pluginManifestSchemaVersion
        || !Array.isArray(readers) || readers.some(version => !Number.isInteger(version) || version < 1) || !readers.includes(current.pluginManifestSchemaVersion)) {
        throw new Error('The host must read its written plugin manifest schema; schema versions cannot decrease.');
    }
    if (!breakingApi && previous.supportedPluginManifestSchemaVersions.some(version => !readers.includes(version))) throw new Error('Dropping a released plugin manifest reader requires an API major version and migration.');
    for (const kind of ['dom', 'components', 'previews']) {
        const versions = current.authoringContractMajors?.[kind];
        if (!Array.isArray(versions) || !versions.length || versions.some(version => !Number.isInteger(version) || version < 1)) throw new Error(`Invalid supported ${kind} authoring contract majors.`);
    }
    return true;
}

function main(directory = process.cwd()) {
    const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    const current = read('contracts/plugin-host.json');
    for (const file of fs.readdirSync(path.join(directory, 'contracts/releases')).filter(file => file.endsWith('.json'))) {
        validateHostContractEvolution(read('contracts/releases/' + file), current);
    }
    console.log('Host contract checks passed against released compatibility baselines.');
}
module.exports = {main, validateHostContractEvolution};
if (require.main === module) {try {main();} catch (error) {console.error(error.message); process.exitCode = 1;}}
