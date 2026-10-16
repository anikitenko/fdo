/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {pickLiveUiSources} from '../../src/utils/plugins/authoring/liveUi/workspaceState';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {createVisualDraftStore, savedVisualDraft, restoreVisualDraft, visualDraftRecoveryStatus} from '../../src/utils/plugins/authoring/liveUi/draftRecovery';

const render = files => createStaticUiPreview(files, sdk);
const acceptFiles = files => pickLiveUiSources(files);
let directory, store;
beforeEach(async () => {directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-visual-draft-')); store = createVisualDraftStore(directory);});
afterEach(async () => {await fs.rm(directory, {recursive: true, force: true});});
async function fixture() {
    const base = {workspaceId: 'workspace', revision: 'before-restart', files: acceptFiles(createPluginTemplateFiles({name: 'Recovery', template: 'utility'}))};
    const preview = await render(base.files);
    const button = preview.elements.find(element => element.tag === 'button');
    const draft = await prepareVisualDraft({base, preview, request: {kind: 'text', elementId: button.id, value: 'Recovered button'}, render, acceptFiles});
    return {base, draft};
}
test('restart restores the draft with a new revision and preserves both Undo and Redo without applying source', async () => {
    const {base, draft} = await fixture();
    const second = await prepareVisualDraft({base, previous: draft, preview: draft.preview,
        request: {kind: 'text', elementId: draft.selectedId, value: 'Another edit'}, render, acceptFiles});
    const undone = await prepareVisualDraft({base, previous: second, request: {kind: 'undo'}, render, acceptFiles});
    await store.save(base.workspaceId, savedVisualDraft(base, undone, 'sdk-fingerprint'));
    const record = await createVisualDraftStore(directory).read(base.workspaceId);
    const reopened = {...base, revision: 'after-restart'};
    const restored = await restoreVisualDraft(record, reopened, 'sdk-fingerprint', render, acceptFiles);
    expect(restored).toMatchObject({revision: 'after-restart', changedFileCount: 1, canUndo: true, canRedo: true});
    expect(restored.preview.elements.find(element => element.id === restored.selectedId)?.text.value).toBe('Recovered button');
    expect(restored.preview.html).toContain('Recovered button');
    expect(restored.id).not.toBe(undone.id);
    expect(base.files['/render.tsx']).not.toContain('Recovered button');
    const redo = await prepareVisualDraft({base: reopened, previous: restored, request: {kind: 'redo'}, render, acceptFiles});
    expect(redo.files['/render.tsx']).toContain('Another edit');
    const undo = await prepareVisualDraft({base: reopened, previous: restored, request: {kind: 'undo'}, render, acceptFiles});
    expect(undo.files).toEqual(base.files);
});
test('source and SDK changes block recovery before evaluating any saved source', async () => {
    const {base, draft} = await fixture();
    const record = savedVisualDraft(base, draft, 'old-sdk');
    const renderer = jest.fn();
    await expect(restoreVisualDraft(record, {...base, files: {...base.files, '/index.ts': 'changed'}}, 'old-sdk', renderer, acceptFiles)).rejects.toThrow('Workspace source has changed');
    await expect(restoreVisualDraft(record, base, 'new-sdk', renderer, acceptFiles)).rejects.toThrow('installed SDK changed');
    expect(renderer).not.toHaveBeenCalled();
    expect(visualDraftRecoveryStatus({...record, schemaVersion: 2}, base, 'old-sdk').status).toBe('unavailable');
});
test('truncated history retains its checkpoint and only exposes the remaining Undo steps', async () => {
    const {base, draft} = await fixture();
    const next = await prepareVisualDraft({base, previous: draft, preview: draft.preview,
        request: {kind: 'text', elementId: draft.selectedId, value: 'Checkpoint edit'}, render, acceptFiles});
    const record = savedVisualDraft(base, {...next, steps: next.steps.slice(1), cursor: 1, historyTruncated: true}, 'sdk');
    const restored = await restoreVisualDraft(record, base, 'sdk', render, acceptFiles);
    const undone = await prepareVisualDraft({base, previous: restored, request: {kind: 'undo'}, render, acceptFiles});
    expect(undone.files).toEqual(draft.files);
    expect(undone.canUndo).toBe(false);
    expect(undone.historyTruncated).toBe(true);
    expect(undone.changedFileCount).toBe(1);
});
test('multi-file style isolation restores its local class identity and atomic Undo', async () => {
    const {base, draft} = await fixture();
    const styled = await prepareVisualDraft({base, previous: draft, preview: draft.preview,
        request: {kind: 'css', elementId: draft.selectedId, styleFile: '/styles.css', styleKey: 'button', scope: 'element', property: 'background', value: '#123456'}, render, acceptFiles});
    expect(styled.changedFileCount).toBe(2);
    const record = JSON.parse(JSON.stringify(savedVisualDraft(base, styled, 'sdk')));
    const restored = await restoreVisualDraft(record, base, 'sdk', render, acceptFiles);
    expect(restored.files).toEqual(styled.files);
    expect(restored.preview.elements.find(element => element.id === restored.selectedId).styles.some(style => style.draftLocal)).toBe(true);
    const undo = await prepareVisualDraft({base, previous: restored, request: {kind: 'undo'}, render, acceptFiles});
    expect(undo.files).toEqual(draft.files);
});
test('corrupted redo history and unexpected file paths cannot be restored', async () => {
    const {base, draft} = await fixture();
    const record = savedVisualDraft(base, draft, 'sdk');
    const corrupted = JSON.parse(JSON.stringify(record));
    corrupted.steps[0].patches[0].start += 1;
    await expect(restoreVisualDraft(corrupted, base, 'sdk', render, acceptFiles)).rejects.toThrow('history is invalid');
    await expect(restoreVisualDraft({...record, files: {...record.files, '/../outside.ts': 'source'}}, base, 'sdk', render, acceptFiles)).rejects.toThrow('history is invalid');
});
test('workspace keys cannot escape the store and stale windows cannot erase newer drafts', async () => {
    const key = '../../other/workspace';
    await store.save(key, {id: 'first', schemaVersion: 1});
    await store.save(key, {id: 'second', schemaVersion: 1}, 'first');
    await expect(store.clear(key, 'first')).rejects.toThrow('newer draft');
    await expect(store.save(key, {id: 'third'}, 'first')).rejects.toThrow('newer draft');
    expect(await store.read(key)).toMatchObject({id: 'second'});
    const files = await fs.readdir(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    if (process.platform !== 'win32') expect((await fs.stat(path.join(directory, files[0]))).mode & 0o777).toBe(0o600);
    await store.clear(key, 'second');
    expect(await store.read(key)).toBeNull();
});
test('an unreadable saved record can be explicitly discarded, but not overwritten silently', async () => {
    await store.save('workspace', {id: 'valid'});
    const [file] = await fs.readdir(directory);
    await fs.writeFile(path.join(directory, file), '{invalid');
    await expect(store.read('workspace')).rejects.toThrow();
    await expect(store.save('workspace', {id: 'replacement'})).rejects.toThrow();
    await store.clear('workspace', null);
    expect(await store.read('workspace')).toBeNull();
});
