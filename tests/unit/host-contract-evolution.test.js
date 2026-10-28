/** @jest-environment node */
const {validateHostContractEvolution, main} = require('../../scripts/release/check-host-contract.cjs');
const released = require('../../contracts/releases/plugin-host-1.0.0.json');
const current = require('../../contracts/plugin-host.json');
const change = value => ({...structuredClone(released), ...value});

test('current contracts preserve every released baseline', () => {
    expect(validateHostContractEvolution(released, current)).toBe(true);
    expect(() => main()).not.toThrow();
});
test('invalid feature declarations do not become accidental support claims', () => {
    expect(() => validateHostContractEvolution(released, change({featureFlags: []}))).toThrow('map');
    expect(() => validateHostContractEvolution(released, change({featureFlags: {...released.featureFlags, future: 'true'}}))).toThrow('booleans');
});
test('a package or patch release cannot remove stable features or mandatory support readers', () => {
    expect(() => validateHostContractEvolution(released, change({featureFlags: {}}))).toThrow('API major');
    expect(() => validateHostContractEvolution(released, change({pluginManifestSchemaVersion: 2, supportedPluginManifestSchemaVersions: [2]}))).toThrow('manifest reader');
    expect(validateHostContractEvolution(released, change({pluginManifestSchemaVersion: 2, supportedPluginManifestSchemaVersions: [1, 2]}))).toBe(true);
});
test('new optional features need an API minor; making them mandatory needs a major', () => {
    const featureFlags = {...released.featureFlags, newOptionalFeature: true};
    expect(() => validateHostContractEvolution(released, change({apiVersion: '1.0.1', featureFlags}))).toThrow('API minor');
    expect(validateHostContractEvolution(released, change({apiVersion: '1.1.0', featureFlags}))).toBe(true);
    expect(() => validateHostContractEvolution(released, change({apiVersion: '1.1.0', featureFlags,
        requiredSdkFeatureFlags: [...released.requiredSdkFeatureFlags, 'newOptionalFeature']}))).toThrow('mandatory');
});
test.each(['contractVersion', 'apiVersion', 'capabilitySchemaVersion'])('protocol versions cannot move backward: %s', key => {
    expect(() => validateHostContractEvolution(released, change({[key]: '0.9.0'}))).toThrow('nondecreasing');
});
test.each(['contractVersion', 'capabilitySchemaVersion'])('changing %s major cannot silently abandon API 1 plugins', key => {
    expect(() => validateHostContractEvolution(released, change({[key]: '2.0.0'}))).toThrow('coordinated API major');
    expect(validateHostContractEvolution(released, change({[key]: '2.0.0', apiVersion: '2.0.0'}))).toBe(true);
});
