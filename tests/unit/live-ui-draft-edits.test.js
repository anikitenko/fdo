/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft, visualDraftResponse} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import path from 'node:path';
let base, draft, preview;
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'batch-utility', template: 'utility'});
    files['/render.tsx'] = files['/render.tsx'].replace('input + button + result', `input + button + result + dom.createElement('p', {}, 'Fourth') + dom.createElement('p', {}, 'Fifth') + dom.createElement('p', {}, 'Sixth') + dom.createElement('p', {}, 'Seventh')`);
    base = {revision: 'initial', files}; draft = null;
    preview = await createStaticUiPreview(files, sdk);
});
const propose = async (request, element = preview.elements.find(item => item.tag === 'button')) => {
    draft = await prepareVisualDraft({base, previous: draft, preview, request: {elementId: element?.id, ...request},
        render: files => createStaticUiPreview(files, sdk), acceptFiles: files => files});
    preview = draft.preview;
    return draft;
};
test('five moves accumulate one draft, keep selection, support undo/redo and emit one final source patch', async () => {
    const original = base.files['/render.tsx'];
    for (let i = 0; i < 5; i++) {
        await propose({kind: 'move', direction: 'down'});
        const selected = preview.elements.find(item => item.id === draft.selectedId);
        expect(selected.tag).toBe('button');
        expect(selected.structure.position.index).toBe(i + 2);
        expect(base.files['/render.tsx']).toBe(original);
    }
    expect(draft).toMatchObject({changedFileCount: 1, canUndo: true, canRedo: false});
    expect(draft.patches).toHaveLength(1);
    expect(draft.selectionMap[preview.elements.find(item => item.tag === 'main').id]).toBe(preview.elements.find(item => item.tag === 'main').id);
    const expected = draft.files['/render.tsx'];
    await propose({kind: 'undo'});
    expect(preview.elements.find(item => item.id === draft.selectedId).structure.position.index).toBe(5);
    await propose({kind: 'redo'});
    expect(draft.files['/render.tsx']).toBe(expected);
    expect(visualDraftResponse(draft).files).toBeUndefined();
    expect(visualDraftResponse(draft).steps).toBeUndefined();
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('direct position jumps retain inline-element selection after evaluation IDs change', async () => {
    const element = preview.elements.find(item => item.text?.value === 'Fourth');
    await propose({kind: 'move', index: 6}, element);
    const selected = preview.elements.find(item => item.id === draft.selectedId);
    expect(selected.text.value).toBe('Fourth');
    expect(selected.structure.position.index).toBe(6);
    expect(selected.id).not.toBe(element.id);
});
test('text, structure and CSS share one draft across files; undo-all and redo branch work', async () => {
    await propose({kind: 'move', index: 0});
    await propose({kind: 'text', value: 'Validate JSON'});
    await propose({kind: 'css', styleFile: '/styles.css', styleKey: 'button', property: 'background', value: '#ff00ff'});
    expect(draft.patches.map(patch => patch.file).sort()).toEqual(['/render.tsx', '/styles.css']);
    expect(draft.files['/render.tsx']).toContain('Validate JSON');
    expect(draft.files['/styles.css']).toContain('#ff00ff');
    for (let i = 0; i < 3; i++) await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    expect(draft.patches).toEqual([]);
    expect(draft.canUndo).toBe(false);
    expect(draft.canRedo).toBe(true);
    await propose({kind: 'redo'});
    await propose({kind: 'text', value: 'New direction'});
    expect(draft.canRedo).toBe(false);
    expect(draft.files['/styles.css']).toBe(base.files['/styles.css']);
});
test('stale revisions and unsupported edits preserve the prior draft; long history is bounded', async () => {
    await propose({kind: 'move', index: 0});
    const previous = draft;
    await expect(prepareVisualDraft({base: {...base, revision: 'changed'}, previous, preview, request: {kind: 'undo'}})).rejects.toThrow('Source changed');
    await expect(propose({kind: 'move', index: 10000})).rejects.toThrow('cannot move');
    expect(draft).toBe(previous);
    const full = {...previous, steps: Array.from({length: 100}, () => previous.steps[0]), cursor: 100};
    const bounded = await prepareVisualDraft({base, previous: full, preview,
        render: files => createStaticUiPreview(files, sdk), acceptFiles: files => files,
        request: {kind: 'text', elementId: preview.elements.find(item => item.tag === 'button').id, value: 'Limit'}});
    expect(bounded.steps).toHaveLength(100);
    expect(bounded.historyTruncated).toBe(true);
    expect(bounded.changedFileCount).toBe(1);
    expect(previous.files['/render.tsx']).toBe(draft.files['/render.tsx']);
});
test('repeated back-and-forth movement reports net changed files, not action history', async () => {
    for (let i = 0; i < 40; i++) {
        await propose({kind: 'move', index: i % 2 === 0 ? 2 : 1});
        expect(draft.changedFileCount).toBe(i % 2 === 0 ? 1 : 0);
    }
    expect(draft.files).toEqual(base.files);
    expect(draft.changedFileCount).toBe(0);
    expect(draft.canUndo).toBe(true);
    expect(visualDraftResponse(draft).editCount).toBeUndefined();
    expect(draft.patches).toEqual([]);
});
test('a long arranging session retains net changes and an honest bounded Undo baseline', async () => {
    await propose({kind: 'text', value: 'Retain this change'});
    for (let i = 0; i < 120; i++) await propose({kind: 'move', index: i % 2 === 0 ? 2 : 1});
    expect(draft.steps).toHaveLength(100);
    expect(draft.historyTruncated).toBe(true);
    expect(draft.changedFileCount).toBe(1);
    for (let i = 0; i < 100; i++) await propose({kind: 'undo'});
    expect(draft.canUndo).toBe(false);
    expect(draft.changedFileCount).toBe(1);
    expect(draft.files['/render.tsx']).toContain('Retain this change');
    expect(base.files['/render.tsx']).not.toContain('Retain this change');
    expect(draft.patch.description).toBe('Source changes');
});

test('cross-container moves retain inline selection, compose with text edits and undo as one step', async () => {
    let main = preview.elements.find(item => item.tag === 'main');
    await propose({kind: 'insert', component: 'container'}, main);
    const empty = preview.elements.find(item => item.tag === 'section' && item.text?.value === '');
    const text = preview.elements.find(item => item.text?.value === 'Fourth');
    const before = draft.files['/render.tsx'];
    await propose({kind: 'move', destinationId: empty.id}, text);
    let selected = preview.elements.find(item => item.id === draft.selectedId);
    expect(selected.text.value).toBe('Fourth');
    expect(selected.structure.position.index).toBe(0); // empty placeholders do not create visual slots
    const moved = draft.files['/render.tsx'];
    await propose({kind: 'text', value: 'Moved text'}, selected);
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('Moved text');
    await propose({kind: 'undo'});
    expect(draft.files['/render.tsx']).toBe(moved);
    await propose({kind: 'undo'});
    expect(draft.files['/render.tsx']).toBe(before);
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('Fourth');
    await propose({kind: 'redo'});
    expect(draft.files['/render.tsx']).toBe(moved);
    selected = preview.elements.find(item => item.id === draft.selectedId);
    expect(selected.text.value).toBe('Fourth');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('a styled connected subtree moves atomically and retains nested editing and exact Undo', async () => {
    base.files['/render.tsx'] = base.files['/render.tsx'].replace('title + intro + content', `title + intro + content +
        dom.createElement('section', {'aria-label': 'Moving panel'}, dom.createElement('p', {}, 'Panel text') +
            dom.createElement('button', {type: 'button', disabled: true, title: 'Connect an action in the IDE'}, 'Nested action')) +
        dom.createElement('aside', {'aria-label': 'Destination'}, '')`);
    preview = await createStaticUiPreview(base.files, sdk);
    let button = preview.elements.find(item => item.text?.value === 'Nested action');
    await propose({kind: 'style', styleFile: '/styles.css', styleKey: 'button'}, button);
    button = preview.elements.find(item => item.text?.value === 'Nested action');
    await propose({kind: 'connect-action', handler: 'run'}, button);
    button = preview.elements.find(item => item.text?.value === 'Nested action');
    await propose({kind: 'css', styleFile: '/styles.css', styleKey: 'button', property: 'padding', value: '17px'}, button);
    const beforeMove = {...draft.files};
    const panel = preview.elements.filter(item => item.tag === 'section').at(-1);
    const aside = preview.elements.find(item => item.tag === 'aside');
    await propose({kind: 'move', destinationId: aside.id}, panel);
    const moved = {...draft.files};
    const selected = preview.elements.find(item => item.id === draft.selectedId);
    expect(selected.structure.position.parentId).toBe(preview.elements.find(item => item.tag === 'aside').id);
    button = preview.elements.find(item => item.text?.value === 'Nested action');
    expect(button.styles[0].key).toBe('button-local');
    expect(button.styles[0].declarations.find(item => item.property === 'padding').value).toBe('17px');
    expect(button.actionConnection).toMatchObject({status: 'connected', handler: 'run', editable: true});
    await propose({kind: 'text', value: 'Edited nested action'}, button);
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('Edited nested action');
    await propose({kind: 'undo'}); expect(draft.files).toEqual(moved);
    await propose({kind: 'undo'}); expect(draft.files).toEqual(beforeMove);
    await propose({kind: 'redo'}); expect(draft.files).toEqual(moved);
    expect(preview.elements.find(item => item.id === draft.selectedId).tag).toBe('section');
    expect(draft.files['/styles.css']).toBe(beforeMove['/styles.css']);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
