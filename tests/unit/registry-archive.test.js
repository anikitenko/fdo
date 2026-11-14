/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRegistryArchive, writeRegistryArchive} from '../../src/utils/plugins/publishing/registryArchive';
import {certificateStorage} from '../../src/utils/persistence/certificateStorage';
import {officialRegistry} from '../../src/utils/system/officialRegistry';
import {registryIdentityLifecycle} from '../../src/utils/system/registryIdentity';
import {stableStringify} from '../../src/utils/system/registrySigning';
import {registryLifecycleFixture} from '../helpers/registryLifecycleFixture';
import {publishingFixture} from '../helpers/publishingFixture';
jest.mock('../../src/utils/persistence/certificateStorage', () => ({certificateStorage: {list: jest.fn(), privateKey: jest.fn(), update: jest.fn()}}));
jest.mock('../../src/utils/system/officialRegistry', () => ({officialRegistry: {trust: jest.fn()}}));
jest.mock('../../src/utils/system/registryIdentity', () => ({registryIdentityLifecycle: {ensureIdentity: jest.fn(async entry => entry)}}));
let directory, identity;
beforeAll(async () => {identity = await registryLifecycleFixture();});
beforeEach(async () => {
    jest.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-package-'));
    for (const [name, content] of Object.entries(publishingFixture())) await fs.writeFile(path.join(directory, name), content);
    certificateStorage.list.mockReturnValue([{id:'developer', kind:'developer', hasPrivateKey:true, chainPem:identity.chainPem}]);
    certificateStorage.privateKey.mockReturnValue(identity.key);
    officialRegistry.trust.mockResolvedValue({anchors:[identity.root]});
});
afterEach(async () => {await fs.rm(directory, {recursive: true, force: true});});
test('CLI and UI shared package signer produces a valid signature and omits private files and generated output', async () => {
    await fs.writeFile(path.join(directory, 'developer.key'), identity.key);
    await fs.mkdir(path.join(directory, 'dist'));
    await fs.writeFile(path.join(directory, 'dist', 'index.js'), 'generated');
    const result = await createRegistryArchive(directory, 'registry:developer');
    const zip = await require('unzipper').Open.buffer(result.archive);
    const files = Object.fromEntries(await Promise.all(zip.files.map(async entry => [entry.path, await entry.buffer()])));
    expect(files).not.toHaveProperty('developer.key');
    expect(files).not.toHaveProperty('dist/index.js');
    const metadata = JSON.parse(files['fdo.meta.json']);
    expect(crypto.verify('sha256', Buffer.from(stableStringify(metadata)), identity.leaf, files['fdo.signature'])).toBe(true);
    expect(Object.keys(metadata.files).sort()).toEqual(['README.md', 'index.ts', 'package.json']);
    expect(result.report.valid).toBe(true);
    expect(await fs.readFile(path.join(directory,'package.json'),'utf8')).toBe(publishingFixture()['package.json']);
});
test('policy failures stop before private-key or online identity access', async () => {
    await fs.writeFile(path.join(directory, 'package.json'), publishingFixture({scripts:{build:'tsc'}})['package.json']);
    await expect(createRegistryArchive(directory, 'developer')).rejects.toThrow('scripts');
    expect(certificateStorage.privateKey).not.toHaveBeenCalled();
    expect(registryIdentityLifecycle.ensureIdentity).not.toHaveBeenCalled();
});
test('output creation cannot overwrite an existing archive', async () => {
    const output = path.join(directory,'existing.zip');
    await fs.writeFile(output,'original');
    await expect(writeRegistryArchive(directory,'developer',output)).rejects.toMatchObject({code:'EEXIST'});
    expect(await fs.readFile(output,'utf8')).toBe('original');
    expect(certificateStorage.privateKey).not.toHaveBeenCalled();
});


test('registry export excludes development tests before hashing and signing, without editing the workspace', async () => {
    const tests = ['index.test.ts','render.spec.tsx','features/check.test.ts','tests/helpers.ts','__tests__/integration.ts'];
    for (const name of tests) {
        await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});
        await fs.writeFile(path.join(directory,name), "import test from 'node:test'; import assert from 'node:assert'; test('example',()=>assert.ok(true));");
    }
    await fs.writeFile(path.join(directory,'.gitignore'),'dist/');
    const result = await createRegistryArchive(directory, 'developer');
    const zip = await require('unzipper').Open.buffer(result.archive);
    const files = Object.fromEntries(await Promise.all(zip.files.map(async entry => [entry.path,await entry.buffer()])));
    const metadata = JSON.parse(files['fdo.meta.json']);
    for (const name of [...tests,'.gitignore']) {
        expect(files).not.toHaveProperty(name);
        expect(metadata.files).not.toHaveProperty(name);
        expect(await fs.readFile(path.join(directory,name),'utf8')).not.toBe('');
    }
    expect(crypto.verify('sha256',Buffer.from(stableStringify(metadata)),identity.leaf,files['fdo.signature'])).toBe(true);
});

test('runtime references to an excluded test fail locally before signing rather than shipping a broken source archive', async () => {
    await fs.writeFile(path.join(directory,'support.test.ts'), 'export const helper = 1;');
    await fs.appendFile(path.join(directory,'index.ts'), "\nimport {helper} from './support.test'; console.log(helper);");
    await expect(createRegistryArchive(directory,'developer')).rejects.toThrow('UNRESOLVED_IMPORT');
    expect(certificateStorage.privateKey).not.toHaveBeenCalled();
    expect(registryIdentityLifecycle.ensureIdentity).not.toHaveBeenCalled();
});
