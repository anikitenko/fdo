// Workspace paths are rooted POSIX paths, including in Monaco on Windows.
// A leading double slash would otherwise become a file URI with an authority.
export function normalizeVirtualWorkspacePath(value) {
    const segments = [];
    for (const segment of String(value || '').replace(/\\/g, '/').split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return `/${segments.join('/')}`;
}

export function normalizeVirtualWorkspaceContent(content = {}) {
    const normalized = Object.create(null);
    for (const [rawPath, source] of Object.entries(content)) {
        const filePath = normalizeVirtualWorkspacePath(rawPath);
        if (Object.hasOwn(normalized, filePath) && normalized[filePath] !== source) {
            throw new Error(`Conflicting workspace files resolve to ${filePath}. Rename one of them before building.`);
        }
        normalized[filePath] = source;
    }
    return normalized;
}
