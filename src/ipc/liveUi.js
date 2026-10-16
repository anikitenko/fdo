import {app, BrowserWindow, ipcMain} from 'electron';
import {createHash, randomUUID} from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {LiveUiChannels} from './channels';
import {focusAssistantOwner} from '../utils/desktop/assistantWindowPolicy';
import {resolveFdoSdkDistPath} from '../utils/sdk/installedSdkKnowledge';
import {createStaticUiPreview} from '../utils/plugins/authoring/liveUi/staticPreview';
import {pickLiveUiSources} from '../utils/plugins/authoring/liveUi/workspaceState';
import {prepareVisualDraft, visualDraftResponse} from '../utils/plugins/authoring/liveUi/draftEdits';
import {sdkComponentCatalog} from '../utils/plugins/authoring/liveUi/sdkComponentCatalog';
import {readInstalledAuthoringContracts} from '../utils/sdk/installedAuthoringContracts';
import {createVisualDraftStore, savedVisualDraft, restoreVisualDraft, visualDraftRecoveryStatus} from '../utils/plugins/authoring/liveUi/draftRecovery';

export async function readLiveUiSdkMetadata() {
    const dist = resolveFdoSdkDistPath();
    const [source, pkg] = await Promise.all([readFile(path.join(dist, 'dom-metadata.json'), 'utf8'), readFile(path.join(dist, '..', 'package.json'), 'utf8')]);
    const metadata = JSON.parse(source);
    if (!Array.isArray(metadata) || !metadata.every(item => typeof item.className === 'string' && Array.isArray(item.constructors) && Array.isArray(item.methods))) throw new Error('Installed SDK DOM metadata is malformed.');
    const authoring = readInstalledAuthoringContracts(path.join(dist, '..'));
    const authoringContracts = Object.fromEntries(Object.entries(authoring.contracts).map(([name, {data, ...status}]) => [name, status]));
    return {metadata, components: authoring.contracts.components.status === 'supported' ? sdkComponentCatalog(authoring.contracts.components.data) : [], authoringContracts, sdkVersion: JSON.parse(pkg).version,
        fingerprint: createHash('sha256').update(source).update(JSON.stringify(authoring)).digest('hex')};
}

