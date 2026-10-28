import definition from '../../../contracts/plugin-host.json';

// These are independent protocol versions, not FDO or SDK package versions.
// SDK update alone: no bump. Existing-contract correction: affected patch.
// Optional protocol addition: affected minor. Breaking protocol change: major
// with migration (handshake/schema majors currently also require API major).
// Edit contracts/plugin-host.json, never copy the SDK package version here.
// Decision guide: docs/PLUGIN_HOST_CONTRACT.md#when-the-sdk-is-updated-the-decision-guide
export const HOST_PLUGIN_CONTRACT_VERSION = definition.contractVersion; // Handshake envelope.
export const HOST_PLUGIN_API_VERSION = definition.apiVersion; // Runtime messages and behavior.
export const HOST_PLUGIN_CAPABILITY_SCHEMA_VERSION = definition.capabilitySchemaVersion;
export const HOST_PLUGIN_MANIFEST_SCHEMA_VERSION = definition.pluginManifestSchemaVersion;
export const HOST_SUPPORTED_PLUGIN_MANIFEST_SCHEMAS = Object.freeze([...definition.supportedPluginManifestSchemaVersions]);
export const HOST_PLUGIN_FEATURE_FLAGS = Object.freeze({...definition.featureFlags});
export const HOST_REQUIRED_SDK_FEATURE_FLAGS = Object.freeze([...definition.requiredSdkFeatureFlags]);
export const HOST_AUTHORING_CONTRACT_MAJORS = Object.freeze(Object.fromEntries(
    Object.entries(definition.authoringContractMajors).map(([kind, majors]) => [kind, Object.freeze([...majors])])));

export function hostPluginContract() {
    return {contractVersion: HOST_PLUGIN_CONTRACT_VERSION, apiVersion: HOST_PLUGIN_API_VERSION,
        capabilitySchemaVersion: HOST_PLUGIN_CAPABILITY_SCHEMA_VERSION, pluginManifestSchemaVersion: HOST_PLUGIN_MANIFEST_SCHEMA_VERSION,
        supportedPluginManifestSchemaVersions: [...HOST_SUPPORTED_PLUGIN_MANIFEST_SCHEMAS],
        featureFlags: {...HOST_PLUGIN_FEATURE_FLAGS}, requiredSdkFeatureFlags: [...HOST_REQUIRED_SDK_FEATURE_FLAGS],
        authoringContractMajors: Object.fromEntries(Object.entries(HOST_AUTHORING_CONTRACT_MAJORS).map(([key, values]) => [key, [...values]]))};
}
