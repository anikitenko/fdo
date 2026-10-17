// Capture the current workspace identity before an asynchronous build or test run.
export async function workspaceNotificationName(workspace) {
    try {
        const metadata = await workspace.build.getMetadata();
        if (typeof metadata?.name === 'string' && metadata.name.trim()) return metadata.name.trim();
    } catch { /* Incomplete source still needs an identifiable failure notification. */ }
    try {
        const pkg = JSON.parse(workspace.getLatestContent()['/package.json']);
        if (typeof pkg.name === 'string' && pkg.name.trim()) return pkg.name.trim();
    } catch { /* A new workspace may not have a valid package yet. */ }
    return workspace.pluginName?.trim() || 'Untitled plugin';
}
