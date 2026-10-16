import {liveUiWorkspacePayload} from '../../../utils/plugins/authoring/liveUi/workspaceState';
import {historyStorageKey, readHistory, writeHistory} from '../../editor/utils/aiCodingAgentHistory';

const matches = (workspace, base) => {
    const current = liveUiWorkspacePayload(workspace);
    return current.workspaceId === base.workspaceId && current.snapshot === base.snapshot && JSON.stringify(current.files) === JSON.stringify(base.files) && !workspace.fs.getRestoreLoading?.();
};

const fileFingerprint = entries => JSON.stringify(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const workspaceFingerprint = workspace => fileFingerprint(Object.entries(workspace.files)
    .filter(([file]) => !/^\/(node_modules|dist)\//.test(file))
    .map(([file, entry]) => [file, entry.model && !entry.model.isDisposed?.() ? entry.model.getValue() : entry.content || '']));
const snapshotFingerprint = snapshot => Array.isArray(snapshot?.content) ? fileFingerprint(snapshot.content.map(item => [item.id, item.content])) : null;

export async function applyVisualEdit({workspace, base, patch, patches = [patch], validate, canCommit, isActive = () => true, storage, designSession, keepCheckpoint = false}) {
    if (!matches(workspace, base)) return {status: 'conflict', message: 'The IDE source or snapshot changed. Discard the draft and select again.'};
    if (!patches.length || new Set(patches.map(item => item?.file)).size !== patches.length || patches.some(item => !item || base.files[item.file] !== item.before)) return {status: 'conflict', message: 'An edited file changed.'};
    const initialFingerprint = workspaceFingerprint(workspace);
    const unchanged = () => matches(workspace, base) && workspaceFingerprint(workspace) === initialFingerprint;
    const candidate = {...base.files, ...Object.fromEntries(patches.map(item => [item.file, item.after]))};
    const validation = await validate(candidate);
    if (!validation.success) return {status: 'error', message: validation.error || 'Candidate validation failed. No source edits were applied.'};
    if (!isActive() || !unchanged()) return {status: 'conflict', message: 'Source changed during validation. No source edits were applied.'};
    if (!await canCommit()) return {status: 'cancelled', message: 'The apply request expired or Live UI disconnected. No source edits were applied.'};
    // Recheck after the cross-process commit authorization, then commit without
    // yielding. All files in the draft are committed in the same synchronous section.
    if (!isActive() || !unchanged()) return {status: 'conflict', message: 'Source changed before commit. No source edits were applied.'};
    const fs = workspace.fs;
    const saved = {versions: {...fs.versions}, current: fs.version_current, latest: fs.version_latest, tsCounter: fs.tsCounter, revision: fs.snapshotSwitchRevision, group: designSession?.group};
    let persisted;
    try {persisted = storage.getItem(workspace.sandboxName);} catch {return {status: 'error', message: 'Workspace storage is unavailable. No source edits were applied.'};}
    const tabs = workspace.tabs.get().filter(tab => tab.id !== 'Untitled').map(({id, active}) => ({id, active}));
    // Validation failures intentionally share this boundary with operation failures.
    try {
        const group = designSession?.group;
        const continuing = group && group.workspaceId === base.workspaceId && group.snapshot === fs.version_current &&
            group.snapshot === fs.version_latest && group.revision === (fs.snapshotSwitchRevision || 0) &&
            group.fingerprint === initialFingerprint && fs.versions[group.restorePoint] &&
            fs.versions[group.snapshot]?.liveUiGroup === designSession.id &&
            !Object.values(fs.versions).some(version => version.prev === group.snapshot);
        const before = continuing ? {version: group.restorePoint} :
            snapshotFingerprint(fs.versions[base.snapshot]) === initialFingerprint ? {version: base.snapshot} :
                fs.create(fs.version().version, tabs, {quiet: true});
        if (!before || before.error) {
            //noinspection ExceptionCaughtLocallyJS
            throw new Error('Could not save a restore point.');
        }
        for (const item of patches) {
            workspace.setFileContent(item.file, item.after);
            if (liveUiWorkspacePayload(workspace).files[item.file] !== item.after) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('The IDE could not update the source model.');
            }
        }
        const after = fs.create(before.version, tabs, {quiet: true,
            ...(designSession ? {liveUiGroup: designSession.id} : {}),
            ...(continuing ? {replaceVersion: group.snapshot} : {})});
        if (!after || after.error) {
            //noinspection ExceptionCaughtLocallyJS
            throw new Error('Could not persist the edited workspace.');
        }
        fs.snapshotSwitchRevision = (fs.snapshotSwitchRevision || 0) + 1;
        const changes = continuing ? group.changes + 1 : 1;
        if (designSession) designSession.group = keepCheckpoint ? null : {workspaceId: base.workspaceId, snapshot: after.version,
            restorePoint: before.version, revision: fs.snapshotSwitchRevision, fingerprint: workspaceFingerprint(workspace), changes};
        const message = {role: 'snapshot', snapshot: after.version, content: `Live UI applied ${patch.description} in ${patches.map(item => item.file).join(', ')}. Restore point: ${before.version}; current snapshot: ${after.version}. ${designSession ? `Design group: ${changes} changes; ${keepCheckpoint ? 'checkpoint kept' : 'working snapshot updated in place'}. ` : ''}Use current workspace files for subsequent edits.`};
        let historySaved = false;
        try {
            const key = historyStorageKey(workspace.sandboxName);
            writeHistory(storage, key, [...readHistory(storage, key), message]);
            historySaved = true;
        } catch { /* The source snapshots are already persisted; history is advisory. */ }
        try {workspace.notifications.addToQueue('liveUiApplied', {from: before.version, to: after.version, message, historySaved});} catch { /* Notification failure must not undo a persisted edit. */ }
        return {status: 'applied', restorePoint: before.version, snapshot: after.version, grouped: !!continuing, changes, checkpointKept: keepCheckpoint, workspace: liveUiWorkspacePayload(workspace),
            warning: historySaved ? '' : 'The edit is saved, but conversation history could not be updated.'};
    } catch (error) {
        const rollbackErrors = [];
        for (const item of patches) {try {workspace.setFileContent(item.file, item.before);} catch {rollbackErrors.push(item.file);}}
        fs.versions = saved.versions; fs.version_current = saved.current; fs.version_latest = saved.latest; fs.tsCounter = saved.tsCounter; fs.snapshotSwitchRevision = saved.revision;
        if (designSession) designSession.group = saved.group;
        let persistenceError = '';
        try {
            if (persisted === null) storage.removeItem(workspace.sandboxName);
            else storage.setItem(workspace.sandboxName, persisted);
        } catch {persistenceError = ' Snapshot storage could not be restored; check saved snapshots in the IDE.';}
        try {workspace.notifications.addToQueue('treeVersionsUpdate', fs.list());} catch { /* Preserve failure diagnostics if a listener fails. */ }
        return {status: 'error', message: `${error.message} ${rollbackErrors.length ? `Source restoration failed for ${rollbackErrors.join(', ')}; inspect these files in the IDE.` : 'The source edit was rolled back.'}${persistenceError}`};
    }
}
