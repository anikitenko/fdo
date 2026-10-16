/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';

const render = files => createStaticUiPreview(files, sdk);
let base, draft, preview;
const input = () => preview.elements.find(item => item.tag === 'textarea');
const propose = async request => {
    draft = await prepareVisualDraft({base, previous: draft, preview, request: {elementId: input().id, kind: 'attribute', attribute: 'placeholder', ...request}, render, acceptFiles: files => files});
    expect(draft.status).not.toBe('error'); preview = draft.preview;
};
beforeEach(async () => {
    base = {revision: 'initial', files: createPluginTemplateFiles({name: 'attribute-utility', template: 'utility'})};
    draft = null; preview = await render(base.files);
});

test('literal attributes escape through the SDK once and retain bindings, selection and exact undo', async () => {
    const value = /* language=TEXT */ 'Config "quoted" & <img src=x onerror=alert(1)>';
    await propose({value});
    expect(draft.files['/render.tsx']).toContain(JSON.stringify(value));
    expect(preview.html).toContain('placeholder="Config &quot;quoted&quot; &amp; &lt;img');
    expect(preview.html).not.toContain('<img');
    expect(preview.elements.find(item => item.id === draft.selectedId).tag).toBe('textarea');
    expect(draft.files['/index.ts']).toBe(base.files['/index.ts']);
    expect(draft.files['/render.tsx']).toContain("'data-role': 'input'");
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    await propose({kind: 'undo'}); expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); expect(input().editableAttributes.find(item => item.name === 'placeholder').value).toBe(value);
});

test('add, empty and remove are distinct and preserve comments and other properties', async () => {
    base.files['/render.tsx'] = base.files['/render.tsx'].replace("placeholder: '{\"service\":\"api\"}'", "/* before, retained */ placeholder: '{\"service\":\"api\"}', /* after, retained */");
    preview = await render(base.files);
    await propose({attribute: 'aria-label', value: 'Configuration JSON'});
    await propose({attribute: 'aria-description', value: 'Paste a local configuration'});
    await propose({value: ''});
    expect(input().editableAttributes.find(item => item.name === 'placeholder')).toMatchObject({present: true, value: ''});
    await propose({action: 'remove'});
    expect(input().editableAttributes.find(item => item.name === 'placeholder').present).toBe(false);
    expect(draft.files['/render.tsx']).toContain('before, retained');
    expect(draft.files['/render.tsx']).toContain('after, retained');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    for (let count = 0; count < 4; count++) await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
});

test.each(['id', 'data-role', 'onclick', 'disabled', 'class', '__proto__'])('rejects binding, script and unsupported attributes: %s', attribute => {
    expect(() => planVisualSourceEdit(base.files, preview.elements, {elementId: input().id, kind: 'attribute', attribute, value: 'new'})).toThrow('supported literal attribute');
});

test.each(['line\nbreak', '\u0000', 'x'.repeat(501), null])('rejects invalid single-line values', value => {
    expect(() => planVisualSourceEdit(base.files, preview.elements, {elementId: input().id, kind: 'attribute', attribute: 'placeholder', value})).toThrow('500 characters');
});

test('computed values stay read-only without blocking other literal attributes', async () => {
    base.files['/render.tsx'] = base.files['/render.tsx'].replace("placeholder: '{\"service\":\"api\"}'", "placeholder: name");
    preview = await render(base.files);
    expect(input().editableAttributes.find(item => item.name === 'placeholder')).toMatchObject({editable: false, reason: expect.stringContaining('computed')});
    expect(() => planVisualSourceEdit(base.files, preview.elements, {elementId: input().id, kind: 'attribute', attribute: 'placeholder', value: 'New'})).toThrow('supported literal');
    await propose({attribute: 'aria-label', value: 'JSON source'});
    expect(draft.files['/render.tsx']).toContain('placeholder: name');
});

test('shared calls and duplicate or spread attributes cannot be edited', async () => {
    for (const source of [
        base.files['/render.tsx'].replace('title + intro + content', 'title + intro + content + content'),
        base.files['/render.tsx'].replace("placeholder: '{\"service\":\"api\"}'", "placeholder: 'one', placeholder: 'two'"),
        base.files['/render.tsx'].replace("placeholder: '{\"service\":\"api\"}'", "...{placeholder: 'spread'}"),
    ]) {
        const files = {...base.files, '/render.tsx': source};
        const result = await render(files);
        expect(result.status).toBe('ready');
        const element = result.elements.find(item => item.tag === 'textarea');
        expect(element.editableAttributes).toBeUndefined();
    }
});

test('managed button titles are protected and accessible descriptions preserve editable connections', async () => {
    await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    let button = preview.elements.find(item => item.text?.value === 'New button');
    expect(button.editableAttributes.find(item => item.name === 'title')).toMatchObject({editable: false, reason: expect.stringContaining('managed')});
    await propose({elementId: button.id, kind: 'attribute', attribute: 'aria-description', value: 'Inspect the JSON editor'});
    button = preview.elements.find(item => item.text?.value === 'New button');
    expect(button.actionConnection.status).toBe('available');
    await propose({elementId: button.id, kind: 'connect-action', handler: 'run'});
    button = preview.elements.find(item => item.text?.value === 'New button');
    expect(button.actionConnection.editable).toBe(true);
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: button.id, kind: 'attribute', attribute: 'title', value: 'Custom'})).toThrow('supported literal');
});
