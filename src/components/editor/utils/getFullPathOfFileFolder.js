import {normalizeVirtualWorkspacePath} from '../../../utils/plugins/virtualWorkspacePaths';

export const getFullPathOfFileFolder = (path, type, same = false) => {
    const normalized = normalizeVirtualWorkspacePath(path);
    if (type === 'folder' && !same) return normalized === '/' ? '/' : `${normalized}/`;
    return normalized.slice(0, normalized.lastIndexOf('/') + 1);
};
