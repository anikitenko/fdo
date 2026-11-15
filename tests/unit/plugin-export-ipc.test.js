/** @jest-environment node */
jest.mock('../../src/utils/system/certs',()=>({Certs:{signWithCertificate:jest.fn()}}));
jest.mock('../../src/utils/system/registryIdentity',()=>({registryIdentityLifecycle:{ensureIdentity:jest.fn(async entry=>entry)}}));
jest.mock('../../src/utils/system/officialRegistry',()=>({officialRegistry:{ensureAnchor:jest.fn(),trust:jest.fn()}}));
jest.mock('../../src/utils/persistence/certificateStorage',()=>({certificateStorage:{list:jest.fn(),privateKey:jest.fn(),update:jest.fn()}}));
jest.mock('../../src/utils/system/registrySigning',()=>({signRegistryFiles:jest.fn()}));
import {Certs} from '../../src/utils/system/certs';
import {officialRegistry} from '../../src/utils/system/officialRegistry';
import {organizationRegistries} from '../../src/utils/system/organizationRegistries';
import {certificateStorage} from '../../src/utils/persistence/certificateStorage';
import {signRegistryFiles} from '../../src/utils/system/registrySigning';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ipcMain,dialog} from 'electron';
import {registerPluginExportHandlers} from '../../src/ipc/pluginExport';
import {PluginChannels} from '../../src/ipc/channels';
import {inspectPluginFolder} from '../../src/utils/plugins/importing/pluginFolderImport';
import {prepareWebApplicationExport,exportFingerprint} from '../../src/utils/plugins/exporting/webApplicationExport';
jest.mock('electron',()=>({ipcMain:{handle:jest.fn()},dialog:{showSaveDialog:jest.fn()},app:{getPath:()=>require('node:os').tmpdir()},BrowserWindow:{fromWebContents:()=>undefined}}));
jest.mock('../../src/utils/plugins/importing/pluginFolderImport',()=>({inspectPluginFolder:jest.fn()}));
jest.mock('../../src/utils/plugins/exporting/webApplicationExport',()=>({prepareWebApplicationExport:jest.fn(),exportFingerprint:jest.fn()}));
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle',()=>({ensureExecutableEsbuildBinary:jest.fn(),getHostPluginNodeModulesPath:()=>require('path').resolve('node_modules'),loadHostEsbuild:()=>({})}));
jest.mock('node:module',()=>({__esModule:true,default:{createRequire:()=>({resolve:()=>require('path').resolve('package.json')})}}));
let root,handlers,plugin,event;
let readFileSpy;
beforeEach(async()=>{
    jest.clearAllMocks();
    officialRegistry.ensureAnchor.mockResolvedValue({id:'official',cert:'root'});
    officialRegistry.trust.mockResolvedValue({anchors:['root']});
    certificateStorage.list.mockReturnValue([]);
    certificateStorage.privateKey.mockReturnValue('private');
    signRegistryFiles.mockImplementation(files=>({...files,'fdo.meta.json':Buffer.from('{"format":"fdo-registry-v1"}'),'fdo.signature':Buffer.from('NEW SIGNATURE')}));
    root=await fs.mkdtemp(path.join(os.tmpdir(),'export-ipc-'));
    await fs.writeFile(path.join(root,'index.ts'),'source');
    plugin={id:'owned-plugin',name:'Owned',home:root,capabilities:[]};
    const sender=new EventEmitter();sender.id=1;sender.isDestroyed=()=>false;event={sender};
    ipcMain.handle.mockClear();registerPluginExportHandlers({getPlugin:id=>id===plugin.id?plugin:null});
    handlers=Object.fromEntries(ipcMain.handle.mock.calls);
    inspectPluginFolder.mockResolvedValue({virtual:{'/index.ts':'source'},sourceEntry:'index.ts',files:[{path:'index.ts',content:'source'}]});
    prepareWebApplicationExport.mockResolvedValue({filename:'app.zip',files:{'README.md':'application'},report:{blockers:[],sourceFingerprint:'fingerprint'}});
    exportFingerprint.mockReturnValue('fingerprint');
    dialog.showSaveDialog.mockResolvedValue({canceled:true});
    const original=fs.readFile;
    readFileSpy=jest.spyOn(fs,'readFile').mockImplementation((file,...args)=>String(file).endsWith('export-runtime/view.js')?Promise.resolve(Buffer.from('view')):String(file).endsWith('export-runtime/runtime-sources.json')?Promise.resolve('{}'):original(file,...args));
});
afterEach(async()=>{readFileSpy?.mockRestore();event.sender.emit('destroyed');await fs.rm(root,{recursive:true,force:true});});
test('archive cancel writes no file and unknown plugin identities fail before a save dialog',async()=>{
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive'})).toEqual({success:true,canceled:true});
    const result=await handlers[PluginChannels.EXPORT_AS](event,'other-plugin',{format:'archive'});
    expect(result.success).toBe(false);expect(await fs.readdir(root)).toEqual(['index.ts']);
});
test.each(['web','migration'])('%s export requires a host-owned reviewed snapshot, with no renderer paths or grants',async format=>{
    const result=await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format,token:'forged',home:'/tmp/forged',capabilities:['sudo.prompt']});
    expect(result).toMatchObject({success:false,error:expect.stringContaining('Review this plugin')});
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
test('a blocked review can save a migration work package without changing installed source or grants',async()=>{
    prepareWebApplicationExport.mockResolvedValue({report:{blockers:['Requires terminal gateway'],sourceFingerprint:'fingerprint',contractVersion:'1.1.0'}});
    const review=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id);
    const output=path.join(root,'migration.zip');dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    const before={...plugin};
    expect((await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'migration',token:review.token})).success).toBe(true);
    expect((await fs.readFile(output)).subarray(0,2).toString()).toBe('PK');
    expect(await fs.readFile(path.join(root,'index.ts'),'utf8')).toBe('source');expect(plugin).toEqual(before);
});
test('native archive export saves a ZIP atomically and leaves no temporary files',async()=>{
    const output=path.join(root,'archive.zip');dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive'})).toEqual({success:true,path:output});
    expect((await fs.readFile(output)).subarray(0,2).toString()).toBe('PK');expect((await fs.readdir(root)).sort()).toEqual(['archive.zip','index.ts']);
});
test('review tokens cannot cross windows and changed source or grants invalidate export',async()=>{
    const review=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id);
    expect(review.success).toBe(true);
    const other=await handlers[PluginChannels.EXPORT_AS]({sender:{id:2}},plugin.id,{format:'web',token:review.token});
    expect(other.success).toBe(false);
    exportFingerprint.mockReturnValue('changed');
    const changed=await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'web',token:review.token});
    expect(changed).toMatchObject({success:false,error:expect.stringContaining('source or permissions changed')});
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
test('only a validated port is accepted as an export preview option',async()=>{
    const result=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id,{port:9090,home:'/tmp/not-owned',capabilities:['sudo.prompt']});
    expect(result.success).toBe(true);
    expect(prepareWebApplicationExport).toHaveBeenCalledWith(expect.objectContaining({port:9090,plugin:expect.objectContaining({home:root,capabilities:[]})}));
    prepareWebApplicationExport.mockClear();
    expect(await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id,{port:'8080; touch /tmp/no'})).toMatchObject({success:false,error:expect.stringContaining('1024 to 65535')});
    expect(prepareWebApplicationExport).not.toHaveBeenCalled();
    expect((await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'web',token:result.token})).success).toBe(false);
});
test('blocked conversions allow saving a report but never a runnable web archive',async()=>{
    prepareWebApplicationExport.mockResolvedValue({report:{blockers:['Requires terminal gateway'],sourceFingerprint:'fingerprint'}});
    const review=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id);
    const result=await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'web',token:review.token});
    expect(result.error).toContain('conversion blockers');
    const output=path.join(root,'report.json');dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    expect((await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'report',token:review.token})).success).toBe(true);
    expect(JSON.parse(await fs.readFile(output,'utf8')).blockers).toEqual(['Requires terminal gateway']);
});

