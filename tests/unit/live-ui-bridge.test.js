/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {registerLiveUiHandlers, readLiveUiSdkMetadata} from '../../src/ipc/liveUi';
import {LiveUiChannels} from '../../src/ipc/channels';
import {ipcMain, BrowserWindow} from 'electron';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';

jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}, BrowserWindow: Object.assign(jest.fn(), {fromWebContents: jest.fn()})}));
jest.mock('../../src/utils/desktop/assistantWindowPolicy', () => ({focusAssistantOwner: jest.fn(() => ({success: true}))}));
jest.mock('../../src/utils/sdk/installedSdkKnowledge', () => ({resolveFdoSdkDistPath: jest.fn(() => require('node:path').resolve('node_modules/@anikitenko/fdo-sdk/dist'))}));

let handlers, owner, child, savedDrafts, draftStore;
const windowMock = id => {
    const window = new EventEmitter();
    Object.assign(window, {id, isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), {send: jest.fn(), setWindowOpenHandler: jest.fn()}),
        loadURL: jest.fn(async () => {}), setTitle: jest.fn(), destroy: jest.fn(() => window.emit('closed'))});
    return window;
};
const payload = {workspaceId: 'sandbox_a', name: 'A', snapshot: 'blue', files: {'/index.ts': 'class P { render() {return "hello";} }'}};
beforeEach(() => {
    jest.clearAllMocks(); handlers = {};
    ipcMain.handle.mockImplementation((name, handler) => {handlers[name] = handler;});
    owner = windowMock(1); child = windowMock(2);
    owner.__fdoEditorWindow = true;
    BrowserWindow.fromWebContents.mockImplementation(sender => sender === owner.webContents ? owner : null);
    BrowserWindow.mockImplementation(() => child);
    savedDrafts = new Map();
    draftStore = {read: jest.fn(async key => savedDrafts.get(key) || null),
        save: jest.fn(async (key, value) => {savedDrafts.set(key, JSON.parse(JSON.stringify(value)));}),
        clear: jest.fn(async key => {savedDrafts.delete(key);})};
    registerLiveUiHandlers({entry: 'file:///fdo/index.html', preload: '/fdo/preload.js', draftStore});
});
const open = (data = payload) => handlers[LiveUiChannels.OPEN]({sender: owner.webContents}, data);

