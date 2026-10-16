/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {extractCssStyles} from '../../src/components/editor/utils/extractCssStyles';

let base, preview, draft;
const render = files => createStaticUiPreview(files, sdk);
const acceptFiles = files => files;
const button = () => preview.elements.find(item => item.tag === 'button');
const propose = async request => {
    draft = await prepareVisualDraft({base, previous: draft, preview, render, acceptFiles,
        request: {elementId: button().id, kind: 'css', styleFile: '/styles.css', styleKey: button().styles[0].key, property: 'color', value: '#ff00ff', ...request}});
    preview = draft.preview;
    return draft;
};
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'isolated-utility', template: 'utility'});
    files['/render.tsx'] = files['/render.tsx'].replace("classFor('muted')", "classFor('button')");
    files['/imported.css'] = '.button { letter-spacing: 2px; } .button:focus { outline: 3px solid red; }';
    files['/styles.css'] = '@import "./imported.css";\n' + files['/styles.css'] + '\n.button:hover { color: pink !important; }\n@media (max-width: 480px) { .button { padding: 3px; } }\n';
    base = {files, revision: 'initial'}; draft = null; preview = await render(files);
});
test('default edit isolates only the selected element and retains imported, state and responsive styles', async () => {
    expect(button().isolationReason).toBeUndefined();
    expect(button().styles[0].isolationReason).toBe('');
    const oldStyle = button().styles[0].copyStyle;
    const oldClass = button().classNames[0];
    await propose();
    expect(draft.changedFileCount).toBe(2);
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    expect(draft.files['/imported.css']).toBe(base.files['/imported.css']);
    expect(button().styles[0]).toMatchObject({key: 'button-local', draftLocal: true});
    expect(button().styles[0].copyStyle).toEqual({...oldStyle, color: '#ff00ff'});
    const other = preview.elements.find(item => item.tag === 'p');
    expect(other.styles[0].key).toBe('button');
    expect(other.classNames).toEqual([oldClass]);
    expect(other.styles[0].copyStyle).toEqual(oldStyle);
    expect(draft.files['/render.tsx']).toContain("'data-role': 'run'");
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('further edits reuse one copy and undo/redo restores both files as one operation', async () => {
    await propose();
    const first = draft.files;
    await propose({property: 'gap', value: '14px'});
    expect(button().styles[0].key).toBe('button-local');
    expect(Object.keys(extractCssStyles(draft.files['/styles.css'])).filter(key => /^button-local/.test(key))).toEqual(['button-local']);
    await propose({kind: 'undo'});
    expect(draft.files).toEqual(first);
    await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    expect(button().styles[0].draftLocal).toBe(false);
    await propose({kind: 'redo'});
    expect(draft.files).toEqual(first);
    expect(button().styles[0].draftLocal).toBe(true);
    await propose({property: 'padding', value: '21px'});
    expect(button().styles[0].key).toBe('button-local');
    expect(draft.canRedo).toBe(false);
});
test('shared edits require an explicit scope and keep original class assignments', async () => {
    await propose({scope: 'shared'});
    expect(draft.changedFileCount).toBe(1);
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    for (const item of preview.elements.filter(item => item.styles.some(style => style.key === 'button')))
        expect(item.styles[0].copyStyle.color).toBe('#ff00ff');
});
test('isolation avoids name collisions and refuses ambiguous source ownership without fallback', async () => {
    base.files['/styles.css'] += '\n.button-local { color: green; }';
    preview = await render(base.files);
    await propose();
    expect(button().styles[0].key).toBe('button-local-2');
    const files = {...base.files, '/render.tsx': base.files['/render.tsx'].replace('input + button + result', 'input + button + button + result')};
    const shared = await render(files);
    const element = shared.elements.find(item => item.tag === 'button');
    expect(element.styles[0].isolationReason).toContain('unshared attributes');
    expect(() => planVisualSourceEdit(files, shared.elements, {elementId: element.id, kind: 'css', styleFile: '/styles.css', styleKey: 'button', property: 'color', value: 'red'})).toThrow('unshared attributes');
    expect(() => planVisualSourceEdit(files, shared.elements, {elementId: element.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'color', value: 'red'})).not.toThrow();
});

test('successive copies use a flat numbered family across applied workspaces and ignore longer-name prefixes', async () => {
    base.files['/styles.css'] += '\n.button-local-20 { color: green; }';
    preview = await render(base.files);
    for (let index = 1; index <= 4; index++) {
        await propose({value: `rgb(${index}, 0, 0)`});
        expect(button().styles[0].key).toBe(index === 1 ? 'button-local' : `button-local-${index}`);
        expect(draft.files['/styles.css']).not.toContain('-local-local');
        base = {files: draft.files, revision: 'applied-' + index};
        draft = null; preview = await render(base.files);
    }
    expect(base.files['/styles.css']).toContain('.button-local-20 { color: green; }');
});

test('creates an editable class in an empty imported stylesheet and undoes/replays both files together', async () => {
    base.files['/blank.css'] = '';
    base.files['/render.tsx'] = "import freshStyles from './blank.css';\n" + base.files['/render.tsx'];
    preview = await render(base.files);
    expect(button().styleSheets).toContainEqual({file: '/blank.css', binding: 'freshStyles'});
    const existing = button().styles[0].copyStyle;
    await propose({kind: 'create-style', styleFile: '/blank.css', className: 'custom-button'});
    expect(draft.status).not.toBe('error');
    expect(button().styles).toEqual([expect.objectContaining({key: 'custom-button', draftLocal: true, canAddDeclarations: true, declarations: []})]);
    expect(draft.files['/render.tsx']).toContain('dom.createClassFromStyle(freshStyles["custom-button"])');
    expect(draft.files['/styles.css']).toBe(base.files['/styles.css']);
    expect(preview.elements.find(item => item.tag === 'p').styles[0].copyStyle).toEqual(existing);
    const created = draft.files;
    await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'});
    expect(draft.files).toEqual(created);
    await propose({styleFile: '/blank.css', property: 'padding', value: '18px'});
    expect(button().styles[0].key).toBe('custom-button');
    expect(button().styles[0].copyStyle.padding).toBe('18px');
    expect(draft.changedFileCount).toBe(2);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('new class names receive exact collision suffixes; unimported files, injection and repeated calls are rejected', async () => {
    base.files['/styles.css'] += '\n.custom-button { color: red; }\n.custom-button-20 { color: blue; }';
    preview = await render(base.files);
    await propose({kind: 'create-style', className: 'custom-button'});
    expect(button().styles[0].key).toBe('custom-button-2');
    for (const className of ['x;body', '__proto__', 'constructor', '1button', 'x'.repeat(81)])
        expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: button().id, kind: 'create-style', styleFile: '/styles.css', className})).toThrow('class name');
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: button().id, kind: 'create-style', styleFile: '/unimported.css', className: 'safe'})).toThrow('imported stylesheet');
    const files = {...base.files, '/render.tsx': base.files['/render.tsx'].replace('input + button + result', 'input + button + button + result')};
    const repeated = await render(files);
    expect(() => planVisualSourceEdit(files, repeated.elements, {elementId: repeated.elements.find(item => item.tag === 'button').id, kind: 'create-style', styleFile: '/styles.css', className: 'safe'})).toThrow('unshared attributes');
});

