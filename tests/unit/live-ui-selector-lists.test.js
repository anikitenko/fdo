/** @jest-environment node */
import path from 'node:path';
import postcss from 'postcss';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit, describeCssStyle} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {matchingStateSelectors} from '../../src/utils/plugins/authoring/liveUi/cssStates';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';

let base, preview, draft;
const render = files => createStaticUiPreview(files, sdk);
const button = () => preview.elements.find(item => item.tag === 'button');
const propose = async request => {
    draft = await prepareVisualDraft({base, previous: draft, preview, render, acceptFiles: files => files,
        request: {kind: 'css', scope: 'shared', state: 'hover', property: 'color', value: 'green', elementId: button().id,
            styleFile: '/styles.css', styleKey: button().styles[0].key, ...request}});
    preview = draft.preview;
};
const findRule = (css, selector) => {
    let result;
    postcss.parse(css).walkRules(rule => {if (rule.selector === selector) result = rule;});
    return result;
};
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'selector-lists', template: 'utility'});
    files['/styles.css'] += '\n/* shared states */\n.button:hover, .button:focus, .other { /* retain body */ color: red !important; padding: 2px; }\n/* after */';
    base = {files, revision: 'initial'}; draft = null; preview = await render(files);
});

test('splits one branch for update/add/remove, preserving unselected declarations, comments and importance', async () => {
    expect(button().styles[0].states.find(item => item.state === 'hover')).toMatchObject({selectorList: true});
    await propose({value: 'lime'});
    const untouched = findRule(draft.files['/styles.css'], '.button:focus, .other').toString();
    expect(untouched).toContain('color: red !important');
    expect(untouched).toContain('padding: 2px');
    expect(untouched).toContain('/* retain body */');
    const selected = findRule(draft.files['/styles.css'], '.button:hover');
    expect(selected.nodes.find(node => node.prop === 'color')).toMatchObject({value: 'lime', important: true});
    expect(draft.files['/styles.css']).toContain('/* shared states */');
    expect(draft.files['/styles.css']).toContain('/* after */');
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    await propose({state: 'focus', property: 'gap', value: '12px'});
    expect(findRule(draft.files['/styles.css'], '.other').toString()).not.toContain('gap');
    expect(findRule(draft.files['/styles.css'], '.button:focus').toString()).toContain('gap: 12px');
    await propose({state: 'focus', action: 'remove', property: 'color', value: undefined});
    expect(findRule(draft.files['/styles.css'], '.button:focus').toString()).not.toContain('color');
    expect(findRule(draft.files['/styles.css'], '.other').toString()).toContain('color: red !important');
    const final = draft.files;
    for (let i = 0; i < 3; i++) await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    for (let i = 0; i < 3; i++) await propose({kind: 'redo'});
    expect(draft.files).toEqual(final);
    expect(typecheckPluginWorkspace(final, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test.each(['set', 'remove'])('first %s separates a responsive combined-state list without changing its other branches', async action => {
    base.files['/styles.css'] += '\n@media (width <= 640px) { .button:focus:hover, .other:hover {color: pink; gap: 2px} }';
    preview = await render(base.files);
    await propose({state: 'hover:focus', breakpoint: 640, action, value: action === 'set' ? 'lime' : undefined});
    const css = draft.files['/styles.css'];
    expect(findRule(css, '.other:hover').toString()).toContain('color: pink');
    const target = findRule(css, '.button:focus:hover');
    expect(target.parent.params).toBe('(width <= 640px)');
    expect(target.toString()).toContain('gap: 2px');
    if (action === 'remove') expect(target.toString()).not.toContain('color');
    else expect(target.toString()).toContain('color: lime');
});

test('element-only changes copy effective list styles and leave every original rule intact', async () => {
    await propose({scope: 'element', value: 'pink'});
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle['&:hover'].color).toBe('pink !important');
    expect(button().styles[0].copyStyle['&:focus'].color).toBe('red !important');
    const final = draft.files;
    await propose({kind: 'undo'}); expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); expect(draft.files).toEqual(final);
});

test('equivalent branches and overlapping rules retain existing ambiguity protections', async () => {
    base.files['/styles.css'] += '\n.button:hover:focus, .button:focus:hover {color: pink}';
    preview = await render(base.files);
    const context = describeCssStyle(base.files, '/styles.css', 'button').states.find(item => item.state === 'hover:focus');
    expect(context).toMatchObject({canAddDeclarations: false, declarations: []});
    const request = {kind: 'css', scope: 'shared', elementId: button().id, styleFile: '/styles.css', styleKey: 'button', state: 'hover:focus', property: 'gap', value: '1px'};
    expect(() => planVisualSourceEdit(base.files, preview.elements, request)).toThrow('unambiguous');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, property: 'color'})).toThrow('supported CSS declaration');
});

test('only lists entirely within the supported simple-selector grammar are writable', () => {
    expect(matchingStateSelectors('.a:hover, .b:focus', 'a', 'hover')).toEqual(['.a:hover']);
    for (const selector of ['.a:hover, .b > span', '.a:hover, :is(.a,.b)', '.a:hover, .b[x="," ]',
        '.a:hover, .b:disabled', '.a:hover,', '.a:hover /* keep */, .b']) {
        expect(matchingStateSelectors(selector, 'a', 'hover')).toEqual([]);
    }
});

test('base-class list edits retain every declaration on the other class', async () => {
    const css = base.files['/styles.css'];
    expect(css).toMatch(/\.button\s*\{/);
    base.files['/styles.css'] = css.replace(/\.button\s*\{/, '.button, .unrelated {');
    const original = findRule(base.files['/styles.css'], '.button, .unrelated');
    const body = original.nodes.map(node => node.toString());
    preview = await render(base.files);
    await propose({state: 'base', property: 'padding', value: '31px'});
    expect(findRule(draft.files['/styles.css'], '.unrelated').nodes.map(node => node.toString())).toEqual(body);
    expect(findRule(draft.files['/styles.css'], '.button').toString()).toContain('padding: 31px');
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
});
