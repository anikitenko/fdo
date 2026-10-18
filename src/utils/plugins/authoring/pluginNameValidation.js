import generatePluginName from '../../../components/editor/utils/generatePluginName';

export const MAX_PLUGIN_NAME_LENGTH = 80;
export function validateNewPluginName(value, {plugins = [], hasSavedWorkspace = () => false} = {}) {
    const name = String(value || '').trim();
    const id = generatePluginName(name);
    const result = (code, message, extra = {}) => ({valid: code === 'available', code, name, id, message, ...extra});
    if (!name) return result('required', 'Enter a plugin name.');
    if ([...name].length > MAX_PLUGIN_NAME_LENGTH) return result('too_long', `Use ${MAX_PLUGIN_NAME_LENGTH} characters or fewer.`);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) {
        return result('invalid_characters', 'Start with a letter or number. Use letters, numbers, spaces, hyphens, underscores or dots.');
    }
    if (!id) return result('empty_id', 'Include at least one English letter or number so FDO can generate a plugin ID.');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) return result('reserved', 'This name is reserved on Windows. Choose another name so the plugin works across platforms.');
    const existingPlugin = plugins.find(plugin => [plugin?.id, plugin?.name, plugin?.metadata?.name]
        .some(candidate => typeof candidate === 'string' && generatePluginName(candidate) === id));
    if (existingPlugin) return result('plugin_exists', 'An installed plugin already uses this name or generated ID. Choose another name to create a new plugin.', {existingPlugin});
    try {
        if (hasSavedWorkspace(id)) return result('workspace_exists', 'A saved workspace already uses this ID. Resume it, or use Safe release ID to archive the draft and start fresh.');
    } catch {
        return result('storage_unavailable', 'Could not check saved workspaces. Allow local storage and try again.');
    }
    return result('available', 'Name is available.');
}
