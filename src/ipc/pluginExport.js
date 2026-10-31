import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import Module from 'node:module';
import {randomUUID} from 'node:crypto';
import {PluginChannels} from './channels';
import {inspectPluginFolder} from '../utils/plugins/importing/pluginFolderImport';
import {prepareWebApplicationExport,exportFingerprint} from '../utils/plugins/exporting/webApplicationExport';
import {exportArchive} from '../utils/plugins/exporting/exportArchive';
import {ensureExecutableEsbuildBinary,getHostPluginNodeModulesPath,loadHostEsbuild} from '../utils/plugins/runtime/pluginRuntimeBundle';
import {getIgnoreInstance} from '../utils/filesystem/getIgnoreInstance';
import {getAllFilesWithIgnorance} from '../utils/filesystem/getAllFilesWithIgnorance';
import {createMigrationWorkPackage} from '../utils/plugins/exporting/webExportRecovery';

// Only host-owned plugin paths and snapshots are accepted. No renderer-supplied
// paths, bundle code or capability overrides enter the export build.
export function registerPluginExportHandlers({getPlugin}) {
    const previews=new Map();
    const cleanupTimers=new Map(),observed=new WeakSet();
    const readPlugin=id=>{
        if(typeof id!=='string' || id.length>256)throw new Error('Choose an installed plugin.');
        const plugin=getPlugin(id);
        if(!plugin?.home)throw new Error('The installed plugin could not be found.');
        return {...plugin,name:plugin.metadata?.name || plugin.name || plugin.id};
    };
    ipcMain.handle(PluginChannels.EXPORT_PREVIEW,async(event,id)=>{
        const owner=event.sender.id;
        clearTimeout(cleanupTimers.get(owner));cleanupTimers.delete(owner);
        previews.delete(owner);
        try {
            const plugin=readPlugin(id),snapshot=await inspectPluginFolder(plugin.home),nodeModules=getHostPluginNodeModulesPath();
            ensureExecutableEsbuildBinary(nodeModules);
            const requireHost=Module.createRequire(path.join(nodeModules,'__web_export__.cjs'));
            const assets=path.join(path.dirname(nodeModules),'export-runtime');
            const [sdkSource,viewLibrary,runtimeSources]=await Promise.all([
                fs.readFile(requireHost.resolve('@anikitenko/fdo-sdk'),'utf8'),
                fs.readFile(path.join(assets,'view.js')),
                fs.readFile(path.join(assets,'runtime-sources.json'),'utf8').then(JSON.parse),
            ]);
            const prepared=await prepareWebApplicationExport({snapshot,plugin,sdkSource,viewLibrary,runtimeSources,esbuild:loadHostEsbuild(nodeModules)});
            if(event.sender.isDestroyed())return {success:false,error:'The export window closed.'};
            const token=randomUUID(),expires=Date.now()+10*60*1000;
            previews.set(owner,{id,token,expires,prepared});
            const timer=setTimeout(()=>{if(previews.get(owner)?.token===token)previews.delete(owner);},10*60*1000);timer.unref();
            cleanupTimers.set(owner,timer);
            if(!observed.has(event.sender)){observed.add(event.sender);event.sender.once('destroyed',()=>{clearTimeout(cleanupTimers.get(owner));cleanupTimers.delete(owner);previews.delete(owner);});}
            return {success:true,token,report:prepared.report};
        }catch(error){return {success:false,error:error.message};}
    });
    ipcMain.handle(PluginChannels.EXPORT_AS,async(event,id,options={})=>{
        try {
            if(!['archive','web','report','migration'].includes(options.format))return {success:false,error:'Choose a supported export format.'};
            const plugin=readPlugin(id);
            let filename,files,report;
            if(options.format==='archive') {
                filename=(String(plugin.name || 'plugin').replace(/[^\w.-]+/g,'-') || 'plugin')+'.zip';
                const ignore=await getIgnoreInstance(plugin.home,[],{includeDist:true});
                const paths=await getAllFilesWithIgnorance(plugin.home,relative=>!ignore.ignores(relative));
                files=Object.fromEntries(await Promise.all(paths.map(async file=>[path.relative(plugin.home,file).split(path.sep).join('/'),await fs.readFile(file)])));
            } else {
                const current=previews.get(event.sender.id);
                if(!current || current.id!==id || current.token!==options.token || current.expires<Date.now())return {success:false,error:'Review this plugin again before exporting. The previous review expired.'};
                const snapshot=await inspectPluginFolder(plugin.home);
                if(exportFingerprint(snapshot.virtual,plugin)!==current.prepared.report.sourceFingerprint)return {success:false,error:'Plugin source or permissions changed. Review the current version before exporting.'};
                report=current.prepared.report;
                if(options.format==='web') {
                    if(report.blockers.length || !current.prepared.files)return {success:false,error:'Resolve the conversion blockers before exporting a web application.'};
                    files=current.prepared.files;filename=current.prepared.filename;
                } else if(options.format==='migration') {
                    files=createMigrationWorkPackage(snapshot,report,plugin.name,plugin);
                    filename=(String(plugin.name || 'plugin').replace(/[^\w.-]+/g,'-') || 'plugin')+'-web-migration.zip';
                } else filename='web-conversion-report.json';
            }
            const window=BrowserWindow.fromWebContents(event.sender);
            const selection=await dialog.showSaveDialog(window || undefined,{title:options.format==='report'?'Save conversion report':'Export As',defaultPath:path.join(app.getPath('downloads'),filename),filters:[{name:options.format==='report'?'Conversion report':'ZIP archive',extensions:[options.format==='report'?'json':'zip']}]});
            if(selection.canceled || !selection.filePath)return {success:true,canceled:true};
            const content=options.format==='report'?JSON.stringify(report,null,2)+'\n':await exportArchive(files);
            const temporary=selection.filePath+'.'+randomUUID()+'.tmp';
            try{await fs.writeFile(temporary,content,{flag:'wx',mode:0o600});await fs.rename(temporary,selection.filePath);}
            finally{await fs.rm(temporary,{force:true});}
            return {success:true,path:selection.filePath};
        }catch(error){return {success:false,error:error.message};}
    });
}
