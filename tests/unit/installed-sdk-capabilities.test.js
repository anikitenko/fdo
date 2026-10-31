/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installedSdkCapabilities, readSkillFingerprint, stampSkillFingerprint} from '../../src/utils/sdk/installedSdkCapabilities';
test('fingerprints change with declarations and stamping replaces older contract metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sdk-contract-'));
    try {
        fs.mkdirSync(path.join(root, 'dist/@types'), {recursive: true});
        fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
        const entry = path.join(root, 'dist/sdk.js');
        fs.writeFileSync(entry, 'module.exports = {};');
        const declaration = path.join(root, 'dist/@types/index.d.ts');
        fs.writeFileSync(declaration, 'export declare class Tool { run(): string; }');
        const requireSdk = Object.assign(name => require(name), {resolve: name => name === '@anikitenko/fdo-sdk' ? entry : require.resolve(name)});
        const sdk = {Tool: class Tool {}};
        const before = installedSdkCapabilities(requireSdk, sdk);
        expect(installedSdkCapabilities(requireSdk, sdk).fingerprint).toBe(before.fingerprint);
        fs.writeFileSync(declaration, 'export declare class Tool { run(): number; }');
        const after = installedSdkCapabilities(requireSdk, sdk);
        expect(after.fingerprint).not.toBe(before.fingerprint);
        const stamped = stampSkillFingerprint(stampSkillFingerprint('# Guide', before.fingerprint), after.fingerprint);
        expect(readSkillFingerprint(stamped)).toBe(after.fingerprint);
        expect(stamped.match(/fdo-sdk-fingerprint/g)).toHaveLength(1);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('inventories inherited public service properties and accessors without executing getters', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sdk-services-'));
    try {
        fs.mkdirSync(path.join(root, 'dist/@types'), {recursive: true});
        fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
        const entry = path.join(root, 'dist/sdk.js');
        fs.writeFileSync(entry, 'module.exports = {};');
        fs.writeFileSync(path.join(root, 'dist/@types/index.d.ts'), `
            export declare class SecretStore { get(key: string): Promise<string | null>; }
            declare class Base { readonly secrets: SecretStore; protected hidden: string; private internal: string; }
            export declare class Plugin extends Base { get endpoint(): string; static readonly API_VERSION: string; }
        `);
        const requireSdk = Object.assign(name => require(name), {resolve: name => name === '@anikitenko/fdo-sdk' ? entry : require.resolve(name)});
        const getter = jest.fn(() => {throw new Error('Do not execute SDK getters');});
        class Plugin {}
        Object.defineProperty(Plugin.prototype, 'endpoint', {get: getter});
        const sdk = {Plugin};
        Object.defineProperty(sdk, 'unrelated', {get: getter});
        const capabilities = installedSdkCapabilities(requireSdk, sdk);
        expect(capabilities.api.find(item => item.name === 'Plugin').properties).toEqual([
            {name: 'API_VERSION', type: 'string', static: true},
            {name: 'endpoint', type: 'string', static: false},
            {name: 'secrets', type: 'SecretStore', static: false},
        ]);
        expect(getter).not.toHaveBeenCalled();
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