export function registerLiveUiHandlers({entry, preload, draftStore}) {
    const sessions = new Map();
    const owners = new Map();
    const store = draftStore || createVisualDraftStore(path.join(app.getPath('userData'), 'live-ui-drafts'));
    const publicState = session => ({...session.state, recovery: session.recoveryError
        ? {status: 'unavailable', message: session.recoveryError}
        : session.savedDraft || session.draft ? visualDraftRecoveryStatus(session.savedDraft || savedVisualDraft(session.draftBase, session.draft, session.sdkFingerprint), session.state, session.sdkFingerprint) : null});
    const persist = async (session, base, draft) => {
        try {
            const record = savedVisualDraft(base, draft, session.sdkFingerprint);
            await store.save(base.workspaceId, record, session.savedId);
            session.savedId = record.id;
            return {saved: true};
        } catch (error) {return {saved: false, message: `Draft recovery could not be saved: ${error.message} Keep Live UI open or apply your changes before closing.`};}
    };
    const render = async files => {
        const dist = resolveFdoSdkDistPath();
        const contracts = readInstalledAuthoringContracts(path.join(dist, '..')).contracts;
        const authoring = contracts.dom;
        if (['invalid', 'unsupported'].includes(authoring.status)) return {status: 'unsupported', html: '', elements: [],
            message: `Installed SDK authoring contract cannot be used: ${authoring.message} Update the SDK or FDO before using this preview.`};
        const requireSdk = Module.createRequire(path.join(dist, '..', 'package.json'));
        return createStaticUiPreview(files, requireSdk('@anikitenko/fdo-sdk'), contracts.components.status === 'supported' ? contracts.components.data : undefined);
    };
    const finish = (session, result) => {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        if (result.status === 'applied') session.completed = {id: pending.draftId, result};
        pending.resolve(result);
    };
    const owned = (event, id, role) => {
        const session = sessions.get(id);
        if (!session || session[role].isDestroyed() || session[role].webContents !== event.sender) throw new Error('This Live UI session does not belong to this window.');
        return session;
    };
    const accept = data => {
        if (!data || typeof data.workspaceId !== 'string' || !data.workspaceId || data.workspaceId.length > 300) throw new Error('A workspace identity is required.');
        const files = pickLiveUiSources(data.files);
        const serialized = JSON.stringify(files);
        if (Object.keys(files).length > 250 || serialized.length > 2000000) throw new Error('Read-only preview supports up to 250 source files and 2 MB of source.');
        const snapshot = String(data.snapshot || '').slice(0, 200);
        const selection = data.selection && Object.hasOwn(files, data.selection.path) && Number.isInteger(data.selection.line) && Number.isInteger(data.selection.column)
            ? {path: data.selection.path, line: Math.max(1, data.selection.line), column: Math.max(1, data.selection.column)} : null;
        return {workspaceId: data.workspaceId, name: String(data.name || data.workspaceId).slice(0, 200), snapshot, files,
            selection,
            revision: createHash('sha256').update(snapshot + '\n' + serialized).digest('hex')};
    };
    ipcMain.handle(LiveUiChannels.OPEN, async (event, data) => {
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (!owner || !owner.__fdoEditorWindow || owner.isDestroyed()) throw new Error('Open Live UI from its IDE workspace.');
        const state = accept(data);
        let session = owners.get(owner.id);
        if (session && session.state.workspaceId !== state.workspaceId) { session.window.destroy(); session = null; }
        if (session && !session.window.isDestroyed()) {
            session.state = state;
            session.window.webContents.send(LiveUiChannels.UPDATED, publicState(session));
            focusAssistantOwner(session.window);
            return {sessionId: session.id};
        }
        const window = new BrowserWindow({title: `Live UI · ${state.name}`, width: 1200, height: 850, minWidth: 850, minHeight: 600,
            webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, preload}});
        session = {id: randomUUID(), owner, window, state};
        session.sdkFingerprint = (await readLiveUiSdkMetadata()).fingerprint;
        try {
            session.savedDraft = await store.read(state.workspaceId);
            session.savedId = session.savedDraft?.id;
        } catch (error) {session.recoveryError = `Saved draft could not be read: ${error.message} Workspace files are unchanged.`;}
        sessions.set(session.id, session); owners.set(owner.id, session);
        const ownerContents = owner.webContents;
        const ownerId = owner.id;
        const disconnect = () => {
            session.state = {...session.state, disconnected: true};
            finish(session, {status: 'disconnected', message: 'IDE disconnected. Reconnect and check current source before retrying.'});
            if (!window.isDestroyed()) window.webContents.send(LiveUiChannels.UPDATED, publicState(session));
        };
        const onNavigation = (_event, _url, _inPlace, mainFrame) => {if (mainFrame) disconnect();};
        owner.once('closed', disconnect);
        ownerContents.on('render-process-gone', disconnect);
        ownerContents.on('did-start-navigation', onNavigation);
        window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.on('closed', () => {
            finish(session, {status: 'cancelled', message: 'Live UI closed.'});
            sessions.delete(session.id);
            if (owners.get(ownerId) === session) owners.delete(ownerId);
            owner.removeListener('closed', disconnect);
            ownerContents.removeListener('render-process-gone', disconnect);
            ownerContents.removeListener('did-start-navigation', onNavigation);
        });
        try { await window.loadURL(`${entry}#/live-ui?session=${session.id}`); }
        catch (error) {window.destroy(); throw error;}
        return {sessionId: session.id};
    });
    ipcMain.handle(LiveUiChannels.PUBLISH, (event, id, data) => {
        const session = owned(event, id, 'owner');
        const state = accept(data);
        if (state.workspaceId !== session.state.workspaceId) throw new Error('The workspace changed. Reopen Live UI from the IDE.');
        if (state.revision !== session.state.revision || JSON.stringify(state.selection) !== JSON.stringify(session.state.selection)) {
            session.state = state;
            session.window.webContents.send(LiveUiChannels.UPDATED, publicState(session));
        }
        return {revision: state.revision};
    });
    ipcMain.handle(LiveUiChannels.READ, (event, id) => publicState(owned(event, id, 'window')));
    ipcMain.handle(LiveUiChannels.RESTORE_DRAFT, async (event, id) => {
        const session = owned(event, id, 'window');
        if (session.pending || session.restoring || session.state.disconnected) throw new Error('Reconnect to the IDE and finish the current draft operation before restoring.');
        const saved = session.savedDraft || (session.draft && savedVisualDraft(session.draftBase, session.draft, session.sdkFingerprint));
        if (!saved) throw new Error('There is no saved draft to restore.');
        const base = session.state;
        session.restoring = true;
        try {
            const fingerprint = (await readLiveUiSdkMetadata()).fingerprint;
            const draft = await restoreVisualDraft(saved, base, fingerprint, render, files => accept({...base, files}).files);
            if (session.state.revision !== base.revision || session.state.disconnected) throw new Error('Workspace changed during recovery. Reopen Live UI to check current source.');
            session.draft = draft;
            session.draftBase = base;
            session.savedDraft = null;
            session.recoveryError = null;
            const durability = await persist(session, base, draft);
            session.window.webContents.send(LiveUiChannels.UPDATED, publicState(session));
            return {...visualDraftResponse(draft), durability};
        } finally {session.restoring = false;}
    });
    ipcMain.handle(LiveUiChannels.DISCARD_DRAFT, async (event, id, draftId) => {
        const session = owned(event, id, 'window');
        if (session.pending || session.restoring) throw new Error('Wait for the current draft operation before discarding.');
        if (session.draft && session.draft.id !== draftId) throw new Error('This draft changed. Discard from its current version.');
        session.proposalGeneration = (session.proposalGeneration || 0) + 1;
        await store.clear(session.state.workspaceId, session.savedId ?? null);
        session.draft = null; session.savedDraft = null; session.savedId = null; session.recoveryError = null;
        session.window.webContents.send(LiveUiChannels.UPDATED, publicState(session));
        return {status: 'discarded'};
    });
    ipcMain.handle(LiveUiChannels.FOCUS_IDE, (event, id) => focusAssistantOwner(owned(event, id, 'window').owner));
    ipcMain.handle(LiveUiChannels.PREVIEW, async (event, id, revision) => {
        const session = owned(event, id, 'window');
        const state = session.state;
        if (state.revision !== revision) return {status: 'stale', revision};
        const result = await render(state.files);
        if (session.state.revision === state.revision) session.preview = {...result, revision: state.revision};
        return {...result, revision: state.revision};
    });
    ipcMain.handle(LiveUiChannels.REVEAL, (event, id, revision, elementId) => {
        const session = owned(event, id, 'window');
        const element = session.preview?.revision === revision && session.preview.elements?.find(item => item.id === elementId);
        if (!element || session.state.revision !== revision || session.state.disconnected) throw new Error('Refresh this selection before showing its source.');
        session.owner.webContents.send(LiveUiChannels.REVEAL_SOURCE, {workspaceId: session.state.workspaceId, ...element.location});
        return focusAssistantOwner(session.owner);
    });
    ipcMain.handle(LiveUiChannels.EDIT_WITH_AI, (event, id, revision, elementId) => {
        const session = owned(event, id, 'window');
        if (session.draft || session.savedDraft || session.recoveryError || session.pending || session.restoring) {
            throw new Error('Apply or discard the visual draft before editing with AI.');
        }
        const element = session.preview?.revision === revision && session.preview.elements?.find(item => item.id === elementId);
        if (!element || session.state.revision !== revision || session.state.disconnected) {
            throw new Error('Refresh this selection before editing with AI.');
        }
        const {location} = element;
        const source = session.state.files[location.path];
        if (typeof source !== 'string') throw new Error('The selected source is no longer available. Refresh the preview.');
        session.owner.webContents.send(LiveUiChannels.AI_SELECTION, {workspaceId: session.state.workspaceId, source, ...location});
        return focusAssistantOwner(session.owner);
    });
    ipcMain.handle(LiveUiChannels.PROPOSE, async (event, id, request) => {
        const session = owned(event, id, 'window');
        if (session.pending) return {status: 'busy', message: 'Wait for the current apply to finish.'};
        if (session.restoring || session.savedDraft || session.recoveryError) return {status: 'busy', message: 'Restore or discard the saved draft before making new visual changes.'};
        if (request.revision !== session.state.revision || session.state.disconnected) return {status: 'conflict', message: 'Source changed. Discard this draft and select the element again.'};
        const base = session.state;
        const previous = request.draftId ? session.draft : null;
        if (request.draftId && previous?.id !== request.draftId) return {status: 'conflict', message: 'This draft changed. Retry from the current draft.'};
        if (!previous && ['undo', 'redo'].includes(request.kind)) return {status: 'conflict', message: 'There is no current draft to change.'};
        const generation = session.proposalGeneration = (session.proposalGeneration || 0) + 1;
        const preview = previous?.preview || (session.preview?.revision === base.revision ? session.preview : await render(base.files));
        const draft = await prepareVisualDraft({base, previous, preview, request, render,
            acceptFiles: files => accept({...base, files}).files});
        if (base.revision !== session.state.revision || session.state.disconnected) return {status: 'conflict', message: 'Source changed during preview. Discard this draft and select again.'};
        if (session.pending) return {status: 'busy', message: 'An apply started while preparing this draft. Wait for it to finish.'};
        if (generation !== session.proposalGeneration) return {status: 'stale', message: 'A newer draft operation replaced this request.'};
        if (draft.status === 'error') return draft;
        session.draft = draft;
        session.draftBase = base;
        return {...visualDraftResponse(draft), durability: await persist(session, base, draft)};
    });
    ipcMain.handle(LiveUiChannels.APPLY, (event, id, draftId, options) => {
        const session = owned(event, id, 'window');
        if (session.completed?.id === draftId) return session.completed.result;
        if (session.pending?.draftId === draftId) return session.pending.promise;
        if (session.pending) return {status: 'busy', message: 'Another edit is being applied.'};
        const draft = session.draft;
        if (!draft?.patch || draft.id !== draftId || draft.revision !== session.state.revision || session.state.disconnected) return {status: 'conflict', message: 'This draft is stale. Discard it and select the element again.'};
        const requestId = randomUUID();
        let resolve;
        const promise = new Promise(done => {resolve = done;});
        const timer = setTimeout(() => finish(session, {status: 'error', message: 'IDE validation timed out. No commit was authorized; retry from current source.'}), 120000);
        session.pending = {requestId, draftId, promise, resolve, timer, committing: false};
        session.owner.webContents.send(LiveUiChannels.APPLY_REQUEST, {sessionId: id, requestId, base: session.state, patch: draft.patch, patches: draft.patches, keepCheckpoint: options?.keepCheckpoint === true});
        return promise;
    });
    ipcMain.handle(LiveUiChannels.CAN_COMMIT, (event, id, requestId) => {
        const session = owned(event, id, 'owner');
        const pending = session.pending;
        if (!pending || pending.requestId !== requestId || session.state.disconnected || session.draft?.revision !== session.state.revision) return false;
        pending.committing = true;
        clearTimeout(pending.timer);
        return true;
    });
    ipcMain.handle(LiveUiChannels.APPLIED, async (event, id, requestId, result) => {
        const session = owned(event, id, 'owner');
        if (!session.pending || session.pending.requestId !== requestId) return false;
        if (result.status === 'applied') {
            if (!session.pending.committing) throw new Error('This edit was not authorized to commit.');
            const state = accept(result.workspace);
            if (state.workspaceId !== session.state.workspaceId) throw new Error('Applied workspace identity does not match.');
            session.state = state;
            session.draft = null;
            try {await store.clear(state.workspaceId, session.savedId ?? null); session.savedId = null;}
            catch (error) {result = {...result, warning: [result.warning, `Saved draft cleanup failed: ${error.message}`].filter(Boolean).join(' ')};}
            session.window.webContents.send(LiveUiChannels.UPDATED, state);
        }
        finish(session, result);
        return true;
    });
}