test('only the owning IDE publishes and only its visual window reads or previews the session', async () => {
    await expect(handlers[LiveUiChannels.OPEN]({sender: {}}, payload)).rejects.toThrow('IDE');
    const {sessionId} = await open();
    expect(() => handlers[LiveUiChannels.READ]({sender: {}}, sessionId)).toThrow('does not belong');
    expect(() => handlers[LiveUiChannels.PUBLISH]({sender: child.webContents}, sessionId, payload)).toThrow('does not belong');
    await expect(handlers[LiveUiChannels.PREVIEW]({sender: owner.webContents}, sessionId, 'x')).rejects.toThrow('does not belong');
    expect(handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId)).toMatchObject({workspaceId: 'sandbox_a', snapshot: 'blue'});
});
test('content and restore changes produce revisions; cross-workspace publication is rejected', async () => {
    const {sessionId} = await open();
    const event = {sender: child.webContents};
    const initial = handlers[LiveUiChannels.READ](event, sessionId);
    handlers[LiveUiChannels.PUBLISH]({sender: owner.webContents}, sessionId, {...payload, snapshot: 'green'});
    expect(handlers[LiveUiChannels.READ](event, sessionId).revision).not.toBe(initial.revision);
    expect(child.webContents.send).toHaveBeenCalledWith(LiveUiChannels.UPDATED, expect.objectContaining({snapshot: 'green'}));
    expect(() => handlers[LiveUiChannels.PUBLISH]({sender: owner.webContents}, sessionId, {...payload, workspaceId: 'sandbox_b'})).toThrow('workspace changed');
    expect(await handlers[LiveUiChannels.PREVIEW](event, sessionId, initial.revision)).toMatchObject({status: 'stale'});
});
test('owner reload disconnects the retained preview and closing Live UI releases subscriptions/session', async () => {
    const {sessionId} = await open();
    owner.webContents.emit('did-start-navigation', {}, '', false, true);
    expect(handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId)).toMatchObject({disconnected: true});
    child.emit('closed');
    expect(owner.listenerCount('closed')).toBe(0);
    expect(owner.webContents.listenerCount('did-start-navigation')).toBe(0);
    expect(() => handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId)).toThrow('does not belong');
    expect(handlers[LiveUiChannels.PUBLISH]({sender: owner.webContents}, sessionId, payload)).toEqual({status: 'closed'});
    expect(() => handlers[LiveUiChannels.PUBLISH]({sender: child.webContents}, sessionId, payload)).toThrow('does not belong');
});
test('SDK metadata includes its installed version and a repeatable fingerprint', async () => {
    const first = await readLiveUiSdkMetadata();
    expect(first).toMatchObject({sdkVersion: expect.any(String), fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(first.authoringContracts).toMatchObject({dom: {status: 'supported', version: '1.0.0'}, components: {status: 'supported', version: '1.2.0'}, previews:{status:'supported',version:'1.0.0'}});
    expect(first.metadata.some(item => item.className === 'DOM')).toBe(true);
    expect(first.components).toEqual(expect.arrayContaining(['fdo.dialog','fdo.confirmation-dialog','fdo.popover'].map(identity=>expect.objectContaining({identity,supported:true}))));
    expect((await readLiveUiSdkMetadata()).fingerprint).toBe(first.fingerprint);
});

async function prepareDraft() {
    const data = {...payload, files: createPluginTemplateFiles({name: 'visual-utility', template: 'utility'})};
    const {sessionId} = await open(data);
    const state = handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId);
    const preview = await handlers[LiveUiChannels.PREVIEW]({sender: child.webContents}, sessionId, state.revision);
    const button = preview.elements.find(item => item.tag === 'button');
    const draft = await handlers[LiveUiChannels.PROPOSE]({sender: child.webContents}, sessionId, {revision: state.revision, elementId: button.id, kind: 'text', value: 'Check JSON'});
    expect(draft.status).toBe('ready');
    return {data, sessionId, draft, button, state};
}
const applyRequest = () => owner.webContents.send.mock.calls.filter(call => call[0] === LiveUiChannels.APPLY_REQUEST).at(-1)[1];

test('support policy editing can repair an incompatible target, but applying requires acknowledgement', async () => {
    const files = createPluginTemplateFiles({name: 'future-policy', template: 'utility'});
    const pkg = JSON.parse(files['/package.json']);
    pkg.fdo.compatibility.fdo = '>=99.0.0';
    delete pkg.fdo.compatibility.sdk;
    files['/package.json'] = JSON.stringify(pkg);
    const data = {...payload, files};
    const {sessionId} = await open(data);
    const state = handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId);
    const draft = await handlers[LiveUiChannels.PROPOSE]({sender: child.webContents}, sessionId, {revision: state.revision, kind: 'compatibility', mode: 'missing'});
    expect(draft).toMatchObject({status: 'ready', supportOnly: true, supportPolicy: {compatibility: {status: 'incompatible'}}});
    expect(handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id)).toMatchObject({status: 'confirmation-required'});
    expect(owner.webContents.send.mock.calls.some(call => call[0] === LiveUiChannels.APPLY_REQUEST)).toBe(false);
    const pending = handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id, {confirmSupportChange: true});
    const request = applyRequest();
    expect(request.supportOnly).toBe(true);
    expect(handlers[LiveUiChannels.CAN_COMMIT]({sender: owner.webContents}, sessionId, request.requestId)).toBe(true);
    const result = {status: 'applied', workspace: {...data, files: {...files, '/package.json': draft.patch.after}}};
    await handlers[LiveUiChannels.APPLIED]({sender: owner.webContents}, sessionId, request.requestId, result);
    expect(await pending).toEqual(result);
    expect(handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId).authoringContract.compatibility.status).toBe('incompatible');
});

test('support edits do not mix into an existing visual draft', async () => {
    const {sessionId, state, draft} = await prepareDraft();
    const result = await handlers[LiveUiChannels.PROPOSE]({sender: child.webContents}, sessionId,
        {revision: state.revision, draftId: draft.id, kind: 'compatibility', mode: 'missing'});
    expect(result.status).toBe('busy');
});

test('repeated support proposals return a no-op without replacing history, and validation errors are structured', async () => {
    const {sessionId} = await open({...payload, files: {...payload.files, '/package.json': '{"name":"legacy"}'}});
    const event = {sender: child.webContents};
    const {revision} = handlers[LiveUiChannels.READ](event, sessionId);
    const draft = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision, kind: 'compatibility', mode: 'missing'});
    const repeated = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision, draftId: draft.id, kind: 'compatibility', mode: 'missing'});
    expect(repeated).toMatchObject({status: 'unchanged', message: expect.stringContaining('No changes were added')});
    const invalid = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision, draftId: draft.id, kind: 'compatibility', requirements: {fdo: 'latest'}});
    expect(invalid).toMatchObject({status: 'error', message: expect.stringContaining('valid version range')});
    const undo = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision, draftId: draft.id, kind: 'undo'});
    expect(undo.patches).toHaveLength(0);
    expect(undo.canRedo).toBe(true);
});

