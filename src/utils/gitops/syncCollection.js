import {readFileSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {inspectGitOpsCapabilities} from './inspectCapabilities';
import {normalizeCapabilityList} from '../plugins/security/pluginCapabilities';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {repositoryPath, repositoryUrl, validateCollection} from './manifest';
import {extractMetadata} from '../plugins/runtime/extractMetadata';
import {pluginBuildSource, pluginBuildEntrypoint} from '../plugins/runtime/pluginBuildArtifact';
import {assertPluginCompatibility} from '../sdk/pluginCompatibility';
import {inspectPluginCompatibility} from '../sdk/pluginCompatibilityHost';

function requireApprovedRuntime(result) {
    if(!result.success)throw new Error(`The approved update could not start: ${result.error||'unknown error'}`);
}

const BUILD_PIPELINE_VERSION = 3;

export const managedPluginId = (sourceId, name) => `gitops_${sourceId}_${name}`;

async function registry(file) {
    let text;
    try {text = await readFile(file, 'utf8');}
    catch (error) {
        if (error.code === 'ENOENT') return {plugins: []};
        throw error;
    }
    const data = JSON.parse(text);
    if (!Array.isArray(data.plugins)) throw new Error('Invalid plugin registry.');
    return data;
}

async function saveRegistry(file, data) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await mkdir(path.dirname(file), {recursive: true});
        await writeFile(temporary, JSON.stringify(data, null, 4), {mode: 0o600});
        await rename(temporary, file);
    } finally { await rm(temporary, {force: true}); }
}

// The final read/modify/rename is synchronous so Settings IPC cannot change
// grants between the approval check and its registry commit.
function commitRegistry(file,change) {
    let current;
    try {current=JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;current={plugins:[]};}
    if(!Array.isArray(current.plugins))throw new Error('Invalid plugin registry.');
    const next=change(current),temporary=`${file}.${randomUUID()}.tmp`;
    mkdirSync(path.dirname(file),{recursive:true});
    try {writeFileSync(temporary,JSON.stringify(next,null,4),{mode:0o600});renameSync(temporary,file);}
    finally {rmSync(temporary,{force:true});}
    return next;
}
const sourceIdentity=source=>JSON.stringify([source.url,source.manifestPath,source.targetRevision,source.commit]);

async function waitForRuntime(runtime,id) {
    if(typeof runtime.getLoadedPluginReady!=='function')return;
    const deadline=Date.now()+15000;
    let spawned=false;
    while(!runtime.getLoadedPluginReady(id)) {
        const loaded=!!runtime.getLoadedPlugin(id);
        if((spawned&&!loaded)||Date.now()>=deadline)throw new Error('The updated plugin did not become ready.');
        spawned=spawned||loaded;
        await new Promise(resolve=>setTimeout(resolve,50));
    }
}

export async function detachCollection(registryFile, sourceId) {
    const staged=[];
    commitRegistry(registryFile,data=>{
    data.plugins = data.plugins.map(plugin => {
        if (plugin.gitops?.sourceId !== sourceId) return plugin;
        const {gitops, ...local} = plugin;
        const home=gitops.pendingUpdate?.candidate?.home;if(home&&path.dirname(home)===path.dirname(plugin.home))staged.push(home);
        return local;
    });
    return data;});
    for(const home of staged)await rm(home,{recursive:true,force:true}).catch(()=>{});
}

