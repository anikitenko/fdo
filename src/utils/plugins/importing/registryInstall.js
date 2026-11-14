import {withCliLock} from '../../system/cliLock';
import semver from 'semver';
import {registryNetworkError} from '../../system/registryNetworkError';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import configuration from '../../../config/officialRegistry.json';
import {officialRegistry} from '../../system/officialRegistry';
import {inspectReleaseArchive} from '../publishing/registryPolicy/release-archive';
import {MAX_ARCHIVE_BYTES} from '../publishing/registryPolicy/source-archive';
import {verifyRegistryPluginDirectory} from '../../system/registryPluginVerification';
import {inspectSourcePluginCompatibility} from '../../sdk/pluginCompatibilityHost';
import {assertPluginCompatibility} from '../../sdk/pluginCompatibility';

export async function downloadRegistryArchive(release, fetchArchive = fetch) {
    if (!/^[a-f0-9]{64}$/.test(release.packageSha256)) throw new Error('Registry release has no verified archive digest.');
    const base = new URL(configuration.certificateUrl);
    const url = new URL(`/packages/${encodeURIComponent(release.pluginId)}/${encodeURIComponent(release.version)}/${release.packageSha256}.zip`, base);
    let response;
    try {response = await fetchArchive(url.href, {redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000)});}
    catch (error) {throw registryNetworkError(error, url.href);}
    if (!response.ok) {
        await response.body?.cancel?.();
        throw new Error(`Registry archive download failed (${response.status}). Only signed FDO ZIP releases can be installed.`);
    }
    const chunks = [];
    let size = 0, complete = false;
    try {
        if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) throw new Error('Registry archive exceeds 10 MiB.');
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_ARCHIVE_BYTES) throw new Error('Registry archive exceeds 10 MiB.');
            chunks.push(Buffer.from(chunk));
        }
        complete = true;
    } finally {if (!complete) await response.body?.cancel?.().catch(() => {});}
    const bytes = Buffer.concat(chunks);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== release.packageSha256) throw new Error('Registry archive digest does not match the verified release.');
    return bytes;
}

// All source inspection is inert. No plugin code, dependency installers or
// package lifecycle scripts run during download, review or installation.
export async function installRegistryRelease(release, options) {
    return withCliLock(options.store.file, () => installRegistryReleaseUnlocked(release, options));
}

