import {Certs} from '../utils/system/certs';
import {certificateStorage} from '../utils/persistence/certificateStorage';
import {createRegistryArchive} from '../utils/plugins/publishing/registryArchive';
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
import {normalizeExportPort} from '../utils/plugins/exporting/exportOptions';

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
    ipcMain.handle(PluginChannels.EXPORT_PREVIEW,async(event,id,options={})=>{
        const owner=event.sender.id;
        clearTimeout(cleanupTimers.get(owner));cleanupTimers.delete(owner);
        previews.delete(owner);
        try {
            const port=normalizeExportPort(options?.port);
            const plugin=readPlugin(id),snapshot=await inspectPluginFolder(plugin.home),nodeModules=getHostPluginNodeModulesPath();
            ensureExecutableEsbuildBinary(nodeModules);
            const requireHost=Module.createRequire(path.join(nodeModules,'__web_export__.cjs'));
            const assets=path.join(path.dirname(nodeModules),'export-runtime');
            const [sdkSource,viewLibrary,runtimeSources]=await Promise.all([
                fs.readFile(requireHost.resolve('@anikitenko/fdo-sdk'),'utf8'),
                fs.readFile(path.join(assets,'view.js')),
                fs.readFile(path.join(assets,'runtime-sources.json'),'utf8').then(JSON.parse),
            ]);
            const prepared=await prepareWebApplicationExport({snapshot,plugin,sdkSource,viewLibrary,runtimeSources,esbuild:loadHostEsbuild(nodeModules),port,
                resolveSharedProvider:async providerId=>{const provider=readPlugin(providerId);return {plugin:provider,snapshot:await inspectPluginFolder(provider.home)};}});
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
            let filename,files,report,signingIdentity,localSigner,archiveBuffer;
            if(options.format==='archive') {
                const identities = certificateStorage.list('registry').filter(entry => entry.kind === 'developer' && entry.hasPrivateKey);
                const roots = certificateStorage.list('root').filter(entry => entry.hasPrivateKey);
                if (options.signerId?.startsWith('registry:')) {
                    signingIdentity = identities.find(entry => entry.id === options.signerId.slice('registry:'.length));
                } else if (options.signerId) {
                    localSigner = roots.find(entry => entry.label === options.signerId);
                }
                if (options.signerId && !signingIdentity && !localSigner)
                    return {success: false, error: 'The selected signing certificate is no longer available. Reopen Export As.'};
                if (!options.signerId && (identities.length || roots.length))
                    return {success: false, error: 'Choose the signing certificate for this export.'};
                filename=(String(plugin.name || 'plugin').replace(/[^\w.-]+/g,'-') || 'plugin')+'.zip';
                if (signingIdentity) {
                    const prepared = await createRegistryArchive(plugin.home, signingIdentity.id);
                    archiveBuffer = prepared.archive;
                    signingIdentity = {...signingIdentity, id: prepared.signerId};
                } else {
                    const ignore = await getIgnoreInstance(plugin.home, [], {includeDist: true});
                    const paths = await getAllFilesWithIgnorance(plugin.home, relative => !ignore.ignores(relative));
                    files = Object.fromEntries(await Promise.all(paths.map(async file => [path.relative(plugin.home, file).split(path.sep).join('/'), await fs.readFile(file)])));
                }
                if (localSigner) {
                    // Sign an isolated copy with the same signer as the editor, leaving
                    // the installed plugin and its existing signature untouched.
                    const staging = await fs.mkdtemp(path.join(app.getPath('temp'), 'fdo-export-sign-'));
                    try {
                        for (const [name, content] of Object.entries(files)) {
                            const target = path.join(staging, name);
                            await fs.mkdir(path.dirname(target), {recursive: true});
                            await fs.writeFile(target, content);
                        }
                        const result = await Certs.signWithCertificate(staging, localSigner.label);
                        if (!result.success) return {success: false, error: result.error};
                        for (const name of ['fdo.meta.json', 'fdo.signature', '.fdoignore'])
                            files[name] = await fs.readFile(path.join(staging, name));
                    } finally {await fs.rm(staging, {recursive: true, force: true});}
                }

            } else {
                const current=previews.get(event.sender.id);
                if(!current || current.id!==id || current.token!==options.token || current.expires<Date.now())return {success:false,error:'Review this plugin again before exporting. The previous review expired.'};
                const snapshot=await inspectPluginFolder(plugin.home);
                if(exportFingerprint(snapshot.virtual,plugin)!==current.prepared.report.sourceFingerprint)return {success:false,error:'Plugin source or permissions changed. Review the current version before exporting.'};
                for(const dependency of current.prepared.report.sharedLogic?.providers || []) {
                    const provider=readPlugin(dependency.id),providerSnapshot=await inspectPluginFolder(provider.home);
                    if(exportFingerprint(providerSnapshot.virtual,provider)!==dependency.sourceFingerprint)return {success:false,error:'Shared provider source, permissions or service bindings changed. Review the current version before exporting.'};
                }
                report=current.prepared.report;
                if(options.format==='web') {
                    if(report.blockers.length || !current.prepared.files)return {success:false,error:'Resolve the conversion blockers before exporting a web application.'};
                    files=current.prepared.files;filename=current.prepared.filename;
                } else if(options.format==='migration') {
                    files=createMigrationWorkPackage(snapshot,report,plugin.name,plugin);
                    filename=(String(plugin.name || 'plugin').replace(/[^\w.-]+/g,'-') || 'plugin')+'-web-migration.zip';
                } else filename='web-conversion-report.json';
            }
            const isJson=options.format==='report';
            const window=BrowserWindow.fromWebContents(event.sender);
            const selection=await dialog.showSaveDialog(window || undefined,{title:isJson?'Save conversion report':'Export As',defaultPath:path.join(app.getPath('downloads'),filename),filters:[{name:isJson?'Conversion report':'ZIP archive',extensions:[isJson?'json':'zip']}]});
            if(selection.canceled || !selection.filePath)return {success:true,canceled:true};
            const content=isJson?JSON.stringify(report,null,2)+'\n':archiveBuffer || await exportArchive(files);
            if(signingIdentity && content.length>10*1024*1024)return {success:false,error:'Registry source ZIP exceeds 10 MiB.'};
            const temporary=selection.filePath+'.'+randomUUID()+'.tmp';
            try{await fs.writeFile(temporary,content,{flag:'wx',mode:0o600});await fs.rename(temporary,selection.filePath);}
            finally{await fs.rm(temporary,{force:true});}
            if(signingIdentity)certificateStorage.update(signingIdentity.id,{lastUsedAt:new Date().toISOString()},'registry');
            return {success:true,path:selection.filePath};
        }catch(error){return {success:false,error:error.message};}
    });
}