test('two named empty classes keep distinct source ownership even when the SDK hashes match', async () => {
    base.files['/render.tsx'] = base.files['/render.tsx'].replace('input + button + result', "input + button + dom.createElement('button', {}, 'Second button') + result");
    preview = await render(base.files);
    await propose({kind: 'create-style', className: 'first-style'});
    const firstId = button().id;
    const secondId = preview.elements.find(item => item.text?.value === 'Second button').id;
    await propose({kind: 'create-style', elementId: secondId, className: 'second-style'});
    const first = preview.elements.find(item => item.id === firstId);
    const second = preview.elements.find(item => item.id === secondId);
    expect(first.classNames).toEqual(second.classNames);
    expect(first.styles.map(style => style.key)).toEqual(['first-style']);
    expect(second.styles.map(style => style.key)).toEqual(['second-style']);
    await propose({elementId: secondId, styleKey: 'second-style', property: 'padding', value: '19px'});
    expect(preview.elements.find(item => item.id === secondId).styles[0].copyStyle.padding).toBe('19px');
    expect(preview.elements.find(item => item.id === firstId).styles[0].copyStyle).toEqual({});
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('default declaration removal isolates first, preserves other uses and supports atomic undo', async () => {
    const oldStyle = button().styles[0].copyStyle;
    await propose({action: 'remove', value: undefined});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle.color).toBeUndefined();
    expect(preview.elements.find(item => item.tag === 'p').styles[0].copyStyle).toEqual(oldStyle);
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    expect(button().styles[0].copyStyle['&:hover']).toEqual(oldStyle['&:hover']);
    expect(draft.changedFileCount).toBe(2);
    await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'});
    expect(button().styles[0].copyStyle.color).toBeUndefined();
});