test('an incompatible workspace keeps a static preview but refuses visual proposals and apply', async () => {
    const files = createPluginTemplateFiles({name: 'future', template: 'utility'});
    const pkg = JSON.parse(files['/package.json']);
    pkg.fdo.compatibility.fdo = '>=99.0.0';
    files['/package.json'] = JSON.stringify(pkg);
    const {sessionId} = await open({...payload, files});
    const state = handlers[LiveUiChannels.READ]({sender: child.webContents}, sessionId);
    expect(state.authoringContract.compatibility.status).toBe('incompatible');
    const preview = await handlers[LiveUiChannels.PREVIEW]({sender: child.webContents}, sessionId, state.revision);
    expect(preview.status).toBe('ready');
    const result = await handlers[LiveUiChannels.PROPOSE]({sender: child.webContents}, sessionId, {revision: state.revision, kind: 'text'});
    expect(result.status).toBe('incompatible');
    expect(handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, 'forged')).toMatchObject({status: 'incompatible'});
    expect(owner.webContents.send.mock.calls.some(call => call[0] === LiveUiChannels.APPLY_REQUEST)).toBe(false);
});

test('approved drafts apply once through the owner; duplicate requests reuse the outcome', async () => {
    const {data, sessionId, draft} = await prepareDraft();
    const first = handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id, {keepCheckpoint: true});
    const duplicate = handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id);
    const request = applyRequest();
    expect(request.keepCheckpoint).toBe(true);
    expect(() => handlers[LiveUiChannels.CAN_COMMIT]({sender: child.webContents}, sessionId, request.requestId)).toThrow('does not belong');
    expect(handlers[LiveUiChannels.CAN_COMMIT]({sender: owner.webContents}, sessionId, request.requestId)).toBe(true);
    const result = {status: 'applied', snapshot: 'new', workspace: {...data, snapshot: 'new', files: {...data.files, [draft.patch.file]: draft.patch.after}}};
    handlers[LiveUiChannels.APPLIED]({sender: owner.webContents}, sessionId, request.requestId, result);
    expect(await first).toEqual(result); expect(await duplicate).toEqual(result);
    expect(handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id)).toEqual(result);
    expect(owner.webContents.send.mock.calls.filter(call => call[0] === LiveUiChannels.APPLY_REQUEST)).toHaveLength(1);
    expect(savedDrafts.has(data.workspaceId)).toBe(false);
});

test('closing and reopening offers recovery, retains history, and never authorizes an IDE commit', async () => {
    const {data, sessionId, draft} = await prepareDraft();
    expect(draft.durability.saved).toBe(true);
    child.destroy();
    child = windowMock(3);
    const reopened = await open(data);
    const event = {sender: child.webContents};
    expect(handlers[LiveUiChannels.READ](event, reopened.sessionId).recovery.status).toBe('available');
    await expect(handlers[LiveUiChannels.RESTORE_DRAFT]({sender: owner.webContents}, reopened.sessionId)).rejects.toThrow('does not belong');
    const restored = await handlers[LiveUiChannels.RESTORE_DRAFT](event, reopened.sessionId);
    expect(restored).toMatchObject({status: 'ready', canUndo: true, changedFileCount: 1, durability: {saved: true}});
    expect(restored.id).not.toBe(draft.id);
    expect(restored.files).toBeUndefined();
    expect(restored.steps).toBeUndefined();
    expect(owner.webContents.send.mock.calls.some(call => call[0] === LiveUiChannels.APPLY_REQUEST)).toBe(false);
    expect(reopened.sessionId).not.toBe(sessionId);
    const undone = await handlers[LiveUiChannels.PROPOSE](event, reopened.sessionId, {revision: restored.revision, draftId: restored.id, kind: 'undo'});
    expect(undone.patches).toEqual([]);
    await handlers[LiveUiChannels.DISCARD_DRAFT](event, reopened.sessionId, undone.id);
    expect(savedDrafts.size).toBe(0);
});

