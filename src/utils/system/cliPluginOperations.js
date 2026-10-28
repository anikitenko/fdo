import {withCliLock} from './cliLock';
import fs from 'node:fs';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {inspectGitOpsCapabilities} from '../gitops/inspectCapabilities';
import {randomUUID} from 'node:crypto';
import {getIgnoreInstance} from '../filesystem/getIgnoreInstance';
import {getAllFilesWithIgnorance} from '../filesystem/getAllFilesWithIgnorance';
import {pluginBuildSource, pluginBuildEntrypoint} from '../plugins/runtime/pluginBuildArtifact';
import {normalizeAndValidatePluginMetadata} from '../plugins/runtime/pluginMetadataContract';
import generatePluginName from '../../components/editor/utils/generatePluginName';
import {inspectPluginCompatibility} from '../sdk/pluginCompatibilityHost';
import {assertPluginCompatibility} from '../sdk/pluginCompatibility';

export function requirePluginDirectory(directory) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`Plugin directory does not exist: ${directory}`);
}

export function readCliRegistry(file) {
    if (!fs.existsSync(file)) return {plugins: []};
    const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!registry || !Array.isArray(registry.plugins)) throw new Error(`Invalid plugin registry: ${file}. Repair it before deploying.`);
    return registry;
}

function inside(root, target) {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Resolve existing ancestors too: a symlinked dist directory cannot redirect
// compilation outside the workspace or onto an authored source file.
function outputPath(directory, entry) {
    const root = fs.realpathSync(directory), destination = path.resolve(root, entry);
    let component = root;
    for (const part of path.relative(root, destination).split(path.sep)) {
        component = path.join(component, part);
        if (fs.existsSync(component) && fs.lstatSync(component).isSymbolicLink()) throw new Error('Build output cannot use symlinked files or directories.');
    }
    let ancestor = destination;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!inside(root, fs.realpathSync(ancestor))) throw new Error('Build output must stay inside the plugin directory.');
    return destination;
}

export async function readCliWorkspaceFiles(directory) {
    requirePluginDirectory(directory);
    const ignore = await getIgnoreInstance(directory, []);
    ignore.add(['node_modules/', '.git/']);
    const paths = await getAllFilesWithIgnorance(directory, relative => !ignore.ignores(relative.replace(/\\/g, '/')));
    return Object.fromEntries(paths.map(file => ['/' + path.relative(directory, file).replace(/\\/g, '/'), fs.readFileSync(file, 'utf8')]));
}

async function preparePluginDirectory(directory, {build, extractMetadata}) {
    requirePluginDirectory(directory);
    const manifestPath = path.join(directory, 'package.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing package.json in ${directory}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string' || !generatePluginName(manifest.name)) throw new Error('package.json must contain a non-empty plugin name.');
    const files = await readCliWorkspaceFiles(directory);
    files['/package.json'] = JSON.stringify(manifest);
    const source = pluginBuildSource(files) || 'index.ts';
    if (typeof files['/' + source] !== 'string') throw new Error(`Plugin source is missing or ignored: ${source}`);
    const entryPoint = pluginBuildEntrypoint(files);
    const destination = outputPath(directory, entryPoint);
    const result = await build(files);
    const output = result?.outputFiles?.find(file => !file.path.endsWith('.map'));
    if (typeof output?.text !== 'string') throw new Error('The compiler produced no plugin bundle.');
    // Imported metadata modules are included in the bundle, unlike index.ts alone.
    const metadata = normalizeAndValidatePluginMetadata(await extractMetadata(output.text));
    const compatibility = assertPluginCompatibility(inspectPluginCompatibility(files['/package.json'], output.text));
    return {metadata, entryPoint, name: generatePluginName(manifest.name), destination, source, bundle: output.text, compatibility};
}

export async function validatePluginDirectory(directory, dependencies) {
    const {bundle, ...result} = await preparePluginDirectory(directory, dependencies);
    const inspection = inspectGitOpsCapabilities(bundle);
    if (inspection.error.startsWith('This update requests capabilities')) throw new Error('The plugin declares capabilities this FDO version does not support.');
    return {...result, capabilities: inspection.error ? null : inspection.capabilities,
        warnings: inspection.error ? ['Capability declaration could not be inspected statically. Use a static array or SDK capability helpers with constant arguments; review permissions in Manage Plugins.'] : []};
}

export async function compilePluginDirectory(directory, dependencies) {
    const {bundle, source: _source, ...result} = await preparePluginDirectory(directory, dependencies);
    const {destination, entryPoint} = result;
    // Recheck after asynchronous build in case a directory changed while building.
    outputPath(directory, entryPoint);
    dependencies.beforeWrite?.(destination);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    const temporary = destination + '.' + randomUUID() + '.tmp';
    try {fs.writeFileSync(temporary, bundle, {flag: 'wx'}); fs.renameSync(temporary, destination);}
    finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
    return result;
}

