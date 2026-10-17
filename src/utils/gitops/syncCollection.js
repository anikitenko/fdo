import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {repositoryPath, repositoryUrl, validateCollection} from './manifest';
import {extractMetadata} from '../plugins/runtime/extractMetadata';
import {pluginBuildSource, pluginBuildEntrypoint} from '../plugins/runtime/pluginBuildArtifact';

const BUILD_PIPELINE_VERSION = 2;

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

export async function detachCollection(registryFile, sourceId) {
    const data = await registry(registryFile);
    data.plugins = data.plugins.map(plugin => {
        if (plugin.gitops?.sourceId !== sourceId) return plugin;
        const {gitops, ...local} = plugin;
        return local;
    });
    await saveRegistry(registryFile, data);
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
        const existingSignature = previous?.gitops?.buildPipelineVersion === BUILD_PIPELINE_VERSION && previous.gitops.commit === snapshot.commit && previous.gitops.repository === url && previous.gitops.path === declaration.path
            ? await verifySignature(previous.home) : null;
        if (existingSignature?.success && existingSignature.signer?.label === 'root') {
            prepared.push({...previous, gitops: {...previous.gitops, targetRevision: declaration.targetRevision}});
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
        const signed = await sign(home, 'root');
        if (!signed.success) throw new Error(`Default certificate signing failed: ${signed.error}`);
        const verified = await verifySignature(home);
        if (!verified.success) throw new Error(`Signed plugin verification failed: ${verified.error}`);
        prepared.push({id, metadata, home, entry, capabilities: previous?.capabilities || [],
            customProcessScopes: previous?.customProcessScopes || [], customFilesystemScopes: previous?.customFilesystemScopes || [],
            gitops: {sourceId: source.id, declaredId: declaration.name, repository: url, buildPipelineVersion: BUILD_PIPELINE_VERSION,
                targetRevision: declaration.targetRevision, path: declaration.path, commit: snapshot.commit}});
    };
    const reloadPlugin = async id => {
        const result = await runtime.loadPlugin(id);
        if (!result.success) throw new Error(`Plugin reload failed: ${result.error || id}`);
    };
    try {
        for (const declaration of declarations.filter(plugin => !pruneOnly && (!pluginName || plugin.name === pluginName))) {
            await preparePlugin(declaration);
        }
        // Read fresh data after network/build work so other plugins' edits are retained.
        prior = await registry(registryFile);
        const owned = prior.plugins.filter(plugin => plugin.gitops?.sourceId === source.id &&
            (!pluginName || plugin.gitops.declaredId === pluginName) && (!pruneOnly || !declarations.some(item => item.name === plugin.gitops.declaredId)));
        const next = prepared.map(plugin => {
            const current = prior.plugins.find(item => item.id === plugin.id);
            if (current && current.gitops?.sourceId !== source.id) throw new Error(`Plugin identity is already in use: ${plugin.id}`);
            return current ? {...plugin, capabilities: current.capabilities || [],
                customProcessScopes: current.customProcessScopes || [], customFilesystemScopes: current.customFilesystemScopes || []} : plugin;
        });
        const changedOld = owned.filter(plugin => !next.some(candidate => candidate.id === plugin.id && candidate.home === plugin.home));
        managedIds = new Set([...owned, ...next].map(plugin => plugin.id));
        affected = changedOld.filter(plugin => runtime.getLoadedPlugin(plugin.id) || activatedIds().includes(plugin.id)).map(plugin => plugin.id);
        for (const id of affected) runtime.unLoadPlugin(id, {force: true, reason: 'gitops_sync'});
        await saveRegistry(registryFile, {...prior, plugins: [...prior.plugins.filter(plugin => !managedIds.has(plugin.id)), ...next]});
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
        const installed = (await registry(registryFile)).plugins.filter(plugin => plugin.gitops?.sourceId === source.id);
        const updatedPlugins = next.filter(plugin => changedOld.some(previous => previous.id === plugin.id)).map(plugin => ({
            id: plugin.id, name: plugin.metadata.name, version: plugin.metadata.version,
            repository: plugin.gitops.repository, targetRevision: plugin.gitops.targetRevision, commit: plugin.gitops.commit,
            reloaded: affected.includes(plugin.id),
        }));
        return {lastSyncedAt: new Date().toISOString(), updatedPlugins,
            installedPlugins: installed.map(plugin => ({id: plugin.id, name: plugin.gitops.declaredId, commit: plugin.gitops.commit}))};
    } catch (error) {
        if (transactionState.registryChanged && prior) {
            for (const id of affected) runtime.unLoadPlugin(id, {force: true, reason: 'gitops_rollback'});
            const current = await registry(registryFile);
            await saveRegistry(registryFile, {...current, plugins: [...current.plugins.filter(plugin => !managedIds.has(plugin.id)),
                ...prior.plugins.filter(plugin => managedIds.has(plugin.id))]});
        }
        for (const id of affected) await runtime.loadPlugin(id).catch(() => {});
        for (const home of newHomes) await rm(home, {recursive: true, force: true}).catch(() => {});
        throw error;
    }
}
