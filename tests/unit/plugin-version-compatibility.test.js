/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build as esbuild} from 'esbuild';
import {pluginCompatibilityBanner, readPluginBuildCompatibility, evaluatePluginCompatibility, assertPluginCompatibility} from '../../src/utils/sdk/pluginCompatibility';
import {inspectPluginCompatibility, installedPluginCompatibility, pluginCompatibilityHost} from '../../src/utils/sdk/pluginCompatibilityHost';
import {packageJsonContent} from '../../src/components/editor/utils/packageJsonContent';
import {getSdkHandshake} from '@anikitenko/fdo-sdk';

const host = {fdo: '1.4.0', sdk: '1.8.3', api: '1.0.0', features: {pluginDoctorReport: true}};
const evaluate = (declaration, overrides = {}) => evaluatePluginCompatibility({declaration}, {...host, ...overrides});

test('new builds record conservative support ranges and exact build provenance', async () => {
    const result = await esbuild({stdin: {contents: 'module.exports = 42'}, bundle: true, write: false, platform: 'node', banner: {js: pluginCompatibilityBanner(undefined, host)}});
    const artifact = readPluginBuildCompatibility(result.outputFiles[0].text);
    expect(artifact).toEqual({schemaVersion: 1, builtWith: {fdo: host.fdo, sdk: host.sdk, api: host.api},
        requirements: {fdo: '>=1.4.0 <2.0.0', sdk: '>=1.8.3 <2.0.0', api: '^1.0.0', features: []}});
    expect(evaluatePluginCompatibility({artifact}, host).status).toBe('compatible');
    expect(evaluatePluginCompatibility({artifact}, {...host, fdo: '1.3.0'}).status).toBe('incompatible');
    expect(evaluatePluginCompatibility({artifact}, {...host, fdo: '2.0.0'}).status).toBe('incompatible');
});

test.each([
    [{fdo: '>=1.5.0'}, {}, 'Requires FDO'],
    [{fdo: '^1.0.0', sdk: '>=1.9.0'}, {}, 'Requires SDK'],
    [{fdo: '^1.0.0', api: '^2.0.0'}, {}, 'Requires host API'],
    [{fdo: '^1.0.0', features: ['futureFeature']}, {}, 'futureFeature'],
    [{fdo: '^1.0.0'}, {fdo: '1.5.0-beta.1'}, 'Requires FDO'],
])('blocks unsupported environments for %j', (declaration, overrides, message) => {
    const report = evaluate(declaration, overrides);
    expect(report.status).toBe('incompatible');
    expect(() => assertPluginCompatibility(report)).toThrow(message);
});

test('authors can declare a wider tested range without losing build provenance', () => {
    const declaration = {fdo: '>=1.2.0 <2', sdk: '^1.8.0', api: '^1', features: ['pluginDoctorReport']};
    const artifact = readPluginBuildCompatibility(pluginCompatibilityBanner(declaration, host));
    expect(artifact.requirements.fdo).toBe(declaration.fdo);
    expect(evaluatePluginCompatibility({artifact}, {...host, fdo: '1.2.0'}).status).toBe('compatible');
    expect(() => pluginCompatibilityBanner({fdo: '>=9'}, host)).toThrow('Requires FDO');
});

test('package edits cannot weaken an already compiled artifact', () => {
    const header = pluginCompatibilityBanner(undefined, {...host, fdo: '1.5.0'});
    const report = inspectPluginCompatibility(JSON.stringify({fdo: {compatibility: {fdo: '*'}}}), header, host);
    expect(report.status).toBe('incompatible');
    expect(report.supportedFdo).toContain('>=1.5.0');
});

test.each([null, {}, {fdo: ''}, {fdo: 'latest'}, {fdo: '^1', sdk: 'broken'}, {fdo: '^1', features: 'all'}])('rejects malformed declarations %j', declaration => {
    expect(evaluate(declaration).status).toBe('incompatible');
});

test('legacy builds are explicitly unverified and are never executed during inspection', () => {
    const report = inspectPluginCompatibility('{}', 'throw new Error("must never execute");', host);
    expect(report).toMatchObject({status: 'unverified', supportedFdo: 'Not declared', builtWith: null});
    expect(() => assertPluginCompatibility(report)).not.toThrow();
    expect(inspectPluginCompatibility('{}', '// FDO_PLUGIN_COMPATIBILITY:broken', host).status).toBe('incompatible');
    expect(inspectPluginCompatibility('{}', '// FDO_PLUGIN_COMPATIBILITY:' + JSON.stringify({schemaVersion: 2}), host).status).toBe('incompatible');
});

test('installed preflight reads the package and artifact without loading plugin code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-version-preflight-'));
    try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({fdo: {compatibility: {fdo: '>=99'}}}));
        fs.writeFileSync(path.join(root, 'index.cjs'), 'throw new Error("must never execute");');
        expect(installedPluginCompatibility(root, 'index.cjs').status).toBe('incompatible');
        expect(installedPluginCompatibility(root, '../escape.cjs').status).toBe('incompatible');
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('starter projects tell engineers which FDO and SDK versions they target', () => {
    const pkg = JSON.parse(packageJsonContent('versioned-tools'));
    const runtime = pluginCompatibilityHost();
    expect(pkg.fdo.compatibility.fdo).toContain(runtime.fdo);
    expect(pkg.fdo.compatibility.sdk).toContain(runtime.sdk);
    expect(inspectPluginCompatibility(JSON.stringify(pkg)).status).toBe('compatible');
});

test('host feature declarations agree with the bundled SDK contract', () => {
    const runtime = pluginCompatibilityHost();
    const handshake = getSdkHandshake();
    expect(handshake.apiVersion.split('.')[0]).toBe(runtime.api.split('.')[0]);
    for (const flag of Object.keys(runtime.features)) expect(handshake.featureFlags[flag]).toBe(true);
});
