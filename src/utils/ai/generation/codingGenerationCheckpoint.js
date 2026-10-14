import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sanitizeVirtualWorkspacePath} from '../../../components/editor/utils/aiCodingAgentWorkspacePath';

export const generationImageFingerprint = image => image ? createHash('sha256').update(JSON.stringify(image)).digest('hex') : '';

export const workspaceGenerationFingerprint = files => createHash('sha256').update(JSON.stringify(
    (files || []).map(({path, content}) => ({path, content})).sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');

export function createGenerationCheckpointStore(directory) {
    const filename = workspaceId => {
        if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId.length > 500) throw new Error('A plugin workspace identity is required.');
        return path.join(directory, createHash('sha256').update(workspaceId).digest('hex') + '.json');
    };
    const validate = value => {
        if (value?.schemaVersion !== '1.0.0' || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
            || typeof value.prompt !== 'string' || typeof value.requirements !== 'string'
            || typeof value.baseline !== 'string' || typeof value.sdkFingerprint !== 'string'
            || !Array.isArray(value.completed) || !Array.isArray(value.pending) || !Array.isArray(value.plan)
            || value.completed.length + value.pending.length > 36) throw new Error('Invalid generation checkpoint. Discard it and start a new attempt.');
        const unique = new Set();
        for (const file of [...value.completed, ...value.pending]) {
            if (typeof file.path !== 'string' || sanitizeVirtualWorkspacePath(file.path) !== file.path || unique.has(file.path.toLowerCase())) throw new Error('Invalid checkpoint file plan.');
            unique.add(file.path.toLowerCase());
            if (typeof file.contract !== 'string') throw new Error('Missing checkpoint file contract.');
        }
        if (value.reuseCandidates && (!Array.isArray(value.reuseCandidates) || value.reuseCandidates.length > 36 || value.reuseCandidates.some(file => typeof file.path !== 'string' || sanitizeVirtualWorkspacePath(file.path) !== file.path || typeof file.contract !== 'string' || typeof file.content !== 'string' || file.content.length > 120000))) throw new Error('Invalid checkpoint helper candidates.');
        if (value.completed.some(file => typeof file.content !== 'string' || file.content.length > 120000)) throw new Error('Invalid checkpoint source.');
        return value;
    };
    return {
        create: ({workspaceId, workspaceFiles, prompt, requirements, sdkFingerprint, image}) => ({schemaVersion: '1.0.0', id: randomUUID(), workspaceId,
            baseline: workspaceGenerationFingerprint(workspaceFiles), imageFingerprint: generationImageFingerprint(image), prompt, requirements, sdkFingerprint, completed: [], pending: [], plan: [], updatedAt: new Date().toISOString()}),
        async save(value) {
            validate(value);
            const file = filename(value.workspaceId);
            await fs.mkdir(directory, {recursive: true, mode: 0o700});
            const temporary = `${file}.${randomUUID()}.tmp`;
            try { const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) throw new Error('Checkpoint exceeds its storage limit.'); const handle = await fs.open(temporary, 'wx', 0o600); try {await handle.writeFile(serialized); await handle.sync();} finally {await handle.close();} await fs.rename(temporary, file); }
            finally { await fs.unlink(temporary).catch(() => {}); }
        },
        async load(workspaceId) {
            try {
                const file = filename(workspaceId);
                if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('Checkpoint exceeds its storage limit.');
                const value = validate(JSON.parse(await fs.readFile(file, 'utf8')));
                if (value.workspaceId !== workspaceId) throw new Error('Checkpoint workspace does not match.');
                return value;
            } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        },
        async discard(workspaceId, id) {
            let value;
            try {value = await this.load(workspaceId);} catch (error) {
                if (id !== null) throw error;
                await fs.unlink(filename(workspaceId)); return;
            }
            if (value && value.id !== id) throw new Error('The saved checkpoint changed. Refresh before discarding.');
            if (value) await fs.unlink(filename(workspaceId));
        },
    };
}

export function generationCheckpointSummary(value, workspaceFiles, sdkFingerprint) {
    if (!value) return null;
    const baselineMatches = value.baseline === workspaceGenerationFingerprint(workspaceFiles);
    const sdkMatches = !sdkFingerprint || value.sdkFingerprint === sdkFingerprint;
    return {id: value.id, workspaceId: value.workspaceId, requirements: value.requirements, completedFileCount: value.completed.length, pendingFileCount: value.pending.length,
        path: value.pending[0]?.path || value.completed[0]?.path || '/SKILL.md', requiresImage: !!value.imageFingerprint, updatedAt: value.updatedAt, canResume: baselineMatches && sdkMatches,
        reason: !baselineMatches ? 'The workspace has changed since this checkpoint. Discard it and start a new attempt to preserve your newer edits.'
            : !sdkMatches ? 'The SDK contract changed. Start a new attempt with fresh guide approval.' : ''};
}
