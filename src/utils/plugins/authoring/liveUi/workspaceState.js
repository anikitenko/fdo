export function pickLiveUiSources(files = {}) {
    return Object.fromEntries(Object.entries(files).filter(([file, content]) =>
        /^\/(?!node_modules\/|dist\/).+\.(?:[cm]?[jt]sx?|css|json)$/.test(file) && !file.includes('\\') &&
        !file.slice(1).split('/').some(segment => !segment || segment === '.' || segment === '..') &&
        typeof content === 'string' && !file.endsWith('.d.ts')
    ).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function liveUiWorkspacePayload(workspace) {
    // Do not materialize thousands of dependency Monaco models on each refresh.
    const eligible = pickLiveUiSources(Object.fromEntries(Object.keys(workspace.files).map(file => [file, ''])));
    const files = Object.fromEntries(Object.keys(eligible).map(file => {
        const entry = workspace.files[file];
        const model = entry.model;
        return [file, model && !model.isDisposed?.() ? model.getValue() : entry.content || ''];
    }));
    return {workspaceId: workspace.sandboxName, name: workspace.pluginName,
        snapshot: String(workspace.fs.version()?.version ?? ''),
        files};
}
