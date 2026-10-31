import {sanitizeVirtualWorkspacePath} from './aiCodingAgentWorkspacePath';
import {parseAiSearchReplaceResponse} from './aiCodingAgentSearchReplace';
import {parseAiWorkspacePlanResponse} from './aiCodingAgentPlanResponse';
import {extractAiCodeToApply} from './aiCodingAgentSingleFileApply';

// Explicit actions have stable targets; only Smart Mode interprets the task.
export const AI_CODING_ACTIONS = [
    {value: 'smart', label: 'Smart Mode (Recommended)', description: 'Ask a question or describe a change. FDO chooses a workflow using your request and workspace.'},
    {value: 'generate', label: 'Generate Code', description: 'Generate an implementation for the open file. Without a target file, the result stays a code draft.'},
    {value: 'edit', label: 'Edit Code', description: 'Change the selected code, or the open file when nothing is selected. Returns a targeted patch.'},
    {value: 'explain', label: 'Explain Code', description: 'Answer your question about the selection, open file, or supplied workspace context. Files stay unchanged.'},
    {value: 'fix', label: 'Fix Code', description: 'Repair the selected code or open file using the supplied error and diagnostics. Returns a targeted patch.'},
    {value: 'plan', label: 'Plan Code (Plugin Scaffold)', description: 'Create or extend a plugin with complete workspace files and SDK validation.'},
];

export function allowsWorkspaceIntent(action) {
    return action === 'smart' || action === 'plan';
}

export function resolveFileActionTarget({action, selectedCode = '', currentFilePath = '', currentFileContent = ''} = {}) {
    const fileAction = ['edit', 'fix', 'explain'].includes(action);
    const path = /^\/(?:node_modules|dist)(?:\/|$)/.test(currentFilePath) ? null : sanitizeVirtualWorkspacePath(currentFilePath);
    const content = String(currentFileContent || '');
    const hasSelection = !!String(selectedCode || '').trim();
    const code = fileAction ? (hasSelection ? selectedCode : path ? content : '') : selectedCode;
    const requiresTarget = action === 'edit' || action === 'fix';
    return {code, path: path || '', content, hasSelection,
        scope: hasSelection ? 'selection' : path && content ? 'file' : 'workspace',
        error: requiresTarget && (!path || !String(code).trim())
            ? 'Open a nonempty plugin file to edit or fix it. Select a block to narrow the change. Use Smart Mode or Review workspace for a broader task.' : '',
    };
}

export function actionOutcome({action, target, autoApply = false} = {}) {
    if (action === 'explain') return 'Expected result: explanation. Your files stay unchanged.';
    if (action === 'generate' && !target?.path) return 'The code will stay a draft. Open a plugin file to apply generated code, or use Plan Code to create workspace files.';
    if (target?.error && ['edit', 'fix'].includes(action)) return target.error;
    const scope = ['generate', 'edit', 'fix'].includes(action) && target?.path
        ? `${target.hasSelection ? 'Selected code in' : 'Open file'} ${target.path}. ` : '';
    return scope + (autoApply ? 'Requested changes will be applied with a restore point.' : 'Proposed changes will wait for your review and Apply.');
}

export function fileActionScopeError({requestedAction, targetFilePath, content} = {}) {
    if (!['generate', 'edit', 'fix'].includes(requestedAction) || !targetFilePath) return '';
    const patches = parseAiSearchReplaceResponse(content);
    const plan = parseAiWorkspacePlanResponse(content);
    const paths = [...patches.invalidPaths, ...plan.invalidPaths, ...patches.blocks.map(block => block.filePath), ...plan.files.map(file => file.path)].filter(Boolean);
    return paths.some(path => path !== targetFilePath)
        ? `This response changes files outside ${targetFilePath}. No changes were applied. Use Smart Mode or Plan Code for a workspace change.` : '';
}

export function codingResponseKind(content = '') {
    if (parseAiSearchReplaceResponse(content).blocks.length || parseAiWorkspacePlanResponse(content).files.length) return 'changes';
    const markers = [...String(content).matchAll(/^\s*\/\/\s*SOLUTION READY TO APPLY\s*$/gm)];
    if (markers.length) return markers.length === 1 ? 'changes' : 'ambiguous';
    const extracted = extractAiCodeToApply(content);
    if (extracted.blocksFound > 1) return 'ambiguous';
    return extracted.blocksFound === 1 ? 'changes' : 'answer';
}
