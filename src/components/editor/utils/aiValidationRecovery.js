import {getValidationRepairPaths} from './aiCodingAgentPlanRepair';

export const validationWorkspaceKey = files => JSON.stringify(files.map(({path, content}) => ({path, content})).sort((a, b) => a.path.localeCompare(b.path)));

export function retainValidationRecovery({previous, files, workspaceFiles, diagnostics, originalPrompt, workspace, revision, repairScope}) {
    const candidate = [...new Map([...workspaceFiles, ...files].map(file => [file.path, file])).values()];
    const paths = getValidationRepairPaths(diagnostics, candidate);
    if (!paths.length) return null;
    const baseline = validationWorkspaceKey(workspaceFiles);
    return {files, candidate, diagnostics: [...diagnostics], paths, originalPrompt, workspace, revision, baseline, repairScope,
        attempts: previous?.baseline === baseline && previous.workspace === workspace && previous.revision === revision ? previous.attempts : 0};
}

export function assertValidationRecoveryCurrent(recovery, {files, workspace, revision}) {
    if (recovery.workspace !== workspace || recovery.revision !== revision || recovery.baseline !== validationWorkspaceKey(files)) {
        throw new Error('The workspace changed since this proposal failed validation. Review the current workspace before starting another repair; the retained proposal was not applied.');
    }
    if (recovery.repairScope && recovery.paths.some(path => !recovery.repairScope.includes(path))) {
        throw new Error('Validation needs changes outside the original repair scope. Start a new request authorizing the affected files; the retained proposal was not applied.');
    }
}