async function installRegistryReleaseUnlocked({id, version}, {pluginsDir, store, confirm, normalizeMetadata, build, onProgress = () => {},
    runtime, isActivated = () => false, setActivated = async () => {},
    registryService = officialRegistry, download = downloadRegistryArchive, inspect = inspectReleaseArchive,
    verify = verifyRegistryPluginDirectory}) {
    const origin = new URL(configuration.certificateUrl).origin;
    const sameSource = plugin => plugin?.registry?.origin === origin && plugin.registry.pluginId === id;
    const localIdFor = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80 && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)
        ? value : `registry-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`;
    const owned = store.all().filter(sameSource);
    if (owned.length > 1) throw new Error('Multiple installations claim this registry plugin. Resolve them in Manage Plugins first.');
    const localId = owned[0]?.id || localIdFor(id);
    let previous = store.get(localId);
    let previousVersion = previous?.registry?.version;
    if (previous?.gitops) throw Object.assign(new Error('This plugin is managed by GitOps. Registry installation cannot replace it.'), {code: 'REGISTRY_SOURCE_CONFLICT'});
    onProgress({phase: 'checking'});
    let resolvingName = true;
    const displayName = registryService.releaseDisplayName
        ? registryService.releaseDisplayName(id, version).then(name => {
            if (resolvingName && name) onProgress({name});
            return name;
        }).catch(() => null) : Promise.resolve(null);
    let release, name;
    try {[release, name] = await Promise.all([registryService.releaseStatus(id, version), displayName]);}
    finally {resolvingName = false;}
    if (!release.signingMetadata || !release.signature) throw new Error('This release does not use supported FDO source signing.');
    if (previous && !sameSource(previous)) {
        // Adopt installations created before provenance was recorded only after
        // verifying their signed source against this exact official registry.
        if (previous.gitops || previous.registry) throw Object.assign(new Error('This ID belongs to a plugin from another source. Registry installation will not replace it.'), {code: 'REGISTRY_SOURCE_CONFLICT'});
        let adopted = null;
        try {
            const metadata = JSON.parse(await fs.readFile(path.join(previous.home, 'fdo.meta.json'), 'utf8'));
            const signature = await fs.readFile(path.join(previous.home, 'fdo.signature'));
            const checked = await verify(previous.home, metadata, signature, registryService);
            if (checked.success && checked.identity?.pluginId === id) adopted = checked.identity.version;
        } catch {adopted = null;}
        if (adopted === null) throw Object.assign(new Error('This ID belongs to a local plugin. Registry installation will not overwrite it. Remove or rename the local plugin first.'), {code: 'REGISTRY_SOURCE_CONFLICT'});
        previousVersion = adopted;
    }
    if (previous && !semver.valid(previousVersion)) throw new Error('The installed registry version is invalid. Review it in Manage Plugins.');
    let action = !previous ? 'install' : semver.gt(version, previousVersion) ? 'update' : semver.lt(version, previousVersion) ? 'downgrade' : 'repair';
    if (previous && previousVersion === version) {
        // An intact same-version install is a successful no-op. Modified files
        // take the explicit repair path; they are never silently replaced.
        try {
            const checked = await verify(previous.home, JSON.parse(await fs.readFile(path.join(previous.home, 'fdo.meta.json'), 'utf8')),
                await fs.readFile(path.join(previous.home, 'fdo.signature')), registryService);
            if (checked.success && checked.identity?.pluginId === id && checked.identity.version === version) {
                if (!sameSource(previous)) {
                    store.commit(localId, previous, {...previous, registry: {origin, pluginId: id, version,
                        packageSha256: release.packageSha256, signerFingerprint: release.signerFingerprint,
                        installedAt: new Date().toISOString(), updatedAt: new Date().toISOString()}});
                }
                onProgress({name: previous.metadata?.name || name, action: 'already-installed', installedVersion: version});
                return {success: true, id: localId, action: 'already-installed', version};
            }
        } catch (error) {if (error.code && !['ENOENT', 'EISDIR'].includes(error.code)) throw error;}
    }
    onProgress({phase: 'downloading', name, action, installedVersion: previousVersion || null});
    const bytes = await download(release);
    onProgress({phase: 'verifying'});
    const archive = await inspect(bytes);
    if (!archive.embeddedSigning || !archive.proposal || archive.proposal.pluginId !== id || archive.proposal.metadata.version !== version)
        throw new Error('Archive identity does not match the requested registry release.');
    onProgress({phase: 'verifying', name: archive.proposal.metadata.name});
    const files = new Map(archive.files);
    files.set('fdo.meta.json', JSON.stringify(archive.embeddedSigning.metadata));
    files.set('fdo.signature', Buffer.from(archive.embeddedSigning.signature, 'base64'));
    await fs.mkdir(pluginsDir, {recursive: true, mode: 0o700});
    const temporary = await fs.mkdtemp(path.join(pluginsDir, '.registry-'));
    const destination = path.join(pluginsDir, crypto.randomUUID());
    let committed = false;
    try {
        for (const [name, contents] of files) {
            const target = path.join(temporary, name);
            await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
            await fs.writeFile(target, contents, {mode: 0o600, flag: 'wx'});
        }
        await verify(temporary, archive.embeddedSigning.metadata, Buffer.from(archive.embeddedSigning.signature, 'base64'), registryService);
        const pkg = JSON.parse(files.get('package.json'));
        assertPluginCompatibility(inspectSourcePluginCompatibility(JSON.stringify(pkg)));
        const metadata = normalizeMetadata(archive.proposal.metadata);
        const granted = (previous?.capabilities || []).filter(capability => archive.proposal.capabilities.includes(capability));
        const newCapabilities = archive.proposal.capabilities.filter(capability => !(previous?.capabilities || []).includes(capability));
        const needsCapabilityReview = !!previous && newCapabilities.length > 0;
        onProgress({phase: 'approval', action, installedVersion: previousVersion || null, needsCapabilityReview});
        if (!await confirm({id, version, metadata, capabilities: archive.proposal.capabilities, action,
            installedVersion: previousVersion || null, needsCapabilityReview, newCapabilities})) return {cancelled: true};
        onProgress({phase: 'building'});
        const virtual = Object.fromEntries([...archive.files].map(([name, contents]) => ['/' + name, contents]));
        const output = await build(virtual);
        const artifact = output.outputFiles?.find(file => !file.path.endsWith('.map'));
        if (!artifact?.text) throw new Error('The registry source did not produce a runtime bundle.');
        await fs.mkdir(path.join(temporary, 'dist'), {mode: 0o700});
        await fs.writeFile(path.join(temporary, 'dist/index.cjs'), artifact.text, {mode: 0o600, flag: 'wx'});
        onProgress({phase: 'rechecking'});
        // Recheck online after the review dialog; a release can be revoked while open.
        await verify(temporary, archive.embeddedSigning.metadata, Buffer.from(archive.embeddedSigning.signature, 'base64'), registryService);
        onProgress({phase: 'installing'});
        if (JSON.stringify(store.get(localId)) !== JSON.stringify(previous)) throw new Error('This plugin changed while the installation was open. Try again.');
        await fs.rename(temporary, destination);
        const now = new Date().toISOString();
        const candidate = {...previous, id: localId, metadata, home: destination, entry: 'dist/index.cjs',
            capabilities: granted, customProcessScopes: previous?.customProcessScopes || [], customFilesystemScopes: previous?.customFilesystemScopes || [],
            registry: {origin, pluginId: id, version, packageSha256: release.packageSha256, signerFingerprint: release.signerFingerprint,
                installedAt: previous?.registry?.installedAt || now, updatedAt: now, needsCapabilityReview, declaredCapabilities: archive.proposal.capabilities}};
        const wasRunning = !!runtime?.getLoadedPlugin(localId), wasActivated = !!previous && isActivated(localId);
        const restart = async () => {
            const result = await runtime.loadPlugin(localId);
            if (!result?.success) throw new Error(result?.error || 'The updated plugin could not start.');
            if (runtime.getLoadedPluginReady) {
                const deadline = Date.now() + 15000;
                while (!runtime.getLoadedPluginReady(localId)) {
                    if (!runtime.getLoadedPlugin(localId) || Date.now() > deadline) throw new Error('The updated plugin did not become ready.');
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        };
        let replaced = false;
        if (runtime?.loadingPlugins?.[localId]) throw new Error('The plugin is still starting. Wait for it to finish before changing releases.');
        try {
            if (wasRunning) {
                await runtime.unLoadPlugin(localId, {force: true, reason: 'registry_install'});
                await runtime.drainingPlugins?.[localId];
            }
            if ((!previous && isActivated(localId)) || (needsCapabilityReview && wasActivated)) await setActivated(localId, false);
            store.commit(localId, previous, candidate);
            committed = replaced = true;
            if (!needsCapabilityReview && previous && (wasRunning || wasActivated) && runtime) {
                onProgress({phase: 'restarting'});
                await restart();
            }
        } catch (error) {
            if (replaced) {
                if (runtime?.getLoadedPlugin(localId)) await runtime.unLoadPlugin(localId, {force: true, reason: 'registry_rollback'});
                try {store.commit(localId, candidate, previous); committed = false;}
                catch {throw new Error('The plugin changed after installation. Its installed files were retained; review its status in Manage Plugins.', {cause: error});}
            }
            if (wasActivated && needsCapabilityReview) await setActivated(localId, true);
            if (wasRunning && previous && runtime && JSON.stringify(store.get(localId)) === JSON.stringify(previous)) await restart().catch(() => {});
            if (replaced && previous) throw Object.assign(new Error(`The new release could not start. The previous installation was restored. ${error.message}`, {cause: error}), {code: 'REGISTRY_UPDATE_ROLLED_BACK'});
            throw error;
        }
        if (previous?.home && path.dirname(previous.home) === path.resolve(pluginsDir) && previous.home !== destination && !store.all().some(plugin => plugin.home === previous.home))
            await fs.rm(previous.home, {recursive: true, force: true}).catch(() => {});
        return {success: true, id: localId, action, version, needsCapabilityReview,
            active: !!previous && !needsCapabilityReview && (wasRunning || wasActivated)};
    } finally {
        await fs.rm(temporary, {recursive: true, force: true});
        if (!committed) await fs.rm(destination, {recursive: true, force: true});
    }
}
