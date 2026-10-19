/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {diagnoseCli, inspectCliPlugins} from '../../src/utils/system/cliInspection';

let root, options;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-inspection-'));
    options = {version: '1.0.0', profile: root, registryFile: path.join(root, 'plugins.json'), configFile: path.join(root, 'config.json'),
        installation: async () => ({current: true, path: '/bin/fdo', inPath: true}), listCertificates: () => [], credentialStoreAvailable: () => true,
        verifyPlugin: jest.fn(async () => ({success: true}))};
});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
function registry(plugins) {fs.writeFileSync(options.registryFile, JSON.stringify({plugins}));}
test('fresh profile inspection does not create files or signing identities', async () => {
    expect(await inspectCliPlugins(options)).toEqual([]);
    const report = await diagnoseCli(options);
    expect(report.checks.find(check => check.id === 'signing')).toMatchObject({status: 'warning', fix: expect.any(String)});
    expect(fs.readdirSync(root)).toEqual([]);
});
test('plugin info uses saved activation and grants, verifies every selected plugin and isolates signature failures', async () => {
    registry([{id: 'one', home: root, metadata: {version: '2.0.0'}, capabilities: ['storage']}, {id: 'two', home: root}]);
    fs.writeFileSync(options.configFile, JSON.stringify({config: {plugins: ['one']}}));
    options.verifyPlugin.mockResolvedValueOnce({success: true}).mockRejectedValueOnce(new Error('tampered'));
    expect(await inspectCliPlugins(options)).toEqual([
        expect.objectContaining({id: 'one', enabled: true, version: '2.0.0', capabilities: ['storage'], signature: {status: 'valid'}}),
        expect.objectContaining({id: 'two', enabled: false, signature: {status: 'invalid', error: 'tampered'}}),
    ]);
    await expect(inspectCliPlugins(options, 'missing')).rejects.toThrow('Plugin not found');
});
test('doctor continues after corrupt registry and unavailable keychain', async () => {
    fs.writeFileSync(options.registryFile, '{broken');
    options.credentialStoreAvailable = () => false;
    const report = await diagnoseCli(options);
    expect(report.healthy).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({id: 'registry', status: 'error', fix: expect.any(String)}),
        expect.objectContaining({id: 'credential-store', status: 'error', fix: expect.any(String)}),
        expect.objectContaining({id: 'signing', status: 'warning'}),
    ]));
});
test('doctor diagnoses stale wrappers, PATH conflicts, duplicate records and missing plugin paths', async () => {
    options.installation = async () => ({current: false, inPath: false});
    registry([{id: 'one', home: path.join(root, 'missing')}]);
    let report = await diagnoseCli(options);
    for (const id of ['wrapper', 'path', 'registry']) expect(report.checks.find(check => check.id === id).status).toBe('warning');
    registry([{id: 'one', home: root}, {id: 'one', home: root}]);
    report = await diagnoseCli(options);
    expect(report.checks.find(check => check.id === 'registry').status).toBe('error');
});
test('doctor checks certificate validity and key presence without reading private keys', async () => {
    const {certificateFixture} = require('../helpers/certificateFixture.cjs');
    const certificate = await certificateFixture();
    options.listCertificates = () => [{...certificate, key: undefined, hasPrivateKey: true}];
    let report = await diagnoseCli(options);
    expect(report.healthy).toBe(true);
    expect(JSON.stringify(report)).not.toContain('BEGIN');
    report = await diagnoseCli({...options, now: new Date('2100-01-01')});
    expect(report.checks.find(check => check.id === 'signing')).toMatchObject({status: 'error', message: expect.stringContaining('validity')});
    options.listCertificates = () => [{...certificate, hasPrivateKey: false}];
    report = await diagnoseCli(options);
    expect(report.checks.find(check => check.id === 'signing')).toMatchObject({status: 'error', message: expect.stringContaining('no private key')});
});