export function assertCliDeployAllowed(file, directory) {
    requirePluginDirectory(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const id = typeof manifest.name === 'string' ? generatePluginName(manifest.name) : '';
    if (readCliRegistry(file).plugins.some(plugin => plugin.id === id && plugin.gitops)) throw new Error('This plugin is managed by GitOps. Update its repository or detach the subscription first.');
}

export function registerCliPlugin(file, directory, compiled) {
    const registry = readCliRegistry(file);
    const existing = registry.plugins.find(plugin => plugin.id === compiled.name);
    if (existing?.gitops) throw new Error('This plugin is managed by GitOps. Update its repository or detach the subscription first.');
    const plugin = {...existing, id: compiled.name, metadata: compiled.metadata, home: directory, entry: compiled.entryPoint,
        capabilities: existing?.capabilities || [], customProcessScopes: existing?.customProcessScopes || [], customFilesystemScopes: existing?.customFilesystemScopes || []};
    const index = registry.plugins.findIndex(item => item.id === plugin.id);
    if (index < 0) registry.plugins.push(plugin); else registry.plugins[index] = plugin;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(registry, null, 4), {flag: 'wx', mode: 0o600});
        fs.renameSync(temporary, file);
    } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
    return plugin;
}

export async function planCliDeployment(directory, label, {registryFile, profile, validate, listCertificates, now = new Date()}) {
    assertCliDeployAllowed(registryFile, directory);
    const plugin = await validate(directory);
    const existing = readCliRegistry(registryFile).plugins.find(item => item.id === plugin.name);
    const certificate = listCertificates().find(item => item.label === label);
    let signer;
    if (!certificate) {
        if (label !== 'root') throw new Error(`Signing certificate not found: ${label}. Create or import it in Settings → Certificates.`);
        signer = {label, status: 'will-create'};
    } else {
        if (!certificate.hasPrivateKey) throw new Error(`Signing certificate ${label} has no private key.`);
        const parsed = new X509Certificate(certificate.cert);
        if (new Date(parsed.validFrom) > now || new Date(parsed.validTo) <= now) throw new Error(`Signing certificate ${label} is outside its validity period.`);
        if (parsed.publicKey.asymmetricKeyType !== 'rsa') throw new Error('Plugin signing requires an RSA private key.');
        signer = {label, id: certificate.id, status: 'existing', expiresAt: new Date(parsed.validTo).toISOString()};
    }
    return {dryRun: true, profile, registryFile, action: existing ? 'update' : 'install', previousVersion: existing?.metadata?.version || null,
        plugin, signer, grants: {capabilities: existing?.capabilities || [], customProcessScopes: existing?.customProcessScopes || [], customFilesystemScopes: existing?.customFilesystemScopes || []},
        warnings: [...plugin.warnings, 'Private key access is not tested by a dry run. Signing and deployment are rechecked when applied.']};
}

// Roll back generated artifacts only. Authored sources and signing identities
// are never deleted. Registration is the final durable step before GUI refresh.
export async function deployCliPluginDirectory(directory, {registryFile, build, extractMetadata, sign, register = registerCliPlugin}) {
    requirePluginDirectory(directory);
    return withCliLock(directory, async () => {
        assertCliDeployAllowed(registryFile, directory);
        const root = fs.realpathSync(directory);
        const snapshots = new Map(), missingDirectories = new Set();
        const remember = file => {
            if (snapshots.has(file)) return;
            let parent = path.dirname(file);
            while (!fs.existsSync(parent) && inside(root, parent)) {missingDirectories.add(parent);parent = path.dirname(parent);}
            let stat;
            try {stat = fs.lstatSync(file);}
            catch (error) {if (error.code !== 'ENOENT') throw error;snapshots.set(file, null);return;}
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Deployment artifact must be a regular file: ${file}`);
            try {snapshots.set(file, {bytes: fs.readFileSync(file), mode: stat.mode & 0o777});}
            catch (error) {if (error.code !== 'ENOENT') throw error;snapshots.set(file, null);}
        };
        for (const file of ['fdo.signature', 'fdo.meta.json', '.fdoignore']) remember(path.join(directory, file));
        try {
            const compiled = await compilePluginDirectory(directory, {build, extractMetadata, beforeWrite: remember});
            await sign(directory);
            await withCliLock(registryFile, () => register(registryFile, directory, compiled));
            return compiled;
        } catch (error) {
            const failures = [];
            for (const [file, original] of snapshots) {
                try {
                    if (original) {
                        const temporary = file + '.' + randomUUID() + '.tmp';
                        try {fs.writeFileSync(temporary, original.bytes, {flag: 'wx', mode: original.mode});fs.chmodSync(temporary, original.mode);fs.renameSync(temporary, file);}
                        finally {fs.rmSync(temporary, {force: true});}
                    } else fs.rmSync(file, {force: true});
                } catch (failure) {failures.push(`${file}: ${failure.message}`);}
            }
            for (const directory of [...missingDirectories].sort((a, b) => b.length - a.length)) {
                try {fs.rmdirSync(directory);} catch (failure) {if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(failure.code)) failures.push(failure.message);}
            }
            if (failures.length) throw new Error(`${error.message}. Rollback needs attention: ${failures.join('; ')}`);
            throw error;
        }
    });
}
