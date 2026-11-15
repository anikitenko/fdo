/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {installRegistryRelease, downloadRegistryArchive} from '../../src/utils/plugins/importing/registryInstall';
import {createRegistryInstallStore} from '../../src/utils/plugins/importing/registryInstallStore';
import {exportArchive} from '../../src/utils/plugins/exporting/exportArchive';
import {signRegistryFiles} from '../../src/utils/system/registrySigning';
import {registryLifecycleFixture} from '../helpers/registryLifecycleFixture';
import {publishingFixture} from '../helpers/publishingFixture';
import {organizationRegistries} from '../../src/utils/system/organizationRegistries';
jest.mock('../../src/utils/system/officialRegistry', () => ({officialRegistry:{}}));
let identity, directory, archive, release, store, options;
const target = {id:'release-console',version:'1.0.0'};
async function prepare(version='1.0.0', capabilities=['storage'], source) {
    const files = signRegistryFiles(source || {...publishingFixture({version}), 'index.ts':`export class ReleaseConsole {declareCapabilities(){return ${JSON.stringify(capabilities)};}}`},identity.chainPem,identity.key,[identity.root]);
    archive = await exportArchive(files);
    release={pluginId:target.id,version,packageSha256:crypto.createHash('sha256').update(archive).digest('hex'),signingMetadata:JSON.parse(files['fdo.meta.json']),signature:files['fdo.signature'].toString('base64'),signerFingerprint:JSON.parse(files['fdo.meta.json']).signerFingerprint,certificatePem:identity.leaf};
}
const install = version => installRegistryRelease({...target,version:version || '1.0.0'},options);
const commit = record => store.commit(target.id,store.get(target.id),record);
const noStaging = async () => expect((await fs.readdir(directory)).filter(name=>name!== 'plugins.json')).toEqual([]);
beforeAll(async()=>{identity=await registryLifecycleFixture();});
beforeEach(async()=>{
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'registry-install-test-'));
    store=createRegistryInstallStore(path.join(directory,'plugins.json'));
    await prepare();
    options={pluginsDir:directory,store,registryService:{releaseStatus:jest.fn(async()=>release)},download:jest.fn(async()=>archive),confirm:jest.fn(async()=>true),normalizeMetadata:value=>value,onProgress:jest.fn(),build:jest.fn(async()=>({outputFiles:[{path:'out.js',text:'module.exports = {};'}]}))};
});
afterEach(async()=>fs.rm(directory,{recursive:true,force:true}));
test('persists registry provenance, signed source and zero grants across store reloads',async()=>{
    expect(await install()).toMatchObject({success:true,action:'install',active:false});
    const record=createRegistryInstallStore(store.file).get(target.id);
    expect(record.registry).toMatchObject({origin:'https://plugins.fdo.alexvwan.me',pluginId:target.id,version:'1.0.0',packageSha256:release.packageSha256,signerFingerprint:release.signerFingerprint});
    expect(record.capabilities).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(record.home,'package.json'),'utf8')).version).toBe('1.0.0');
    expect(await fs.readFile(path.join(record.home,'dist/index.cjs'),'utf8')).toContain('module.exports');
});
test('uses a connected private registry for status, verification and persisted provenance', async () => {
    const registryId = 'org-' + 'a'.repeat(24);
    const selected = jest.spyOn(organizationRegistries, 'get').mockReturnValue({registry: options.registryService, connection: {id: registryId, name: 'Acme', url: 'https://plugins.acme.test'}});
    try {
        await installRegistryRelease({...target, registryId}, options);
        expect(selected).toHaveBeenCalledWith(registryId);
        expect(options.confirm).toHaveBeenCalledWith(expect.objectContaining({origin: 'https://plugins.acme.test'}));
        expect(store.get(target.id).registry.origin).toBe('https://plugins.acme.test');
        await expect(install()).rejects.toMatchObject({code: 'REGISTRY_SOURCE_CONFLICT'});
    } finally {selected.mockRestore();}
});
test('unknown private registry links cannot fall back to the official registry', async () => {
    const selected = jest.spyOn(organizationRegistries, 'get').mockImplementation(() => {throw new Error('Private registry is not connected');});
    try {
        await expect(installRegistryRelease({...target, registryId: 'org-' + 'a'.repeat(24)}, options)).rejects.toThrow('not connected');
        expect(options.registryService.releaseStatus).not.toHaveBeenCalled();
        expect(options.download).not.toHaveBeenCalled();
    } finally {selected.mockRestore();}
});
test('same version is a verified no-op without download or approval',async()=>{
    await install(); const previous=store.get(target.id);
    options.download.mockClear();options.confirm.mockClear();
    expect(await install()).toMatchObject({action:'already-installed',success:true});
    expect(options.download).not.toHaveBeenCalled();expect(options.confirm).not.toHaveBeenCalled();expect(store.get(target.id)).toEqual(previous);
});
test.each([['2.0.0','update'],['0.9.0','downgrade']])('replaces code with %s only after explicit %s approval and preserves user state',async(version,action)=>{
    await install(); let previous=store.get(target.id);
    previous={...previous,capabilities:['storage'],customProcessScopes:[{id:'local-scope'}]};commit(previous);
    await prepare(version);
    expect(await install(version)).toMatchObject({success:true,action,needsCapabilityReview:false});
    expect(options.confirm).toHaveBeenLastCalledWith(expect.objectContaining({action,installedVersion:'1.0.0',version}));
    const current=store.get(target.id);expect(current.registry.version).toBe(version);expect(current.capabilities).toEqual(['storage']);expect(current.customProcessScopes).toEqual(previous.customProcessScopes);
    expect(current.registry.installedAt).toBe(previous.registry.installedAt);await expect(fs.access(previous.home)).rejects.toThrow();
});
test('modified same-version source requires explicit repair',async()=>{
    await install();const previous=store.get(target.id);await fs.writeFile(path.join(previous.home,'index.ts'),'tampered');
    expect(await install()).toMatchObject({action:'repair'});
    expect(options.confirm).toHaveBeenLastCalledWith(expect.objectContaining({action:'repair'}));
});
test('legacy signed registry installations acquire durable provenance',async()=>{
    await install();const {registry,...legacy}=store.get(target.id);commit(legacy);
    expect(await install()).toMatchObject({action:'already-installed'});
    expect(store.get(target.id).registry).toMatchObject({pluginId:target.id,version:'1.0.0'});
});
test.each(['local','gitops'])('never overwrites a colliding %s installation',async(kind)=>{
    const previous={id:target.id,home:'/local/home',metadata:{name:'Local'},...(kind==='gitops'?{gitops:{sourceId:'collection'}}:{})};commit(previous);
    await expect(install()).rejects.toThrow(kind==='gitops'?'managed by GitOps':'local plugin');expect(store.get(target.id)).toEqual(previous);expect(options.download).not.toHaveBeenCalled();
});
test('revoked certificate or release blocks manual links, even for an installed version',async()=>{
    await install();const previous=store.get(target.id);options.download.mockClear();options.confirm.mockClear();
    options.registryService.releaseStatus.mockRejectedValue(Object.assign(new Error('Publisher certificate revoked'),{code:'REGISTRY_RELEASE_INACTIVE'}));
    await expect(install()).rejects.toMatchObject({code:'REGISTRY_RELEASE_INACTIVE'});
    expect(options.download).not.toHaveBeenCalled();expect(options.confirm).not.toHaveBeenCalled();expect(store.get(target.id)).toEqual(previous);
});
test('revocation during approval leaves old code and provenance untouched',async()=>{
    await install();const previous=store.get(target.id);await prepare('2.0.0');
    options.confirm.mockImplementation(async()=>{options.registryService.releaseStatus.mockRejectedValue(new Error('revoked'));return true;});
    await expect(install('2.0.0')).rejects.toThrow('revoked');expect(store.get(target.id)).toEqual(previous);await fs.access(previous.home);
});
test('capability escalation deactivates the plugin and never adds grants',async()=>{
    await install();commit({...store.get(target.id),capabilities:['storage']});await prepare('2.0.0',['storage','system.network']);
    options.runtime={getLoadedPlugin:()=>({}),unLoadPlugin:jest.fn(),loadPlugin:jest.fn()};options.isActivated=()=>true;options.setActivated=jest.fn();
    expect(await install('2.0.0')).toMatchObject({needsCapabilityReview:true,active:false});expect(store.get(target.id).capabilities).toEqual(['storage']);
    expect(options.setActivated).toHaveBeenCalledWith(target.id,false);expect(options.runtime.unLoadPlugin).toHaveBeenCalled();expect(options.runtime.loadPlugin).not.toHaveBeenCalled();
});
test('safe update preserves activation and restarts the runtime',async()=>{
    await install();commit({...store.get(target.id),capabilities:['storage']});await prepare('2.0.0');
    options.runtime={getLoadedPlugin:()=>({}),unLoadPlugin:jest.fn(),loadPlugin:jest.fn(async()=>({success:true}))};options.isActivated=()=>true;
    expect(await install('2.0.0')).toMatchObject({active:true,action:'update'});expect(options.runtime.loadPlugin).toHaveBeenCalledWith(target.id);
});
test('startup failure rolls back code and provenance to the previous release',async()=>{
    await install();const previous={...store.get(target.id),capabilities:['storage']};commit(previous);await prepare('2.0.0');
    options.runtime={getLoadedPlugin:()=>({}),unLoadPlugin:jest.fn(),loadPlugin:jest.fn().mockResolvedValueOnce({success:false,error:'startup failed'}).mockResolvedValue({success:true})};
    await expect(install('2.0.0')).rejects.toThrow('startup failed');expect(store.get(target.id)).toEqual(previous);await fs.access(previous.home);expect(options.runtime.loadPlugin).toHaveBeenCalledTimes(2);
});
test('grant edits made during review cause a conflict instead of losing user changes',async()=>{
    await install();await prepare('2.0.0');options.confirm.mockImplementation(async()=>{commit({...store.get(target.id),capabilities:['storage']});return true;});
    await expect(install('2.0.0')).rejects.toThrow('changed while');expect(store.get(target.id).registry.version).toBe('1.0.0');expect(store.get(target.id).capabilities).toEqual(['storage']);
});
test('cancellation and build failures clean staging without registering a plugin',async()=>{
    options.confirm.mockResolvedValue(false);expect(await install()).toEqual({cancelled:true});expect(store.all()).toEqual([]);await noStaging();
    options.confirm.mockResolvedValue(true);options.build.mockRejectedValue(new Error('build failed'));await expect(install()).rejects.toThrow('build failed');expect(store.all()).toEqual([]);await noStaging();
});
test('a tampered release is rejected before approval',async()=>{
    release.signingMetadata={...release.signingMetadata,signedAt:'2000-01-01T00:00:00Z'};await expect(install()).rejects.toThrow('does not match');expect(options.confirm).not.toHaveBeenCalled();await noStaging();
});
test('source metadata can supply the version without rewriting package.json',async()=>{
    const source=publishingFixture({version:undefined});source['index.ts']=`export class Plugin {metadata={name:'Source Name',version:'1.0.0',author:'Team',description:'Source metadata version',icon:'application'};declareCapabilities(){return ['storage'];}}`;
    await prepare('1.0.0',['storage'],source);await install();expect(JSON.parse(await fs.readFile(path.join(store.get(target.id).home,'package.json'),'utf8'))).not.toHaveProperty('version');
});
test('download pins origin and digest and rejects redirects and oversized payloads',async()=>{
    const request=jest.fn(async()=>new Response(archive));expect(await downloadRegistryArchive(release,request)).toEqual(archive);expect(request).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/plugins.fdo.alexvwan.me\/packages\//),expect.objectContaining({redirect:'error'}));
    await expect(downloadRegistryArchive(release,async()=>new Response('tampered'))).rejects.toThrow('digest');
    await expect(downloadRegistryArchive(release,async()=>new Response('',{headers:{'content-length':String(11*1024*1024)}}))).rejects.toThrow('10 MiB');
});
test('catalog failure does not block installation and verified source supplies the name',async()=>{
    options.registryService.releaseDisplayName=async()=>{throw new Error('offline catalog');};await install();expect(options.onProgress).toHaveBeenCalledWith({phase:'verifying',name:'release-console'});
});
test('concurrent duplicate requests serialize and converge on one durable installation',async()=>{
    const results=await Promise.all([install(),install()]);expect(results.map(item=>item.action).sort()).toEqual(['already-installed','install']);
    expect(store.all()).toHaveLength(1);expect(options.download).toHaveBeenCalledTimes(1);expect(options.confirm).toHaveBeenCalledTimes(1);
});
test('a fresh installation clears stale activation entries and remains inactive',async()=>{
    options.isActivated=()=>true;options.setActivated=jest.fn();options.runtime={getLoadedPlugin:()=>null,loadPlugin:jest.fn()};
    expect(await install()).toMatchObject({active:false,action:'install'});expect(options.setActivated).toHaveBeenCalledWith(target.id,false);expect(options.runtime.loadPlugin).not.toHaveBeenCalled();
});