test('provider source or approvals changing after review invalidate the Docker export',async()=>{
    const provider={id:'provider',name:'Provider',home:path.join(root,'provider'),capabilities:['plugins.shared.provide']};
    registerPluginExportHandlers({getPlugin:id=>id===plugin.id?plugin:id===provider.id?provider:null});
    handlers=Object.fromEntries(ipcMain.handle.mock.calls);
    prepareWebApplicationExport.mockResolvedValue({filename:'app.zip',files:{'README.md':'application'},report:{blockers:[],sourceFingerprint:'fingerprint',sharedLogic:{providers:[{id:'provider',sourceFingerprint:'reviewed-provider'}]}}});
    exportFingerprint.mockImplementation((_files,owner)=>owner.id===provider.id?'changed-provider':'fingerprint');
    const review=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id,{providers:[{home:'/tmp/untrusted'}]});
    const resolver=prepareWebApplicationExport.mock.calls.at(-1)[0].resolveSharedProvider;
    expect((await resolver(provider.id)).plugin).toMatchObject({id:'provider',home:provider.home});
    await expect(resolver('untrusted')).rejects.toThrow('installed plugin');
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'web',token:review.token})).toMatchObject({success:false,error:expect.stringContaining('Shared provider source, permissions or service bindings changed')});
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});

