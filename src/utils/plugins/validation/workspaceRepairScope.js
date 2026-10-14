import {sanitizeVirtualWorkspacePath} from '../../../components/editor/utils/aiCodingAgentWorkspacePath';

// An explicit user request constraint, not an instruction inferred from quoted
// diagnostics. The backend still applies ordinary source/budget validation.
export function readWorkspaceRepairScope(prompt, workspaceFiles = []) {
    const firstLine = String(prompt || '').trimStart().split('\n')[0].trim();
    if (!firstLine.startsWith('WORKSPACE_REPAIR_PATHS:')) return undefined;
    let paths;
    try { paths = JSON.parse(firstLine.slice('WORKSPACE_REPAIR_PATHS:'.length)); }
    catch { throw new Error('Invalid WORKSPACE_REPAIR_PATHS: expected a JSON array of existing workspace paths.'); }
    const available = new Set(workspaceFiles.map(file => file.path));
    if (!Array.isArray(paths) || !paths.length || paths.length > 36
        || paths.some(path => typeof path !== 'string' || sanitizeVirtualWorkspacePath(path) !== path || !available.has(path))
        || new Set(paths.map(path => path.toLowerCase())).size !== paths.length) {
        throw new Error('WORKSPACE_REPAIR_PATHS must contain distinct existing workspace paths (1–36). No requests were sent.');
    }
    return paths;
}