test('changed source blocks recovery and persistence errors leave the in-memory draft editable', async () => {
    const {data} = await prepareDraft();
    child.destroy(); child = windowMock(4);
    const {sessionId} = await open({...data, files: {...data.files, '/render.tsx': data.files['/render.tsx'] + '\n// changed in IDE'}});
    const event = {sender: child.webContents};
    expect(handlers[LiveUiChannels.READ](event, sessionId).recovery.status).toBe('conflict');
    await expect(handlers[LiveUiChannels.RESTORE_DRAFT](event, sessionId)).rejects.toThrow('source has changed');
    await handlers[LiveUiChannels.DISCARD_DRAFT](event, sessionId);
    draftStore.save.mockRejectedValueOnce(new Error('Disk full'));
    const state = handlers[LiveUiChannels.READ](event, sessionId);
    const preview = await handlers[LiveUiChannels.PREVIEW](event, sessionId, state.revision);
    const button = preview.elements.find(element => element.tag === 'button');
    const result = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, elementId: button.id, kind: 'text', value: 'In memory'});
    expect(result).toMatchObject({status: 'ready', durability: {saved: false, message: expect.stringContaining('Disk full')}});
    const retry = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: result.id, kind: 'undo'});
    expect(retry.durability.saved).toBe(true);
});
test('failed validation can retry the same draft; a source revision change prevents further apply', async () => {
    const {data, sessionId, draft} = await prepareDraft();
    const pending = handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id);
    const request = applyRequest();
    handlers[LiveUiChannels.APPLIED]({sender: owner.webContents}, sessionId, request.requestId, {status: 'error', message: 'Validation failed'});
    expect((await pending).status).toBe('error');
    const retry = handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id);
    expect(applyRequest().requestId).not.toBe(request.requestId);
    handlers[LiveUiChannels.APPLIED]({sender: owner.webContents}, sessionId, applyRequest().requestId, {status: 'error', message: 'Retryable'});
    await retry;
    handlers[LiveUiChannels.PUBLISH]({sender: owner.webContents}, sessionId, {...data, snapshot: 'restored'});
    expect(handlers[LiveUiChannels.APPLY]({sender: child.webContents}, sessionId, draft.id).status).toBe('conflict');
});
test('revealing code uses only the host source map and owning IDE', async () => {
    const {sessionId, state, button} = await prepareDraft();
    handlers[LiveUiChannels.REVEAL]({sender: child.webContents}, sessionId, state.revision, button.id);
    expect(owner.webContents.send).toHaveBeenCalledWith(LiveUiChannels.REVEAL_SOURCE, expect.objectContaining({path: '/render.tsx'}));
    expect(() => handlers[LiveUiChannels.REVEAL]({sender: child.webContents}, sessionId, state.revision, 'forged')).toThrow('selection');
});
test('AI handoff uses the owning IDE and host source map, preserving the current source', async () => {
    const {sessionId, state, button, draft} = await prepareDraft();
    const event = {sender: child.webContents};
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI](event, sessionId, state.revision, button.id)).toThrow('Apply or discard');
    await handlers[LiveUiChannels.DISCARD_DRAFT](event, sessionId, draft.id);
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI]({sender: owner.webContents}, sessionId, state.revision, button.id)).toThrow('does not belong');
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI](event, sessionId, state.revision, 'forged')).toThrow('selection');
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI](event, sessionId, 'stale', button.id)).toThrow('selection');
    handlers[LiveUiChannels.EDIT_WITH_AI](event, sessionId, state.revision, button.id);
    expect(owner.webContents.send).toHaveBeenCalledWith(LiveUiChannels.AI_SELECTION, {
        workspaceId: state.workspaceId, source: state.files[button.location.path], ...button.location,
    });
    handlers[LiveUiChannels.PUBLISH]({sender: owner.webContents}, sessionId, {...state, snapshot: 'newer'});
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI](event, sessionId, state.revision, button.id)).toThrow('selection');
});
test('AI handoff rejects a disconnected IDE', async () => {
    const {sessionId, state, button, draft} = await prepareDraft();
    await handlers[LiveUiChannels.DISCARD_DRAFT]({sender: child.webContents}, sessionId, draft.id);
    owner.webContents.emit('render-process-gone');
    expect(() => handlers[LiveUiChannels.EDIT_WITH_AI]({sender: child.webContents}, sessionId, state.revision, button.id)).toThrow('selection');
});
test('a draft can be continued and undone; stale predecessor IDs and net-empty applies are rejected', async () => {
    const {sessionId, draft, state} = await prepareDraft();
    const event = {sender: child.webContents};
    const continued = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: draft.id,
        kind: 'move', direction: 'down', elementId: draft.selectedId});
    expect(continued).toMatchObject({status: 'ready', changedFileCount: 1, canUndo: true});
    expect(continued.files).toBeUndefined();
    expect(continued.steps).toBeUndefined();
    expect(handlers[LiveUiChannels.APPLY](event, sessionId, draft.id).status).toBe('conflict');
    expect((await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: draft.id, kind: 'undo'})).status).toBe('conflict');
    const undo = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: continued.id, kind: 'undo'});
    const empty = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: undo.id, kind: 'undo'});
    expect(empty.patches).toEqual([]);
    expect(handlers[LiveUiChannels.APPLY](event, sessionId, empty.id).status).toBe('conflict');
    const redo = await handlers[LiveUiChannels.PROPOSE](event, sessionId, {revision: state.revision, draftId: empty.id, kind: 'redo'});
    expect(redo.patches).toHaveLength(1);
    expect(redo.changedFileCount).toBe(1);
});