test('normal plugin export signs automatically with the imported developer identity and embeds signing files',async()=>{
    certificateStorage.list.mockImplementation(scope=>scope==='registry'?[{id:'developer',kind:'developer',hasPrivateKey:true,anchorId:'official',chainPem:'chain'}]:[]);
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'test-utils',version:'1.0.0',author:'Team',description:'Test plugin',fdo:{compatibility:{fdo:'*',sdk:'*',api:'*'}}}));
    for(const name of ['dist/bundle.js','node_modules/vendor/index.js','.git/config','fdo.signature','fdo.meta.json','.env','signer.key','root.pem']) {
        await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),'PRIVATE');
    }
    const output=path.join(root,'source.zip');dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive',signerId:'registry:developer'})).toEqual({success:true,path:output});
    expect(signRegistryFiles).toHaveBeenCalledWith(expect.objectContaining({'index.ts':expect.any(Buffer)}),'chain','private',['root']);
    const zip=await fs.readFile(output);
    expect(zip.includes(Buffer.from('fdo.meta.json'))).toBe(true);expect(zip.includes(Buffer.from('fdo.signature'))).toBe(true);
    expect(zip.includes(Buffer.from('index.ts'))).toBe(true);
    expect(zip.includes(Buffer.from('package.json'))).toBe(true);
    for(const name of ['dist/bundle.js','node_modules/vendor/index.js','.git/config','.env','signer.key','root.pem'])expect(zip.includes(Buffer.from(name))).toBe(false);
});
test('organization certificates use the normal ZIP export with the selected private registry trust', async () => {
    const identity = {id: 'org-id/developer', scope: 'org', registryId: 'org-id', kind: 'developer', hasPrivateKey: true, chainPem: 'private-chain'};
    certificateStorage.list.mockImplementation(scope => scope === 'org' ? [identity] : []);
    const selected = jest.spyOn(organizationRegistries, 'forCertificate').mockReturnValue({registry: {trust: async () => ({anchors: ['private-root']})}, lifecycle: {ensureIdentity: async entry => entry}});
    try {
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({name: 'test-utils', version: '1.0.0', author: 'Team', description: 'Test plugin', fdo: {compatibility: {fdo: '*', sdk: '*', api: '*'}}}));
        const output = path.join(root, 'private.zip'); dialog.showSaveDialog.mockResolvedValue({canceled: false, filePath: output});
        expect(await handlers[PluginChannels.EXPORT_AS](event, plugin.id, {format: 'archive', signerId: 'organization:org-id/developer'})).toEqual({success: true, path: output});
        expect(signRegistryFiles).toHaveBeenCalledWith(expect.any(Object), 'private-chain', 'private', ['private-root']);
        expect(certificateStorage.privateKey).toHaveBeenCalledWith(identity.id, 'org');
        expect(certificateStorage.update).toHaveBeenCalledWith(identity.id, expect.any(Object), 'org');
    } finally {selected.mockRestore();}
});
test('signed plugin export refuses a missing package manifest',async()=>{
    certificateStorage.list.mockImplementation(scope=>scope==='registry'?[{id:'developer',kind:'developer',hasPrivateKey:true,anchorId:'official',chainPem:'chain'}]:[]);
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive',signerId:'registry:developer'})).toMatchObject({success:false,error:expect.stringContaining('package.json')});
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});

test('a removed or ambiguous signing identity cannot silently produce an unsigned archive',async()=>{
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive',signerId:'missing'})).toMatchObject({success:false,error:expect.stringContaining('no longer available')});
    certificateStorage.list.mockImplementation(scope=>scope==='registry'?[{id:'first',kind:'developer',hasPrivateKey:true},{id:'second',kind:'developer',hasPrivateKey:true}]:[]);
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive'})).toMatchObject({success:false,error:expect.stringContaining('Choose the signing certificate')});
});
test('there is no separate registry format or detached manifest export',async()=>{
    for(const format of ['registry','registry-sign'])expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format})).toMatchObject({success:false,error:expect.stringContaining('supported export format')});
});


test('root archive export uses the editor signer on an isolated copy without changing installed files', async () => {
    certificateStorage.list.mockImplementation(scope => scope === 'root' ? [{id:'root-id',label:'Team root',hasPrivateKey:true}] : []);
    await fs.writeFile(path.join(root, 'fdo.signature'), 'installed signature');
    Certs.signWithCertificate.mockImplementation(async (directory, label) => {
        expect(directory).not.toBe(root);
        expect(label).toBe('Team root');
        expect(await fs.readFile(path.join(directory, 'index.ts'), 'utf8')).toBe('source');
        await fs.writeFile(path.join(directory, 'fdo.meta.json'), '{"signedBy":"root"}');
        await fs.writeFile(path.join(directory, 'fdo.signature'), 'new signature');
        await fs.writeFile(path.join(directory, '.fdoignore'), '*.log');
        return {success:true};
    });
    const output=path.join(root, 'root-signed.zip');
    dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    expect(await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'archive',signerId:'Team root'})).toEqual({success:true,path:output});
    expect(await fs.readFile(path.join(root, 'fdo.signature'), 'utf8')).toBe('installed signature');
    expect((await fs.readFile(output)).includes(Buffer.from('fdo.signature'))).toBe(true);
    const staging=Certs.signWithCertificate.mock.calls.at(-1)[0];
    await expect(fs.stat(staging)).rejects.toMatchObject({code:'ENOENT'});
});