// Build, sign, and verify all candidates before making any registry changes.
export async function syncCollection({source, secret, pluginsDir, registryFile, fetchPlugin,
    build, normalizeMetadata, sign, verifySignature, runtime, activatedIds = () => [], removeActivated = () => {}, pluginName, pruneOnly = false}) {
    validateCollection(JSON.stringify(source.manifest));
    await mkdir(pluginsDir, {recursive: true});
    const initial = await registry(registryFile);
    const prepared = [];
    const newHomes = [];
    let prior;
    let affected = [];
    const transactionState = {registryChanged: false};
    const pendingUpdates = [], reviewStatuses = [];
    let managedIds = new Set();
    const declarations = source.manifest.spec.plugins;
    if (pluginName && !declarations.some(plugin => plugin.name === pluginName)) throw new Error('This plugin is no longer declared by the collection. Refresh the collection first.');
    const preparePlugin = async declaration => {
        const id = managedPluginId(source.id, declaration.name);
        const previous = initial.plugins.find(plugin => plugin.id === id);
        if (previous && previous.gitops?.sourceId !== source.id) throw new Error(`Plugin identity is already in use: ${id}`);
        const url = repositoryUrl(declaration.repository);
        const useCredentials = source.authType === 'basic' && new URL(url).origin === new URL(source.url).origin;
        const snapshot = await fetchPlugin({url, targetRevision: declaration.targetRevision, path: declaration.path,
            authType: useCredentials ? 'basic' : 'none', ...(useCredentials ? secret : {})});
        const matches = candidate => candidate?.gitops?.buildPipelineVersion === BUILD_PIPELINE_VERSION && candidate.gitops.commit === snapshot.commit && candidate.gitops.repository === url && candidate.gitops.path === declaration.path;
        if(previous?.gitops?.declinedUpdate?.commit===snapshot.commit && previous.gitops.declinedUpdate.repository===url && previous.gitops.declinedUpdate.path===declaration.path) {
            prepared.push(previous);return;
        }
        const staged=previous?.gitops?.pendingUpdate?.candidate;
        if(matches(staged)) {
            const verified=await verifySignature(staged.home);
            if(verified.success&&verified.signer?.label==='root') {prepared.push({...staged,gitops:{...staged.gitops,targetRevision:declaration.targetRevision}});return;}
        }
        const existingSignature = previous?.gitops?.buildPipelineVersion === BUILD_PIPELINE_VERSION && previous.gitops.commit === snapshot.commit && previous.gitops.repository === url && previous.gitops.path === declaration.path
            ? await verifySignature(previous.home) : null;
        if (existingSignature?.success && existingSignature.signer?.label === 'root') {
            const {pendingUpdate,declinedUpdate,...gitops}=previous.gitops;
            prepared.push({...previous, gitops: {...gitops, targetRevision: declaration.targetRevision}});
            return;
        }
        const home = path.join(pluginsDir, `${id}_${randomUUID()}`);
        newHomes.push(home);
        await mkdir(home, {recursive: true});
        const virtual = {};
        for (const file of snapshot.files) {
            const relative = repositoryPath(file.path, {field: 'Plugin file path'});
            const target = path.join(home, relative);
            await mkdir(path.dirname(target), {recursive: true});
            await writeFile(target, file.content);
            virtual[`/${relative}`] = file.content.toString('utf8');
        }
        let pkg;
        try { pkg = JSON.parse(virtual['/package.json']); }
        catch { throw new Error(`${declaration.name}: a valid package.json is required.`); }
        const sourceEntry = pluginBuildSource(virtual);
        let entry;
        let metadata;
        if (sourceEntry) {
            if (!virtual[`/${sourceEntry}`]) throw new Error(`${declaration.name}: package source is missing.`);
            metadata = await extractMetadata(virtual[`/${sourceEntry}`]);
            const output = await build(virtual);
            if (!output.outputFiles?.[0]?.text) throw new Error(`${declaration.name}: build produced no JavaScript.`);
            entry = pluginBuildEntrypoint(virtual);
            await mkdir(path.dirname(path.join(home, entry)), {recursive: true});
            await writeFile(path.join(home, entry), output.outputFiles[0].text);
        } else {
            entry = repositoryPath((pkg.main || 'dist/index.cjs').replace(/^\.\//, ''), {field: 'Package entry point'});
            await access(path.join(home, entry));
        }
        metadata = normalizeMetadata(metadata || {
            name: declaration.name, version: pkg.version, author: typeof pkg.author === 'object' ? pkg.author?.name : pkg.author,
            description: pkg.description || declaration.name, icon: pkg.fdo?.icon || 'application',
        });
        assertPluginCompatibility(inspectPluginCompatibility(JSON.stringify(pkg), await readFile(path.join(home, entry), 'utf8')));
        const signed = await sign(home, 'root');
        if (!signed.success) throw new Error(`Default certificate signing failed: ${signed.error}`);
        const verified = await verifySignature(home);
        if (!verified.success) throw new Error(`Signed plugin verification failed: ${verified.error}`);
        const inspection=inspectGitOpsCapabilities(await readFile(path.join(home,entry),'utf8'));
        prepared.push({id, metadata, home, entry, capabilities: previous?.capabilities || [],
            customProcessScopes: previous?.customProcessScopes || [], customFilesystemScopes: previous?.customFilesystemScopes || [],
            gitops: {sourceId: source.id, declaredId: declaration.name, repository: url, buildPipelineVersion: BUILD_PIPELINE_VERSION,
                targetRevision: declaration.targetRevision, path: declaration.path, commit: snapshot.commit, requestedCapabilities:inspection.capabilities, capabilityInspectionError:inspection.error}});
    };
    const reloadPlugin = async id => {
        const result = await runtime.loadPlugin(id);
        if (!result.success) throw new Error(`Plugin reload failed: ${result.error || id}`);
        await waitForRuntime(runtime,id);
    };
    try {
        for (const declaration of declarations.filter(plugin => !pruneOnly && (!pluginName || plugin.name === pluginName))) {
            await preparePlugin(declaration);
        }
        // Read fresh data after network/build work so other plugins' edits are retained.
        prior = await registry(registryFile);
        const owned = prior.plugins.filter(plugin => plugin.gitops?.sourceId === source.id &&
            (!pluginName || plugin.gitops.declaredId === pluginName) && (!pruneOnly || !declarations.some(item => item.name === plugin.gitops.declaredId)));
        const chooseCandidate=(plugin,current) => {
            if (current && current.gitops?.sourceId !== source.id) throw new Error(`Plugin identity is already in use: ${plugin.id}`);
            if(!current)return plugin;
            const grants=normalizeCapabilityList(current.capabilities||[]).sort();
            const requested=plugin.gitops.requestedCapabilities||[];
            const added=requested.filter(capability=>!grants.includes(capability));
            const oldPending=current.gitops.pendingUpdate;
            if(plugin.home!==current.home && (plugin.gitops.capabilityInspectionError || added.length || oldPending?.candidate?.home===plugin.home)) {
                const unchanged=oldPending?.candidate?.home===plugin.home && JSON.stringify(oldPending.addedCapabilities)===JSON.stringify(added) && JSON.stringify(oldPending.grantsAtReview)===JSON.stringify(grants) && oldPending.sourceIdentity===sourceIdentity(source);
                const pending={id:unchanged?oldPending.id:randomUUID(),createdAt:unchanged?oldPending.createdAt:new Date().toISOString(),
                    baseHome:current.home,baseCommit:current.gitops.commit,sourceIdentity:sourceIdentity(source),grantsAtReview:grants,
                    candidate:plugin,addedCapabilities:added,removedCapabilities:(current.gitops.requestedCapabilities||[]).filter(capability=>!requested.includes(capability)),
                    inspectionError:plugin.gitops.capabilityInspectionError||''};
                const staged={...current,gitops:{...current.gitops,pendingUpdate:pending,declinedUpdate:undefined}};
                pendingUpdates.push({...pendingUpdateSummary(staged),newReview:!unchanged});
                return staged;
            }
            if(plugin.gitops.declinedUpdate)reviewStatuses.push({name:plugin.gitops.declaredId,state:'declined',commit:plugin.gitops.declinedUpdate.commit});
            return {...plugin, capabilities: current.capabilities || [],
                customProcessScopes: current.customProcessScopes || [], customFilesystemScopes: current.customFilesystemScopes || []};
        };
        let next=prepared.map(plugin=>chooseCandidate(plugin,prior.plugins.find(item=>item.id===plugin.id)));
        let changedOld = owned.filter(plugin => !next.some(candidate => candidate.id === plugin.id && candidate.home === plugin.home));
        managedIds = new Set([...owned, ...next].map(plugin => plugin.id));
        affected = changedOld.filter(plugin => runtime.getLoadedPlugin(plugin.id) || activatedIds().includes(plugin.id)).map(plugin => plugin.id);
        for (const id of affected) await runtime.unLoadPlugin(id, {force: true, reason: 'gitops_sync'});
        commitRegistry(registryFile,fresh=>{
            pendingUpdates.length=0;reviewStatuses.length=0;
            next=prepared.map(plugin=>chooseCandidate(plugin,fresh.plugins.find(item=>item.id===plugin.id)));
            return {...fresh,plugins:[...fresh.plugins.filter(plugin=>!managedIds.has(plugin.id)),...next]};
        });
        changedOld=owned.filter(plugin=>!next.some(candidate=>candidate.id===plugin.id&&candidate.home===plugin.home));
        transactionState.registryChanged = true;
        for (const id of affected.filter(id => next.some(plugin => plugin.id === id))) {
            await reloadPlugin(id);
        }
        const removed = owned.filter(plugin => !next.some(candidate => candidate.id === plugin.id));
        removeActivated(removed.map(plugin => plugin.id));
        // Old plugin-data is intentionally retained; code versions can be replaced safely.
        for (const plugin of changedOld) {
            if (path.dirname(plugin.home) === pluginsDir) await rm(plugin.home, {recursive: true, force: true}).catch(() => {});
        }
        const retained=new Set(next.flatMap(plugin=>[plugin.home,plugin.gitops?.pendingUpdate?.candidate?.home].filter(Boolean)));
        const obsolete=new Set([...newHomes,...owned.map(plugin=>plugin.gitops?.pendingUpdate?.candidate?.home).filter(Boolean)]);
        for(const home of obsolete)if(!retained.has(home)&&path.dirname(home)===pluginsDir)await rm(home,{recursive:true,force:true}).catch(()=>{});
        const installed = (await registry(registryFile)).plugins.filter(plugin => plugin.gitops?.sourceId === source.id);
        const describePlugin = plugin => ({
            id: plugin.id, name: plugin.metadata.name, version: plugin.metadata.version,
            repository: plugin.gitops.repository, targetRevision: plugin.gitops.targetRevision, commit: plugin.gitops.commit,
            reloaded: affected.includes(plugin.id),
        });
        const updatedPlugins = next.filter(plugin => changedOld.some(previous => previous.id === plugin.id)).map(describePlugin);
        const createdPlugins = next.filter(plugin => !prior.plugins.some(previous => previous.id === plugin.id)).map(describePlugin);
        return {lastSyncedAt: new Date().toISOString(), updatedPlugins, createdPlugins, pendingUpdates, reviewStatuses,
            installedPlugins: installed.map(plugin => ({id: plugin.id, name: plugin.gitops.declaredId, commit: plugin.gitops.commit}))};
    } catch (error) {
        if (transactionState.registryChanged && prior) {
            for (const id of affected) await runtime.unLoadPlugin(id, {force: true, reason: 'gitops_rollback'});
            const current = await registry(registryFile);
            await saveRegistry(registryFile, {...current, plugins: [...current.plugins.filter(plugin => !managedIds.has(plugin.id)),
                ...prior.plugins.filter(plugin => managedIds.has(plugin.id))]});
        }
        for (const id of affected) await runtime.loadPlugin(id).catch(() => {});
        for (const home of newHomes) await rm(home, {recursive: true, force: true}).catch(() => {});
        throw error;
    }
}

export function pendingUpdateSummary(plugin) {
    const pending=plugin.gitops?.pendingUpdate;if(!pending)return null;
    return {name:plugin.gitops.declaredId,pluginId:plugin.id,reviewId:pending.id,
        currentVersion:plugin.metadata.version,version:pending.candidate.metadata.version,
        currentCommit:plugin.gitops.commit,commit:pending.candidate.gitops.commit,
        repository:pending.candidate.gitops.repository,targetRevision:pending.candidate.gitops.targetRevision,
        addedCapabilities:pending.addedCapabilities,removedCapabilities:pending.removedCapabilities,
        requestedCapabilities:pending.candidate.gitops.requestedCapabilities||[],inspectionError:pending.inspectionError||'',createdAt:pending.createdAt};
}

export async function decideGitOpsUpdate({source,sourceId,pluginName,reviewId,decision,capabilities=[],registryFile,pluginsDir,verifySignature,runtime,activatedIds=()=>[]}) {
    if(!['approve','decline','reconsider'].includes(decision)||typeof reviewId!=='string'||!Array.isArray(capabilities)||capabilities.some(value=>typeof value!=='string'))throw new Error('Invalid update review.');
    let data=await registry(registryFile);
    const current=data.plugins.find(plugin=>plugin.gitops?.sourceId===sourceId&&plugin.gitops.declaredId===pluginName);
    if(decision==='reconsider') {
        if(current?.gitops?.declinedUpdate?.commit!==reviewId)throw new Error('This declined version is no longer current. Refresh the repository.');
        commitRegistry(registryFile,fresh=>{const latest=fresh.plugins.find(plugin=>plugin.id===current.id);if(latest?.gitops?.declinedUpdate?.commit!==reviewId)throw new Error('This declined version changed. Refresh GitOps settings.');const {declinedUpdate,...gitops}=latest.gitops;return {...fresh,plugins:fresh.plugins.map(plugin=>plugin.id===current.id?{...latest,gitops}:plugin)};});
        return {state:'checking',plugin:current};
    }
    const pending=current?.gitops.pendingUpdate;
    if(!pending||pending.id!==reviewId||current.home!==pending.baseHome||source&&pending.sourceIdentity!==sourceIdentity(source))throw new Error('This update review is no longer current. Check for updates and review the current candidate.');
    const candidate=pending.candidate;
    if(path.dirname(candidate.home)!==pluginsDir)throw new Error('The staged update is unavailable. Check for updates again.');
    if(decision==='decline') {
        const {pendingUpdate,...gitops}=current.gitops;
        const declined={...current,gitops:{...gitops,declinedUpdate:{commit:candidate.gitops.commit,repository:candidate.gitops.repository,path:candidate.gitops.path}}};
        commitRegistry(registryFile,fresh=>{const latest=fresh.plugins.find(plugin=>plugin.id===current.id);if(latest?.gitops?.pendingUpdate?.id!==reviewId)throw new Error('This review changed. Refresh GitOps settings.');return {...fresh,plugins:fresh.plugins.map(plugin=>plugin.id===current.id?{...declined,capabilities:latest.capabilities,customProcessScopes:latest.customProcessScopes,customFilesystemScopes:latest.customFilesystemScopes}:plugin)};});
        await rm(candidate.home,{recursive:true,force:true});
        return {state:'declined',plugin:current,pending:pendingUpdateSummary(current)};
    }
    if(pending.inspectionError)throw new Error(pending.inspectionError);
    const verified=await verifySignature(candidate.home);
    if(!verified.success||verified.signer?.label!=='root')throw new Error('The staged plugin signature changed or is invalid. Check for updates again before approving.');
    const inspected=inspectGitOpsCapabilities(await readFile(path.join(candidate.home,candidate.entry),'utf8'));
    if(inspected.error||JSON.stringify(inspected.capabilities)!==JSON.stringify(candidate.gitops.requestedCapabilities))throw new Error('The staged capability declaration changed. Check for updates and review it again.');
    data=await registry(registryFile);
    const latest=data.plugins.find(plugin=>plugin.id===current.id);
    const grants=normalizeCapabilityList(latest?.capabilities||[]).sort();
    if(latest?.home!==current.home||latest?.gitops?.pendingUpdate?.id!==reviewId||JSON.stringify(grants)!==JSON.stringify(pending.grantsAtReview))throw new Error('The plugin or its permissions changed during review. Check for updates and review the refreshed permission list.');
    const selected=[...new Set(capabilities)].sort();
    if(JSON.stringify(selected)!==JSON.stringify(pending.addedCapabilities))throw new Error('Explicitly select every listed additional capability before applying this update. No other capability can be granted here.');
    let replacement={...candidate,capabilities:[...new Set([...grants,...selected])],customProcessScopes:latest.customProcessScopes||[],customFilesystemScopes:latest.customFilesystemScopes||[]};
    const active=!!runtime.getLoadedPlugin(current.id)||activatedIds().includes(current.id);
    const transition={changed:false};
    try {
        if(active)await runtime.unLoadPlugin(current.id,{force:true,reason:'gitops_approval'});
        commitRegistry(registryFile,fresh=>{
            const freshPlugin=fresh.plugins.find(plugin=>plugin.id===current.id);
            if(freshPlugin?.gitops?.pendingUpdate?.id!==reviewId||JSON.stringify(normalizeCapabilityList(freshPlugin.capabilities||[]).sort())!==JSON.stringify(grants))throw new Error('Permissions changed while the plugin was stopping. Review this update again.');
            replacement={...replacement,customProcessScopes:freshPlugin.customProcessScopes||[],customFilesystemScopes:freshPlugin.customFilesystemScopes||[]};
            return {...fresh,plugins:fresh.plugins.map(plugin=>plugin.id===current.id?replacement:plugin)};
        });transition.changed=true;
        if(active){const result=await runtime.loadPlugin(current.id);requireApprovedRuntime(result);await waitForRuntime(runtime,current.id);}
        await rm(current.home,{recursive:true,force:true}).catch(()=>{});
        return {state:'synced',plugin:replacement,pending:pendingUpdateSummary(current)};
    }catch(error){
        if(transition.changed){await runtime.unLoadPlugin(current.id,{force:true,reason:'gitops_approval_rollback'});commitRegistry(registryFile,fresh=>({...fresh,plugins:fresh.plugins.map(plugin=>plugin.id===current.id?{...current,capabilities:normalizeCapabilityList(plugin.capabilities||[]).filter(capability=>grants.includes(capability)),customProcessScopes:plugin.customProcessScopes||[],customFilesystemScopes:plugin.customFilesystemScopes||[]}:plugin)}));}
        if(active)await runtime.loadPlugin(current.id).catch(()=>{});
        throw error;
    }
}
