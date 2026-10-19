/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compilePluginDirectory, registerCliPlugin, assertCliDeployAllowed} from '../../src/utils/system/cliPluginOperations';
let root;
const metadata = {name: 'CLI fixture', version: '1.0.0', author: 'FDO', description: 'CLI regression fixture', icon: 'application'};
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-operations-'));});
afterEach(() => {fs.rmSync(root, {recursive: true, force: true});});
function workspace(manifest = {}) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'fixture', main: 'index.ts', ...manifest}));
    fs.writeFileSync(path.join(root, 'index.ts'), 'source preserved');
    return {build: jest.fn(async () => ({outputFiles: [{path: '/index.js.map', text: 'map'}, {path: '/index.js', text: 'compiled bundle'}]})), extractMetadata: jest.fn(async () => metadata)};
}
test('compiles without overwriting source and ignores dependencies', async () => {
    const dependencies = workspace();
    fs.mkdirSync(path.join(root, 'node_modules')); fs.writeFileSync(path.join(root, 'node_modules', 'private.js'), 'must not be read');
    const result = await compilePluginDirectory(root, dependencies);
    expect(fs.readFileSync(path.join(root, 'index.ts'), 'utf8')).toBe('source preserved');
    expect(result.entryPoint).toMatch(/^dist\/.*\.cjs$/);
    expect(fs.readFileSync(result.destination, 'utf8')).toBe('compiled bundle');
    expect(dependencies.build.mock.calls[0][0]['/node_modules/private.js']).toBeUndefined();
});
test('invalid workspace and metadata fail before writing output', async () => {
    const dependencies = workspace();
    dependencies.extractMetadata.mockResolvedValue(null);
    await expect(compilePluginDirectory(root, dependencies)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
    fs.unlinkSync(path.join(root, 'package.json'));
    await expect(compilePluginDirectory(root, dependencies)).rejects.toThrow('Missing package.json');
});
(process.platform === 'win32' ? test.skip : test)('rejects symlinked output folders before compilation', async () => {
    const dependencies = workspace({main: 'dist/index.cjs'});
    fs.mkdirSync(path.join(root, 'authored'));fs.symlinkSync(path.join(root, 'authored'), path.join(root, 'dist'));
    await expect(compilePluginDirectory(root, dependencies)).rejects.toThrow('symlinked');
    expect(dependencies.build).not.toHaveBeenCalled();
});
test('registry updates preserve grants and other entries, and reject corrupt or GitOps-owned records', () => {
    const file = path.join(root, 'plugins.json');
    const existing = {id: 'fixture', capabilities: ['ssh.use'], customProcessScopes: [{id:'custom'}], home: '/previous'};
    fs.writeFileSync(file, JSON.stringify({plugins: [existing, {id: 'other'}], otherSetting: true}));
    registerCliPlugin(file, root, {name:'fixture',metadata,entryPoint:'dist/index.cjs'});
    const updated = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(updated.plugins[0]).toMatchObject({home: root, capabilities: ['ssh.use'], customProcessScopes:[{id:'custom'}]});
    expect(updated.plugins[1]).toEqual({id:'other'});expect(updated.otherSetting).toBe(true);
    updated.plugins[0].gitops={};fs.writeFileSync(file,JSON.stringify(updated));
    expect(()=>registerCliPlugin(file,root,{name:'fixture',metadata,entryPoint:'dist/index.cjs'})).toThrow('GitOps');
    fs.writeFileSync(file,'broken registry');
    expect(()=>registerCliPlugin(file,root,{name:'fixture',metadata,entryPoint:'dist/index.cjs'})).toThrow();
    expect(fs.readFileSync(file,'utf8')).toBe('broken registry');
});


test('GitOps preflight refuses deployment before the workspace is rebuilt or signed', () => {
    workspace();const registry=path.join(root,'plugins.json');
    fs.writeFileSync(registry,JSON.stringify({plugins:[{id:'fixture',gitops:{}}]}));
    expect(()=>assertCliDeployAllowed(registry,root)).toThrow('GitOps');
    expect(fs.readFileSync(path.join(root,'index.ts'),'utf8')).toBe('source preserved');
});

test('validation builds in memory, inspects declarations, and leaves an existing bundle unchanged', async () => {
    const {validatePluginDirectory} = require('../../src/utils/system/cliPluginOperations');
    const dependencies = workspace({main: 'dist/index.cjs'});
    fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/index.cjs'), 'last successful bundle');
    dependencies.build.mockResolvedValue({outputFiles: [{path: '/index.js', text: 'class Plugin { declareCapabilities() { return ["storage"]; } }'}]});
    const report = await validatePluginDirectory(root, dependencies);
    expect(report).toMatchObject({name: 'fixture', capabilities: ['storage'], warnings: []});
    expect(fs.readFileSync(path.join(root, 'dist/index.cjs'), 'utf8')).toBe('last successful bundle');
    expect(report.bundle).toBeUndefined();
    dependencies.build.mockResolvedValue({outputFiles: [{path: '/index.js', text: 'class Plugin { declareCapabilities() { return ["unsupported.capability"]; } }'}]});
    await expect(validatePluginDirectory(root, dependencies)).rejects.toThrow('does not support');
    dependencies.build.mockResolvedValue({outputFiles: [{path: '/index.js', text: 'class Plugin { declareCapabilities() { return dangerous(); } }'}]});
    expect(await validatePluginDirectory(root, dependencies)).toMatchObject({capabilities: null, warnings: [expect.stringContaining('statically')]});
});

test('deploy preview reports install/update and preserves files, grants and identities', async () => {
    const {planCliDeployment} = require('../../src/utils/system/cliPluginOperations');
    const {certificateFixture} = require('../helpers/certificateFixture.cjs');
    workspace();
    const registryFile = path.join(root, 'plugins.json');
    const options = {registryFile, profile: root, validate: jest.fn(async () => ({name: 'fixture', metadata, warnings: []})), listCertificates: () => [], credentialStoreAvailable: () => true};
    expect(await planCliDeployment(root, 'root', options)).toMatchObject({action: 'install', signer: {label: 'root', status: 'will-create'}, grants: {capabilities: []}});
    expect(fs.existsSync(registryFile)).toBe(false);
    const existing = JSON.stringify({plugins: [{id: 'fixture', metadata: {version: '0.9.0'}, capabilities: ['storage']}]});
    fs.writeFileSync(registryFile, existing);
    const cert = {...await certificateFixture(), hasPrivateKey: true};
    options.listCertificates = () => [cert];
    expect(await planCliDeployment(root, 'root', options)).toMatchObject({action: 'update', previousVersion: '0.9.0', signer: {status: 'existing'}, grants: {capabilities: ['storage']}});
    expect(fs.readFileSync(registryFile, 'utf8')).toBe(existing);
    await expect(planCliDeployment(root, 'missing', options)).rejects.toThrow('not found');
    await expect(planCliDeployment(root, 'root', {...options, now: new Date('2100-01-01')})).rejects.toThrow('validity period');
    await expect(planCliDeployment(root, 'root', {...options, listCertificates: () => [{...cert, hasPrivateKey: false}]})).rejects.toThrow('no private key');
    await expect(planCliDeployment(root, 'root', {...options, credentialStoreAvailable: () => false})).rejects.toThrow('credential store');
    fs.writeFileSync(registryFile, JSON.stringify({plugins: [{id: 'fixture', gitops: {}}]}));
    options.validate.mockClear();
    await expect(planCliDeployment(root, 'root', options)).rejects.toThrow('GitOps');
    expect(options.validate).not.toHaveBeenCalled();
});
