/** @jest-environment node */
import path from 'node:path';
import {CSS_STATES, parseStateSelector, previewStateTokens} from '../../src/utils/plugins/authoring/liveUi/cssStates';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';

let base, preview, draft;
const render = files => createStaticUiPreview(files, sdk);
const button = () => preview.elements.find(item => item.tag === 'button');
const propose = async request => {
    draft = await prepareVisualDraft({base, previous: draft, preview, render, acceptFiles: files => files,
        request: {elementId: button().id, kind: 'css', styleFile: '/styles.css', styleKey: button().styles[0].key,
            state: 'hover', property: 'color', value: '#ff00ff', ...request}});
    preview = draft.preview; return draft;
};
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'state-utility', template: 'utility'});
    files['/render.tsx'] = files['/render.tsx'].replace("classFor('muted')", "classFor('button')");
    base = {files, revision: 'initial'}; draft = null; preview = await render(files);
});
test('creates a missing state with element isolation, preserves base/other uses and undoes both files together', async () => {
    const oldStyle = button().styles[0].copyStyle;
    await propose();
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle).toEqual({...oldStyle, '&:hover': {color: '#ff00ff'}});
    expect(preview.elements.find(item => item.tag === 'p').styles[0].copyStyle).toEqual(oldStyle);
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    expect(draft.changedFileCount).toBe(2);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const files = draft.files;
    await propose({kind: 'undo'}); expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); expect(draft.files).toEqual(files);
    await propose({state: 'focus-visible', property: 'outline', value: '4px solid red'});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle['&:focus-visible'].outline).toBe('4px solid red');
});
test('shared state edits and removal preserve comments, base, combined, nested and responsive rules', async () => {
    base.files['/styles.css'] += '\n/* keep */\n.button:hover { color: pink; padding: 2px; }\n.button:hover:focus { color: yellow; }\n@media (max-width: 400px) { .button:hover { color: red; } }';
    preview = await render(base.files);
    await propose({scope: 'shared'});
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    expect(draft.files['/styles.css']).toContain('/* keep */');
    expect(draft.files['/styles.css']).toContain('.button:hover:focus { color: yellow; }');
    expect(draft.files['/styles.css']).toContain('@media (max-width: 400px) { .button:hover { color: red; } }');
    expect(button().styles[0].declarations.find(item => item.property === 'color').value).not.toBe('#ff00ff');
    await propose({scope: 'shared', action: 'remove', value: undefined});
    expect(button().styles[0].states.find(item => item.state === 'hover').declarations.map(item => item.property)).toEqual(['padding']);
});
test('state injection, duplicate properties and ambiguous state additions are rejected', async () => {
    base.files['/styles.css'] += '\n.button:hover { color: red; color: blue; }\n.button:hover { padding: 1px; }';
    preview = await render(base.files);
    const request = {elementId: button().id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', state: 'hover', property: 'color', value: 'green'};
    expect(() => planVisualSourceEdit(base.files, preview.elements, request)).toThrow('supported CSS declaration');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, property: 'gap'})).toThrow('unambiguous');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, state: 'hover,body'})).toThrow('supported CSS state');
});

test('combined states edit reordered selectors in place and retain responsive scope through undo', async () => {
    base.files['/styles.css'] += '\n@media (min-width: 600px) and (max-width: 900px) { /* retained */ .button:focus:hover { color: pink; } }';
    preview = await render(base.files);
    await propose({scope: 'shared', state: 'hover:focus', breakpoint: {min: 600, max: 900}, property: 'padding', value: '7px'});
    expect(draft.files['/styles.css']).toContain('.button:focus:hover');
    expect(draft.files['/styles.css']).not.toContain('.button:hover:focus');
    expect(draft.files['/styles.css']).toContain('/* retained */');
    expect(draft.files['/styles.css']).toContain('padding: 7px');
    await propose({scope: 'shared', state: 'hover:focus', breakpoint: {min: 600, max: 900}, property: 'color', value: 'green'});
    expect(draft.files['/styles.css']).toContain('color: green');
    await propose({kind: 'undo'});
    expect(draft.files['/styles.css']).toContain('color: pink');
    await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
});

test('equivalent combined rules reject ambiguous additions and duplicate declarations', async () => {
    base.files['/styles.css'] += '\n.button:hover:focus { color: red; } .button:focus:hover { color: blue; }';
    preview = await render(base.files);
    const request = {elementId: button().id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', state: 'hover:focus', property: 'padding', value: '7px'};
    expect(() => planVisualSourceEdit(base.files, preview.elements, request)).toThrow('unambiguous');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, property: 'color'})).toThrow('supported CSS declaration');
});

test('combined state isolation copies the rule and leaves other users unchanged', async () => {
    await propose({state: 'hover:focus-visible', property: 'outline', value: '3px solid red'});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle['&:hover:focus-visible'].outline).toBe('3px solid red');
    expect(preview.elements.find(item => item.tag === 'p').styles[0].key).toBe('button');
});

test('state vocabulary canonicalizes permutations without accepting unsupported selector syntax', () => {
    expect(CSS_STATES).toHaveLength(16);
    expect(new Set(CSS_STATES.map(item => item.value)).size).toBe(16);
    expect(parseStateSelector('.button:focus:hover')).toMatchObject({classKey: 'button', state: 'hover:focus'});
    expect(previewStateTokens('hover:focus-visible')).toBe('hover focus focus-visible');
    for (const selector of ['.a:hover:hover', '.a:hover .b', '.a:hover,body', '.a:not(:hover)', '.a[title=":hover"]', '.a:disabled', '.a:hover/**/:focus']) {
        expect(parseStateSelector(selector)).toBeNull();
    }
});
