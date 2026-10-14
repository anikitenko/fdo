import {sanitizeVirtualWorkspacePath} from '../../../components/editor/utils/aiCodingAgentWorkspacePath';

const CODES = new Set(['WORKSPACE_GENERATION_BUDGET_EXHAUSTED', 'WORKSPACE_DEPENDENCY_SPLIT_EXHAUSTED']);

// An explicit transport contract. No source, provider response, credentials, or arbitrary error properties.
export function normalizeCodingFailure(value) {
    if (!value || value.schemaVersion !== '1.0.0' || !CODES.has(value.code)
        || value.stage !== 'file-generation' || value.workspaceChanged !== false
        || typeof value.resumable !== 'boolean' || !Array.isArray(value.recoveryActions)
        || !value.recoveryActions.includes('smaller-scope')) return null;
    if (value.resumable && (typeof value.checkpointId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.checkpointId) || !value.recoveryActions.includes('resume'))) return null;
    const path = sanitizeVirtualWorkspacePath(value.path);
    if (!path || path !== value.path) return null;
    const counts = {};
    for (const key of ['completedFileCount', 'pendingFileCount', 'splitDepth', 'maximumSplitDepth', 'requestedOutputTokens']) {
        if (Number.isSafeInteger(value[key]) && value[key] >= 0) counts[key] = value[key];
    }
    return {schemaVersion: '1.0.0', code: value.code, stage: 'file-generation', path,
        workspaceChanged: false, resumable: value.resumable, ...(value.resumable ? {checkpointId: value.checkpointId} : {}), recoveryActions: value.resumable ? ['resume', 'smaller-scope'] : ['smaller-scope'], ...counts};
}

export function createCodingGenerationFailure(message, details, cause) {
    const error = new Error(message, {cause});
    error.failure = normalizeCodingFailure({schemaVersion: '1.0.0', code: 'WORKSPACE_GENERATION_BUDGET_EXHAUSTED',
        stage: 'file-generation', workspaceChanged: false, resumable: false,
        recoveryActions: ['smaller-scope'], ...details});
    if (!error.failure) throw new TypeError('Invalid generation failure metadata.');
    error.code = error.failure.code;
    return error;
}

export function codingFailureMetadata(error) {
    const seen = new Set();
    for (let current = error; current && typeof current === 'object' && !seen.has(current); current = current.cause) {
        seen.add(current);
        const failure = normalizeCodingFailure(current.failure);
        if (failure) return failure;
    }
    return null;
}
