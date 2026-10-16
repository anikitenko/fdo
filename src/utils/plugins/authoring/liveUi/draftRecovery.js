import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import {pickLiveUiSources} from './workspaceState';
import {rebuildVisualDraft} from './draftEdits';

const MAX_BYTES = 10000000;
const sourceHash = files => createHash('sha256').update(JSON.stringify(pickLiveUiSources(files))).digest('hex');
export function savedVisualDraft(base, draft, sdkFingerprint) {
    const selected = draft.preview.elements.find(element => element.id === draft.selectedId)?.structure;
    const steps = draft.steps.map(step => {
        const saved = {...step};
        // Each step already carries its complete atomic patches. Avoid storing
        // the first patch's potentially large content a second time.
        for (const redundant of ['start', 'removed', 'added']) delete saved[redundant];
        return saved;
    });
    return {schemaVersion: 1, id: draft.id, workspaceId: base.workspaceId, baseRevision: base.revision, sourceHash: sourceHash(base.files), sdkFingerprint,
        savedAt: new Date().toISOString(), files: draft.files, steps, cursor: draft.cursor,
        retainedLocalStyles: draft.retainedLocalStyles, historyTruncated: draft.historyTruncated,
        selection: selected ? {file: selected.file, start: selected.start} : null};
}

export function visualDraftRecoveryStatus(record, base, sdkFingerprint) {
    if (record.schemaVersion !== 1) return {status: 'unavailable', message: 'This saved draft uses an unsupported format. Its files have not been applied.'};
    if (record.workspaceId !== base.workspaceId || record.sourceHash !== sourceHash(base.files)) return {status: 'conflict', message: 'Workspace source has changed since this draft was saved. Automatic recovery is blocked; workspace files are unchanged.'};
    if (record.sdkFingerprint !== sdkFingerprint) return {status: 'conflict', message: 'The installed SDK changed since this draft was saved. Automatic recovery is blocked; workspace files are unchanged.'};
    return {status: 'available', savedAt: record.savedAt, message: 'Unapplied visual changes were saved locally. Restore the draft to review and continue, or discard it.'};
}

export async function restoreVisualDraft(record, base, sdkFingerprint, render, acceptFiles) {
    const status = visualDraftRecoveryStatus(record, base, sdkFingerprint);
    if (status.status !== 'available') throw new Error(status.message);
    const fail = () => {throw new Error('Saved draft history is invalid. Workspace files are unchanged.');};
    const {steps, cursor, files} = record;
    if (!files || JSON.stringify(pickLiveUiSources(files)) !== JSON.stringify(files) || JSON.stringify(files).length > 2000000 ||
        JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(base.files).sort()) ||
        !Array.isArray(steps) || steps.length > 100 || !Number.isInteger(cursor) || cursor < 0 || cursor > steps.length ||
        JSON.stringify(steps).length > 8000000 || typeof record.historyTruncated !== 'boolean' ||
        !Array.isArray(record.retainedLocalStyles) || record.retainedLocalStyles.length > 1000) fail();
    const styles = [...record.retainedLocalStyles, ...steps.flatMap(step => step.isolatedStyle ? [step.isolatedStyle] : [])];
    if (styles.some(style => !style || !Object.hasOwn(files, style.file) || typeof style.key !== 'string' || style.key.length > 300)) fail();
    for (const step of steps) {
        if (!Array.isArray(step.patches) || !step.patches.length || step.patches.length > 250 ||
            !Number.isFinite(step.affected) || step.affected < 0 || step.affected > 10000 || step.patches.some(patch =>
                !Object.hasOwn(files, patch.file) || !Number.isInteger(patch.start) || patch.start < 0 ||
                typeof patch.removed !== 'string' || typeof patch.added !== 'string')) fail();
    }
    if (steps.reduce((size, step) => size + step.patches.reduce((sum, patch) => sum + patch.removed.length + patch.added.length, 0), 0) > 4000000) fail();
    // Validate both Undo and Redo, including unapplied redo branches. A truncated
    // history has a retained checkpoint before its first step.
    const checkpoint = {...files};
    const apply = (step, undo) => {
        for (const patch of undo ? [...step.patches].reverse() : step.patches) {
            const removed = undo ? patch.added : patch.removed, added = undo ? patch.removed : patch.added;
            const source = checkpoint[patch.file];
            if (patch.start > source.length || source.slice(patch.start, patch.start + removed.length) !== removed) fail();
            checkpoint[patch.file] = source.slice(0, patch.start) + added + source.slice(patch.start + removed.length);
        }
        if (JSON.stringify(checkpoint).length > 2000000) fail();
    };
    for (const step of steps.slice(0, cursor).reverse()) apply(step, true);
    if (!record.historyTruncated && sourceHash(checkpoint) !== sourceHash(base.files)) fail();
    for (let i = 0; i < steps.length; i++) {
        apply(steps[i], false);
        if (i + 1 === cursor && sourceHash(checkpoint) !== sourceHash(files)) fail();
    }
    const draft = await rebuildVisualDraft({base, files, steps, cursor, retainedLocalStyles: record.retainedLocalStyles,
        historyTruncated: record.historyTruncated === true, selection: record.selection, render, acceptFiles});
    if (draft.status === 'error') throw new Error(draft.message);
    return draft;
}

// Local-only, private files with atomic replacement. Per-workspace queues prevent
// save/discard races; compare IDs so another window's newer draft is not erased.
export function createVisualDraftStore(directory) {
    const queues = new Map();
    const filename = key => path.join(directory, createHash('sha256').update(key).digest('hex') + '.json');
    const serial = (key, task) => {
        const result = (queues.get(key) || Promise.resolve()).then(task);
        const tail = result.catch(() => {});
        queues.set(key, tail);
        void tail.then(() => {if (queues.get(key) === tail) queues.delete(key);});
        return result;
    };
    const read = async key => {
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const file = filename(key);
            if ((await fs.stat(file)).size > MAX_BYTES) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Saved visual draft exceeds the recovery budget.');
            }
            const source = await fs.readFile(file, 'utf8');
            if (Buffer.byteLength(source) > MAX_BYTES) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Saved visual draft exceeds the recovery budget.');
            }
            const record = JSON.parse(source);
            if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Saved visual draft is malformed.');
            }
            return record;
        } catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    };
    return {
        read: key => serial(key, () => read(key)),
        save: (key, record, expectedId) => serial(key, async () => {
            const existing = await read(key);
            if (existing && existing.id !== expectedId) throw new Error('Another Live UI window saved a newer draft. This window’s changes remain in memory.');
            const source = JSON.stringify(record);
            if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('Draft exceeds the local recovery budget. Apply or reduce the draft before closing.');
            await fs.mkdir(directory, {recursive: true, mode: 0o700});
            const temporary = filename(key) + '.' + randomUUID() + '.tmp';
            try {await fs.writeFile(temporary, source, {mode: 0o600, flag: 'wx'}); await fs.rename(temporary, filename(key));}
            finally {await fs.rm(temporary, {force: true});}
        }),
        clear: (key, expectedId) => serial(key, async () => {
            let existing;
            try {existing = await read(key);}
            catch (error) {if (expectedId !== null) throw error;}
            if (existing && existing.id !== expectedId) throw new Error('Another Live UI window saved a newer draft. Reopen Live UI before discarding it.');
            await fs.rm(filename(key), {force: true});
        }),
    };
}
