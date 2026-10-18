/** @jest-environment node */
import 'reflect-metadata';
import crypto from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm, readdir, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {X509CertificateGenerator, BasicConstraintsExtension} from '@peculiar/x509';
import {syncCollection, managedPluginId, detachCollection, decideGitOpsUpdate} from '../../src/utils/gitops/syncCollection';
import {Certs} from '../../src/utils/system/certs';
import {certificateStorage} from '../../src/utils/persistence/certificateStorage';

jest.mock('../../src/utils/persistence/certificateStorage', () => ({certificateStorage: {list: jest.fn(), privateKey: jest.fn(), update: jest.fn()}}));
jest.mock('../../src/utils/desktop/NotificationCenter', () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock('../../src/utils/filesystem/safeReadFileSync', () => ({safeReadFileSync: (...args) => require('node:fs').readFileSync(...args)}));

let certificate, root, options, data;
const declaration = name => ({name, repository: `https://github.com/acme/${name}`, targetRevision: 'main', path: '/plugin'});
const files = (value = 'initial') => [
    {path: 'package.json', content: Buffer.from(JSON.stringify({source: 'index.ts', main: 'dist/index.cjs', version: '1.0.0', author: 'Team'}))},
    {path: 'index.ts', content: Buffer.from(`const metadata = {name: 'Example', version: '1.0.0', author: 'Team', description: '${value}', icon: 'application'};`)},
];
const readRegistry = async () => JSON.parse(await readFile(options.registryFile, 'utf8'));

beforeAll(async () => {
    const algorithm = {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1])};
    const keys = await crypto.webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const cert = await X509CertificateGenerator.createSelfSigned({serialNumber: '01', name: 'CN=GitOps Test Root',
        notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 86400000),
        keys, signingAlgorithm: algorithm, extensions: [new BasicConstraintsExtension(true, undefined, true)]}, crypto.webcrypto);
    certificate = {id: 'root', label: 'root', cert: cert.toString('pem'),
        key: crypto.createPrivateKey({key: Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8'}).export({format: 'pem', type: 'pkcs1'})};
});
beforeEach(async () => {
    data = {'certificates.root': [certificate]};
    certificateStorage.list.mockImplementation(() => data['certificates.root'].map(({key, ...entry}) => ({...entry, scope: 'root', hasPrivateKey: !!key})));
    certificateStorage.privateKey.mockImplementation(id => data['certificates.root'].find(entry => entry.id === id)?.key);
    root = await mkdtemp(path.join(os.tmpdir(), 'fdo-sync-test-'));
    options = {
        source: {id: 'source-one', url: 'https://github.com/acme/collection', authType: 'basic',
            manifest: {apiVersion: 'fdo.dev/v1alpha1', kind: 'PluginCollection', metadata: {name: 'tools', version: '1.0.0'}, spec: {plugins: [declaration('example')]}}},
        secret: {username: 'alice', password: 'token'}, pluginsDir: path.join(root, 'plugins'), registryFile: path.join(root, 'registry.json'),
        fetchPlugin: jest.fn(async () => ({commit: 'a'.repeat(40), files: files()})),
        build: jest.fn(async () => ({outputFiles: [{text: 'module.exports = {};'}]})), normalizeMetadata: value => value,
        sign: jest.fn((home, label) => Certs.signPlugin(home, label)), verifySignature: jest.fn(home => Certs.verifyPlugin(home)),
        runtime: {getLoadedPlugin: jest.fn(() => null), unLoadPlugin: jest.fn(), loadPlugin: jest.fn(async () => ({success: true}))},
        activatedIds: () => [], removeActivated: jest.fn(),
    };
});
afterEach(async () => {await rm(root, {recursive: true, force: true});});

test('builds, automatically signs with root, verifies, and installs under a stable alias without auto-activation', async () => {
    await writeFile(options.registryFile, JSON.stringify({plugins: [{id: 'example', metadata: {name: 'Local'}, home: '/local'}]}));
    const result = await syncCollection(options);
    const saved = (await readRegistry()).plugins;
    expect(saved[0].id).toBe('example');
    const managed = saved[1];
    expect(managed.id).toBe(managedPluginId('source-one', 'example'));
    expect(managed.gitops.declaredId).toBe('example');
    expect(managed.capabilities).toEqual([]);
    expect(options.sign).toHaveBeenCalledWith(managed.home, 'root');
    expect(JSON.parse(await readFile(path.join(managed.home, 'fdo.meta.json'), 'utf8')).label).toBe('root');
    expect((await Certs.verifyPlugin(managed.home)).success).toBe(true);
    expect(options.runtime.loadPlugin).not.toHaveBeenCalled();
    expect(result.installedPlugins[0]).toMatchObject({id: managed.id, name: 'example', commit: 'a'.repeat(40)});
    expect(result.updatedPlugins).toEqual([]);
    expect(result.createdPlugins).toEqual([{id:managed.id,name:'Example',version:'1.0.0',repository:managed.gitops.repository,
        targetRevision:'main',commit:'a'.repeat(40),reloaded:false}]);
});

test('does not rebuild unchanged signed commits and repairs code tampering', async () => {
    await syncCollection(options);
    const original = (await readRegistry()).plugins[0];
    const unchanged = await syncCollection(options);
    expect(unchanged.updatedPlugins).toEqual([]);
    expect(unchanged.createdPlugins).toEqual([]);
    expect(options.build).toHaveBeenCalledTimes(1);
    expect((await readRegistry()).plugins[0].home).toBe(original.home);
    await writeFile(path.join(original.home, original.entry), 'tampered');
    await syncCollection(options);
    const repaired = (await readRegistry()).plugins[0];
    expect(options.build).toHaveBeenCalledTimes(2);
    expect(repaired.home).not.toBe(original.home);
    expect((await Certs.verifyPlugin(repaired.home)).success).toBe(true);
});

test('updates active plugins while retaining permissions and removes the old code directory', async () => {
    await syncCollection(options);
    const saved = await readRegistry();
    const old = saved.plugins[0];
    old.capabilities = ['storage.json'];
    old.customProcessScopes = [{scope: 'team'}];
    await writeFile(options.registryFile, JSON.stringify(saved));
    options.fetchPlugin.mockResolvedValue({commit: 'b'.repeat(40), files: files('updated')});
    options.activatedIds = () => [old.id];
    const updated = await syncCollection(options);
    expect(updated.createdPlugins).toEqual([]);
    const current = (await readRegistry()).plugins[0];
    expect(updated.updatedPlugins).toEqual([{id: old.id, name: 'Example', version: '1.0.0',
        repository: declaration('example').repository, targetRevision: 'main', commit: 'b'.repeat(40), reloaded: true}]);
    expect(current.capabilities).toEqual(old.capabilities);
    expect(current.customProcessScopes).toEqual(old.customProcessScopes);
    expect(current.gitops.commit).toBe('b'.repeat(40));
    expect(options.runtime.unLoadPlugin).toHaveBeenCalledWith(old.id, {force: true, reason: 'gitops_sync'});
    expect(options.runtime.loadPlugin).toHaveBeenCalledWith(old.id);
    await expect(access(old.home)).rejects.toThrow();
});

test('rolls back the whole registry and code versions if an active replacement fails to load', async () => {
    await syncCollection(options);
    const original = await readRegistry();
    const old = original.plugins[0];
    options.fetchPlugin.mockResolvedValue({commit: 'b'.repeat(40), files: files('broken')});
    options.activatedIds = () => [old.id];
    options.runtime.loadPlugin.mockResolvedValueOnce({success: false, error: 'handshake failed'}).mockResolvedValue({success: true});
    await expect(syncCollection(options)).rejects.toThrow('Plugin reload failed');
    expect(await readRegistry()).toEqual(original);
    expect((await Certs.verifyPlugin(old.home)).success).toBe(true);
    expect(await readdir(options.pluginsDir)).toEqual([path.basename(old.home)]);
    expect(options.runtime.loadPlugin).toHaveBeenCalledTimes(2);
});

test('a default signing failure leaves the previous installation untouched', async () => {
    await syncCollection(options);
    const original = await readRegistry();
    options.fetchPlugin.mockResolvedValue({commit: 'b'.repeat(40), files: files()});
    options.sign.mockReturnValue({success: false, error: 'Certificate expired'});
    await expect(syncCollection(options)).rejects.toThrow('Default certificate signing failed');
    expect(await readRegistry()).toEqual(original);
    expect(options.runtime.unLoadPlugin).not.toHaveBeenCalled();
    expect(await readdir(options.pluginsDir)).toEqual([path.basename(original.plugins[0].home)]);
});

test('prunes removed declarations and detaches installed plugins when the subscription is removed', async () => {
    options.source.manifest.spec.plugins.push(declaration('second'));
    await syncCollection(options);
    const removed = (await readRegistry()).plugins[1];
    options.source.manifest.spec.plugins.pop();
    await syncCollection(options);
    expect((await readRegistry()).plugins).toHaveLength(1);
    expect(options.removeActivated).toHaveBeenLastCalledWith([removed.id]);
    await expect(access(removed.home)).rejects.toThrow();
    await detachCollection(options.registryFile, options.source.id);
    const local = (await readRegistry()).plugins[0];
    expect(local.gitops).toBeUndefined();
    expect((await Certs.verifyPlugin(local.home)).success).toBe(true);
});

test('collection identities remain distinct and credentials never cross host boundaries', async () => {
    await syncCollection(options);
    const first = (await readRegistry()).plugins[0];
    options.source.id = 'source-two';
    options.source.manifest.spec.plugins[0].repository = 'https://other.example/acme/example';
    await syncCollection(options);
    const saved = (await readRegistry()).plugins;
    expect(saved).toHaveLength(2);
    expect(saved[1].id).not.toBe(first.id);
    expect(options.fetchPlugin.mock.calls[0][0]).toMatchObject({authType: 'basic', username: 'alice', password: 'token'});
    expect(options.fetchPlugin.mock.calls[1][0]).toMatchObject({authType: 'none'});
    expect(options.fetchPlugin.mock.calls[1][0].password).toBeUndefined();
});

test('installs prebuilt plugins without running a build or package scripts', async () => {
    options.fetchPlugin.mockResolvedValue({commit: 'a'.repeat(40), files: [
        {path: 'package.json', content: Buffer.from(JSON.stringify({main: 'dist/index.cjs', version: '1.0.0', author: 'Team', scripts: {postinstall: 'exit 1'}}))},
        {path: 'dist/index.cjs', content: Buffer.from('module.exports = {};')},
    ]});
    await syncCollection(options);
    expect(options.build).not.toHaveBeenCalled();
    const installed = (await readRegistry()).plugins[0];
    expect(installed.entry).toBe('dist/index.cjs');
    expect((await Certs.verifyPlugin(installed.home)).success).toBe(true);
});

test('checking a single plugin keeps all other installations intact', async () => {
    options.source.manifest.spec.plugins.push(declaration('second'));
    await syncCollection(options);
    const previous = (await readRegistry()).plugins.find(plugin => plugin.gitops.declaredId === 'second');
    options.fetchPlugin.mockClear();
    options.fetchPlugin.mockResolvedValue({commit: 'b'.repeat(40), files: files('updated')});
    const result = await syncCollection({...options, pluginName: 'example'});
    expect(options.fetchPlugin).toHaveBeenCalledTimes(1);
    expect(result.installedPlugins).toHaveLength(2);
    expect((await readRegistry()).plugins.find(plugin => plugin.id === previous.id)).toEqual(previous);
    expect((await Certs.verifyPlugin(previous.home)).success).toBe(true);
});

test('pruning removed declarations does not fetch or modify retained plugins', async () => {
    options.source.manifest.spec.plugins.push(declaration('second'));
    await syncCollection(options);
    const retained = (await readRegistry()).plugins[0];
    options.source.manifest.spec.plugins.pop();
    options.fetchPlugin.mockClear();
    await syncCollection({...options, pruneOnly: true});
    expect(options.fetchPlugin).not.toHaveBeenCalled();
    expect((await readRegistry()).plugins).toEqual([retained]);
});

test.each(['index.ts', './src/calculator.ts'])('compiles a TypeScript main %s and reads author from the plugin class instead of package.json', async main => {
    const sourcePath = main.replace(/^\.\//, '');
    const source = `export default class CalculatorPlugin {
        _metadata = {name: "Cute Calculator", version: "1.0.0", author: "Calculator Team", description: "Local calculations", icon: "calculator"};
        get metadata(): typeof this._metadata { return this._metadata; }
    }`;
    options.fetchPlugin.mockResolvedValue({commit: 'a'.repeat(40), files: [
        {path: 'package.json', content: Buffer.from(JSON.stringify({name: 'calculator', version: '1.0.0', main}))},
        {path: sourcePath, content: Buffer.from(source)},
    ]});
    await syncCollection(options);
    expect(options.build).toHaveBeenCalledTimes(1);
    const plugin = (await readRegistry()).plugins[0];
    expect(plugin.metadata).toMatchObject({name: 'Cute Calculator', author: 'Calculator Team', icon: 'calculator'});
    expect(plugin.entry).toBe('dist/index.cjs');
    expect(await readFile(path.join(plugin.home, sourcePath), 'utf8')).toBe(source);
    expect(await readFile(path.join(plugin.home, plugin.entry), 'utf8')).toBe('module.exports = {};');
    expect((await Certs.verifyPlugin(plugin.home)).success).toBe(true);
    expect(JSON.parse(await readFile(path.join(plugin.home, 'package.json'), 'utf8')).source).toBeUndefined();
});

test('compiles the conventional index.ts when package.source is absent', async () => {
    const sourceFiles = files();
    sourceFiles[0].content = Buffer.from(JSON.stringify({name: 'example', main: 'dist/custom.cjs'}));
    options.fetchPlugin.mockResolvedValue({commit: 'a'.repeat(40), files: sourceFiles});
    await syncCollection(options);
    const plugin = (await readRegistry()).plugins[0];
    expect(options.build).toHaveBeenCalledTimes(1);
    expect(plugin.entry).toBe('dist/custom.cjs');
    expect(plugin.metadata.author).toBe('Team');
});

test('rebuilds an old GitOps installation once with the corrected shared build pipeline', async () => {
    await syncCollection(options);
    const original = await readRegistry();
    const oldHome = original.plugins[0].home;
    delete original.plugins[0].gitops.buildPipelineVersion;
    await writeFile(options.registryFile, JSON.stringify(original));
    await syncCollection(options);
    expect(options.build).toHaveBeenCalledTimes(2);
    expect((await readRegistry()).plugins[0].home).not.toBe(oldHome);
    await syncCollection(options);
    expect(options.build).toHaveBeenCalledTimes(2);
});

const compiledSSH=monitor=>`const sdk=require('@anikitenko/fdo-sdk');class App {declareCapabilities(){return sdk.createSSHCapabilityBundle(${monitor?'{monitorStatus:true}':''});}}`;
async function pendingSSHUpdate() {
 options.build.mockResolvedValue({outputFiles:[{text:compiledSSH(false)}]});await syncCollection(options);
 const saved=await readRegistry(),old=saved.plugins[0];
 old.capabilities=[...old.gitops.requestedCapabilities];await writeFile(options.registryFile,JSON.stringify(saved));
 options.activatedIds=()=>[old.id];
 options.fetchPlugin.mockResolvedValue({commit:'b'.repeat(40),files:files('monitoring')});
 options.build.mockResolvedValue({outputFiles:[{text:compiledSSH(true)}]});
 const result=await syncCollection(options),pending=(await readRegistry()).plugins[0].gitops.pendingUpdate;
 return {old,pending,result};
}
const decide=(pending,decision='approve',capabilities=['ssh.status.watch'])=>decideGitOpsUpdate({...options,sourceId:options.source.id,pluginName:'example',reviewId:pending.id,decision,capabilities});

test('stages a new capability without unloading the approved version, preserves it across checks, and applies only explicit approval',async()=>{
 const {old,pending,result}=await pendingSSHUpdate();
 const staged=(await readRegistry()).plugins[0];
 expect(staged.home).toBe(old.home);expect(staged.capabilities).toEqual(old.capabilities);
 expect(pending.addedCapabilities).toEqual(['ssh.status.watch']);expect(result.updatedPlugins).toEqual([]);
 expect(result.pendingUpdates[0]).toMatchObject({reviewId:pending.id,newReview:true,currentCommit:'a'.repeat(40),commit:'b'.repeat(40)});
 expect(options.runtime.unLoadPlugin).not.toHaveBeenCalled();expect(options.runtime.loadPlugin).not.toHaveBeenCalled();
 const repeat=await syncCollection(options);expect(repeat.pendingUpdates[0]).toMatchObject({reviewId:pending.id,newReview:false});expect(options.build).toHaveBeenCalledTimes(2);
 await expect(decide(pending,'approve',[])).rejects.toThrow('Explicitly select');
 await expect(decide(pending,'approve',['ssh.status.watch','secrets.get'])).rejects.toThrow('Explicitly select');
 await decide(pending);
 const applied=(await readRegistry()).plugins[0];expect(applied.home).toBe(pending.candidate.home);expect(applied.gitops.pendingUpdate).toBeUndefined();
 expect(applied.capabilities.sort()).toEqual([...old.capabilities,'ssh.status.watch'].sort());expect(options.runtime.loadPlugin).toHaveBeenCalledWith(old.id);
 await expect(access(old.home)).rejects.toThrow();
 await expect(decide(pending)).rejects.toThrow('no longer current');
});

test('decline keeps code/grants/state and suppresses the exact version until Review again',async()=>{
 const {old,pending}=await pendingSSHUpdate();await decide(pending,'decline',[]);
 expect((await readRegistry()).plugins[0].home).toBe(old.home);
 await expect(access(pending.candidate.home)).rejects.toThrow();
 const repeat=await syncCollection(options);expect(repeat.pendingUpdates).toEqual([]);expect(repeat.reviewStatuses[0]).toMatchObject({state:'declined',commit:'b'.repeat(40)});
 expect(options.runtime.unLoadPlugin).not.toHaveBeenCalled();
 await decide({...pending,id:'b'.repeat(40)},'reconsider',[]);
 expect((await syncCollection(options)).pendingUpdates).toHaveLength(1);
});

test('newer candidates invalidate earlier reviews and clean obsolete staged code',async()=>{
 const {pending}=await pendingSSHUpdate();options.fetchPlugin.mockResolvedValue({commit:'c'.repeat(40),files:files('newer')});
 const next=await syncCollection(options);expect(next.pendingUpdates[0].reviewId).not.toBe(pending.id);
 await expect(access(pending.candidate.home)).rejects.toThrow();await expect(decide(pending)).rejects.toThrow('no longer current');
});

test('stale grants, changed signatures and changed collection identities cannot be approved',async()=>{
 const {pending}=await pendingSSHUpdate();
 await writeFile(path.join(pending.candidate.home,pending.candidate.entry),'tampered');await expect(decide(pending)).rejects.toThrow('signature');
 await syncCollection(options);const refreshed=(await readRegistry()).plugins[0].gitops.pendingUpdate;
 const saved=await readRegistry();saved.plugins[0].capabilities=[];await writeFile(options.registryFile,JSON.stringify(saved));
 await expect(decide(refreshed)).rejects.toThrow('permissions changed');
 options.source={...options.source,url:'https://github.com/other/collection'};await expect(decide(refreshed)).rejects.toThrow('no longer current');
});

test('approval startup failure restores the approved version and grants while retaining the staged review',async()=>{
 const {old,pending}=await pendingSSHUpdate();options.runtime.loadPlugin.mockResolvedValueOnce({success:false,error:'fixture startup failure'}).mockResolvedValue({success:true});
 await expect(decide(pending)).rejects.toThrow('could not start');
 const restored=(await readRegistry()).plugins[0];expect(restored.home).toBe(old.home);expect(restored.capabilities).toEqual(old.capabilities);expect(restored.gitops.pendingUpdate.id).toBe(pending.id);
 expect((await Certs.verifyPlugin(old.home)).success).toBe(true);
});

test('revocation while stopping for approval invalidates the commit and preserves revoked grants',async()=>{
 const {old,pending}=await pendingSSHUpdate();
 options.runtime.unLoadPlugin.mockImplementationOnce(async()=>{
  const saved=await readRegistry();saved.plugins[0].capabilities=[];
  await writeFile(options.registryFile,JSON.stringify(saved));
 });
 await expect(decide(pending)).rejects.toThrow('Permissions changed while');
 const retained=(await readRegistry()).plugins[0];
 expect(retained.home).toBe(old.home);expect(retained.capabilities).toEqual([]);
 expect(retained.gitops.pendingUpdate.id).toBe(pending.id);
 expect(options.runtime.loadPlugin).toHaveBeenCalledWith(old.id);
});

test('approval waits for the asynchronous worker spawn before checking readiness',async()=>{
 const {pending}=await pendingSSHUpdate();
 options.runtime.getLoadedPlugin.mockReturnValue(null);
 options.runtime.getLoadedPluginReady=jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
 await expect(decide(pending)).resolves.toMatchObject({state:'synced'});
 expect(options.runtime.getLoadedPluginReady).toHaveBeenCalledTimes(2);
});

test('uninspectable declarations stage for maintainer attention and cannot silently update or grant permissions',async()=>{
 await syncCollection(options);const old=(await readRegistry()).plugins[0];
 options.fetchPlugin.mockResolvedValue({commit:'b'.repeat(40),files:files('dynamic')});options.build.mockResolvedValue({outputFiles:[{text:`class App{declareCapabilities(){return process.env.PERMISSIONS.split(',');}}`}]});
 const result=await syncCollection(options);expect(result.pendingUpdates[0].inspectionError).toContain('could not be inspected');
 const pending=(await readRegistry()).plugins[0].gitops.pendingUpdate;
 await expect(decide(pending,'approve',[])).rejects.toThrow('could not be inspected');expect((await readRegistry()).plugins[0].home).toBe(old.home);
 await detachCollection(options.registryFile,options.source.id);await expect(access(pending.candidate.home)).rejects.toThrow();
});
