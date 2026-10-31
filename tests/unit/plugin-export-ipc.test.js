/** @jest-environment node */
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
test('blocked conversions allow saving a report but never a runnable web archive',async()=>{
    prepareWebApplicationExport.mockResolvedValue({report:{blockers:['Requires terminal gateway'],sourceFingerprint:'fingerprint'}});
    const review=await handlers[PluginChannels.EXPORT_PREVIEW](event,plugin.id);
    const result=await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'web',token:review.token});
    expect(result.error).toContain('conversion blockers');
    const output=path.join(root,'report.json');dialog.showSaveDialog.mockResolvedValue({canceled:false,filePath:output});
    expect((await handlers[PluginChannels.EXPORT_AS](event,plugin.id,{format:'report',token:review.token})).success).toBe(true);
    expect(JSON.parse(await fs.readFile(output,'utf8')).blockers).toEqual(['Requires terminal gateway']);
});
