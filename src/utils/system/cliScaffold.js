import fs from 'node:fs';
import path from 'node:path';
import {createPluginTemplateFiles} from '../../components/editor/utils/virtualTemplates';
import {PLUGIN_TEMPLATES} from '../plugins/authoring/pluginTemplateCatalog';
import generatePluginName from '../../components/editor/utils/generatePluginName';

function existingDirectoryMode(target) {
    let stat;
    try {stat = fs.lstatSync(target);}
    catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(target).length) throw new Error(`Destination must be a new or empty directory: ${target}`);
    return stat.mode & 0o777;
}

function writeScaffold(files, staging, target, previousMode, state) {
    for (const [virtual, content] of Object.entries(files)) {
        const relative = virtual.replace(/^\//, '');
        const destination = path.resolve(staging, relative);
        if (!destination.startsWith(staging + path.sep)) throw new Error('Invalid template file path.');
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.writeFileSync(destination, content, {flag: 'wx'});
    }
    fs.chmodSync(staging, previousMode ?? 0o755);
    if (previousMode !== undefined) {
        // rmdir refuses a directory populated since the initial check.
        const stat = fs.lstatSync(target);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Destination changed during initialization.');
        fs.rmdirSync(target);
        state.removedEmptyTarget = true;
    } else if (fs.existsSync(target)) throw new Error('Destination appeared during initialization.');
    fs.renameSync(staging, target);
}

export function scaffoldCliPlugin(directory, {name, displayName, template = 'blank'} = {}) {
    const target = path.resolve(directory);
    const id = name ?? generatePluginName(path.basename(target));
    if (typeof id !== 'string' || id.length > 214 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Plugin name must be lowercase letters/digits separated by hyphens. Use --name <plugin-id>.');
    const title = displayName ?? id;
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('Display name must contain 1–120 characters without control characters.');
    if (!PLUGIN_TEMPLATES.some(item => item.value === template)) throw new Error(`Unknown template: ${template}. Choose ${PLUGIN_TEMPLATES.map(item => item.value).join(', ')}.`);
    const previousMode = existingDirectoryMode(target);
    const files = createPluginTemplateFiles({name: id, displayName: title.trim(), template});
    fs.mkdirSync(path.dirname(target), {recursive: true});
    const staging = fs.mkdtempSync(path.join(path.dirname(target), '.fdo-init-'));
    const state = {removedEmptyTarget: false};
    try {
        writeScaffold(files, staging, target, previousMode, state);
        return {name: id, displayName: title.trim(), template, directory: target, files: Object.keys(files).map(file => file.slice(1)).sort()};
    } catch (error) {
        if (state.removedEmptyTarget && !fs.existsSync(target)) fs.mkdirSync(target, {mode: previousMode});
        throw error;
    } finally {fs.rmSync(staging, {recursive: true, force: true});}
}
