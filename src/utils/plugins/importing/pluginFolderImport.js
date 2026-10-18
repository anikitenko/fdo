import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, lstat, writeFile, rm, rename} from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import {isUtf8} from 'node:buffer';
import {Script} from 'node:vm';
import {extractMetadata} from '../runtime/extractMetadata';
import {pluginBuildSource, pluginBuildEntrypoint} from '../runtime/pluginBuildArtifact';
import generatePluginName from '../../../components/editor/utils/generatePluginName';

function relativeFile(value, field) {
    if (typeof value !== 'string' || !value || /[\\\0:]/.test(value) || path.posix.isAbsolute(value) || value.split('/').includes('..')) throw new Error(`${field} must name a file inside the selected folder.`);
    return value.replace(/^\.\//, '');
}
export async function inspectPluginFolder(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !(await lstat(directory)).isDirectory()) throw new Error('Select a plugin project folder.');
    const readControlFile = async name => {
        const file = path.join(directory, name), info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error(`${name} must be a regular file smaller than 1 MB.`);
        const content = await readFile(file);
        if (content.length > 1024 * 1024) throw new Error(`${name} grew beyond the 1 MB limit.`);
        return content.toString('utf8');
    };
    const pkg = JSON.parse(await readControlFile('package.json'));
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must contain a JSON object.');
    if (pkg.source !== undefined) relativeFile(pkg.source, 'Package source');
    const ig = ignore();
    try {ig.add(await readControlFile('.fdoignore'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
    const files = [], virtual = {};
    let bytes = 0, directories = 0;
    const walk = async relative => {
        if (++directories > 5000 || relative.split('/').length > 32) throw new Error('The folder has too many nested directories. Exclude caches and dependencies.');
        for (const entry of await readdir(path.join(directory, relative), {withFileTypes: true})) {
            const name = relative ? relative + '/' + entry.name : entry.name;
            if (['.git', 'node_modules', '.svn', '.hg'].includes(entry.name) || /^\.env(?:\.|$)/.test(entry.name)) continue;
            if (ig.ignores(name)) continue;
            const file = path.join(directory, name), info = await lstat(file);
            if (info.isSymbolicLink()) throw new Error(`Symbolic links are not imported: ${name}. Copy the actual file into the project.`);
            if (info.isDirectory()) {await walk(name); continue;}
            if (!info.isFile()) throw new Error(`Unsupported file type: ${name}.`);
            if (files.length >= 2000 || info.size > 8 * 1024 * 1024 || bytes + info.size > 32 * 1024 * 1024) throw new Error('Plugin folders are limited to 2,000 files, 8 MB per file and 32 MB total. Exclude build caches and dependencies.');
            const content = await readFile(file);
            bytes += content.length;
            if (content.length > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024) throw new Error('The plugin folder grew beyond the import size limit.');
            files.push({path: name, content});
            if (isUtf8(content) && !content.includes(0)) virtual['/' + name] = content.toString('utf8');
        }
    };
    await walk('');
    if (!virtual['/package.json']) throw new Error('package.json must not be excluded by .fdoignore.');
    let sourceEntry = pluginBuildSource(virtual);
    if (!sourceEntry) sourceEntry = ['src/index.ts', 'src/index.tsx', 'index.js', 'src/index.js'].find(file => virtual['/' + file]) || null;
    if (sourceEntry && !virtual['/' + sourceEntry]) throw new Error(`Source entry "${sourceEntry}" is missing or excluded by .fdoignore.`);
    const runtimeEntry = pkg.main || pkg.module ? relativeFile(pkg.main || pkg.module, 'Package runtime entry') : 'dist/index.cjs';
    const signed = files.some(file => file.path === 'fdo.signature');
    const hasCompiled = files.some(file => file.path === runtimeEntry) && /\.(?:cjs|js)$/.test(runtimeEntry)
        && !(pkg.type === 'module' && !runtimeEntry.endsWith('.cjs')) && (runtimeEntry !== sourceEntry || signed);
    if (signed && runtimeEntry === sourceEntry) sourceEntry = null;
    if (!sourceEntry && !hasCompiled) throw new Error('No source entry or compatible compiled runtime was found. Set package.json source to your source file, or main to an existing CommonJS .cjs/.js bundle.');
    let bundleError = '';
    if (hasCompiled) {
        if (!virtual['/' + runtimeEntry]) {
            bundleError = `Runtime ${runtimeEntry} is not valid CommonJS: The runtime must be UTF-8 JavaScript. Rebuild from source or select a corrected bundle.`;
        } else try {
            // Parse as CommonJS without executing plugin code. An invalid bundle
            // can still be rebuilt when the folder contains usable source.
            new Script(`(function(exports, require, module, __filename, __dirname) {\n${virtual['/' + runtimeEntry].replace(/^#![^\r\n]*/, '')}\n})`);
        } catch (error) {bundleError = `Runtime ${runtimeEntry} is not valid CommonJS: ${error.message}. Rebuild from source or select a corrected bundle.`;}
    }
    const fallbackMetadata = {name: pkg.fdo?.displayName || pkg.name, version: pkg.version, author: typeof pkg.author === 'object' ? pkg.author?.name : pkg.author,
        description: pkg.description, icon: pkg.fdo?.icon || 'application'};
    const sourceMetadata = sourceEntry ? await extractMetadata(virtual['/' + sourceEntry]) || fallbackMetadata : null;
    const metadata = hasCompiled ? await extractMetadata(virtual['/' + runtimeEntry] || '') || fallbackMetadata : sourceMetadata;
    return {files, virtual, sourceEntry, runtimeEntry, hasCompiled, signed, bundleError, metadata, sourceMetadata, bytes,
        proposedId: generatePluginName([metadata.name, pkg.name, path.basename(directory)].find(value => typeof value === 'string' && value) || 'imported-plugin')};
}

export async function installPluginFolder(snapshot, {id, mode, pluginsDir, registry, build, normalizeMetadata, sign, verify}) {
    if (typeof id !== 'string' || id.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) throw new Error('Choose a valid plugin ID.');
    const getRegistry = typeof registry === 'function' ? registry : () => registry;
    if (getRegistry().isInstalled(id)) throw new Error('This plugin ID is already installed. Import with a different ID; existing plugins are never overwritten.');
    if (!['bundle', 'build'].includes(mode) || mode === 'bundle' && !snapshot.hasCompiled || mode === 'build' && !snapshot.sourceEntry) throw new Error('The selected import mode is unavailable for this folder.');
    if (mode === 'bundle' && snapshot.bundleError) throw new Error(snapshot.bundleError);
    const metadata = normalizeMetadata(mode === 'build' ? snapshot.sourceMetadata : snapshot.metadata);
    const temporary = path.join(pluginsDir, '.import-' + randomUUID()), destination = path.join(pluginsDir, randomUUID());
    let committed = false;
    try {
        await mkdir(temporary, {recursive: true, mode: 0o700});
        for (const file of snapshot.files) {
            const target = path.join(temporary, relativeFile(file.path, 'Imported file'));
            await mkdir(path.dirname(target), {recursive: true});
            await writeFile(target, file.content, {mode: 0o600});
        }
        let entry = snapshot.runtimeEntry;
        if (mode === 'build') {
            const virtual = {...snapshot.virtual};
            const pkg = JSON.parse(virtual['/package.json']);
            pkg.source = snapshot.sourceEntry;
            virtual['/package.json'] = JSON.stringify(pkg, null, 2);
            await writeFile(path.join(temporary, 'package.json'), virtual['/package.json']);
            const output = await build(virtual);
            const artifact = output.outputFiles?.find(file => !file.path.endsWith('.map'));
            if (!artifact?.text) throw new Error('The build did not produce a compiled plugin. Review source imports and dependencies.');
            entry = pluginBuildEntrypoint(virtual);
            await mkdir(path.dirname(path.join(temporary, entry)), {recursive: true});
            await writeFile(path.join(temporary, entry), artifact.text);
            pkg.main = entry;
            await writeFile(path.join(temporary, 'package.json'), JSON.stringify(pkg, null, 2));
            const signed = await sign(temporary, 'root');
            if (!signed.success) throw new Error('Could not sign the source build with the default certificate: ' + signed.error + '. Review Settings → Certificates.');
        }
        if (mode === 'build' || snapshot.signed) {
            const result = await verify(temporary);
            if (!result.success) throw new Error('Plugin signature verification failed: ' + result.error);
        }
        if (getRegistry().isInstalled(id)) throw new Error('Another import installed this ID. Select a different ID.');
        await rename(temporary, destination);
        const currentRegistry = getRegistry();
        if (currentRegistry.isInstalled(id)) throw new Error('Another install now owns this ID. No files were overwritten.');
        currentRegistry.addPlugin(id, metadata, destination, entry, false, []);
        committed = true;
        return {success: true, id, entrypoint: entry, built: mode === 'build'};
    } finally {
        await rm(temporary, {recursive: true, force: true});
        if (!committed) await rm(destination, {recursive: true, force: true});
    }
}
