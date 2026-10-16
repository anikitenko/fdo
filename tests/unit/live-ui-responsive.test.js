/** @jest-environment node */
import path from 'node:path';
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
            breakpoint: 480, property: 'padding', value: '3px', ...request}});
    preview = draft.preview; return draft;
};
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'responsive-utility', template: 'utility'});
    files['/render.tsx'] = files['/render.tsx'].replace("classFor('muted')", "classFor('button')");
    base = {files, revision: 'initial'}; draft = null; preview = await render(files);
});
test('adds isolated responsive base and state rules with one reusable class and atomic undo', async () => {
    const original = button().styles[0].copyStyle;
    await propose();
    expect(draft.changedFileCount).toBe(2);
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle.padding).toBe(original.padding);
    expect(button().styles[0].copyStyle['@media (max-width: 480px)'].padding).toBe('3px');
    expect(preview.elements.find(item => item.tag === 'p').styles[0].copyStyle).toEqual(original);
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    await propose({state: 'hover', property: 'color', value: 'pink'});
    expect(button().styles[0].copyStyle['@media (max-width: 480px)']['&:hover'].color).toBe('pink');
    const final = draft.files;
    await propose({kind: 'undo'}); await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); await propose({kind: 'redo'});
    expect(draft.files).toEqual(final);
    expect(typecheckPluginWorkspace(final, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('edits/adds/removes inside an existing shared media block without touching adjacent or nested conditions', async () => {
    const tail = '\n/* keep */\n@media (max-width:480px) { /* inner */ .button { color: red; } .other {color: blue} }\n@supports (display: grid) { @media (max-width:480px) {.button {gap: 1px}} }\n@media (min-width:480px) {.button {padding: 20px}}\n/* end */';
    base.files['/styles.css'] += tail; preview = await render(base.files);
    await propose({scope: 'shared', property: 'color', value: 'green'});
    await propose({scope: 'shared', property: 'padding', value: '5px'});
    await propose({scope: 'shared', state: 'focus', property: 'color', value: 'pink'});
    expect(draft.files['/styles.css'].match(/@media \(max-width:480px\)/g)).toHaveLength(2); // original top-level + nested
    expect(draft.files['/styles.css']).toContain('.other {color: blue}');
    expect(draft.files['/styles.css']).toContain('/* inner */');
    expect(draft.files['/styles.css']).toContain('@supports (display: grid) { @media (max-width:480px) {.button {gap: 1px}} }');
    expect(draft.files['/styles.css']).toContain('@media (min-width:480px) {.button {padding: 20px}}');
    expect(draft.files['/styles.css']).toContain('/* end */');
    await propose({scope: 'shared', state: 'focus', property: 'color', action: 'remove', value: undefined});
    expect(button().styles[0].responsive.find(item => item.breakpoint === 480).states.find(item => item.state === 'focus').declarations).toEqual([]);
});
test('copies existing responsive styles and can extend the unique copied rule despite other media blocks', async () => {
    base.files['/styles.css'] += '\n@media (max-width:480px) {.button {padding: 1px} .other {color: red}}';
    preview = await render(base.files);
    await propose({property: 'gap', value: '12px'});
    expect(button().styles[0].copyStyle['@media (max-width:480px)']).toMatchObject({padding: '1px'});
    // The new declaration uses the existing condition spelling after copying.
    const context = button().styles[0].responsive.find(item => item.breakpoint === 480);
    expect(context.declarations.find(item => item.property === 'gap').value).toBe('12px');
});
test('discovers existing custom max widths, preserves unsupported queries and rejects injected/fractional breakpoints and duplicate additions', async () => {
    base.files['/styles.css'] += '\n@media (max-width: 600px) {.button {color: red}}\n@media (max-width: 600px) {.button {color: blue}}\n@media screen and (max-width: 700px) {.button {color: green}}';
    preview = await render(base.files);
    expect(button().styles[0].responsive.map(item => item.breakpoint)).toEqual([480, 600, 768, 1024]);
    const request = {elementId: button().id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', breakpoint: 600, property: 'gap', value: '4px'};
    expect(() => planVisualSourceEdit(base.files, preview.elements, request)).toThrow('unambiguous');
    for (const breakpoint of ['480', '480px){}', -1, 0, 1.5, 10001])
        expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, breakpoint})).toThrow('integer max-width');
});

test('creates a custom empty responsive rule in the chosen scope and reuses its class for subsequent properties', async () => {
    const original = button().styles[0].copyStyle;
    await propose({action: 'create-rule', breakpoint: 600, value: undefined, property: undefined});
    const context = button().styles[0].responsive.find(item => item.breakpoint === 600);
    expect(context).toMatchObject({declarations: [], canAddDeclarations: true, canCreateRule: false});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle.padding).toBe(original.padding);
    const created = draft.files;
    await propose({kind: 'undo'}); expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); expect(draft.files).toEqual(created);
    await propose({breakpoint: 600, property: 'padding', value: '7px'});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].responsive.find(item => item.breakpoint === 600).declarations).toContainEqual(expect.objectContaining({property: 'padding', value: '7px'}));
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('shared custom-rule creation changes CSS only and refuses duplicates, missing widths and non-base creation', async () => {
    await propose({action: 'create-rule', breakpoint: 620, scope: 'shared', value: undefined, property: undefined});
    expect(draft.changedFileCount).toBe(1);
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    const request = {elementId: button().id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', action: 'create-rule', breakpoint: 620};
    expect(() => planVisualSourceEdit(draft.files, preview.elements, request)).toThrow('already exists');
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {...request, breakpoint: null})).toThrow('Choose a max-width breakpoint');
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {...request, state: 'hover'})).toThrow('Base state');
});

test.each([
    ['', 'Enter'], ['600px', 'without units'], ['600.5', 'whole number'], ['-1', 'whole number'],
    ['0', '1 to 10000'], ['10001', '1 to 10000'], [' 600', 'whole number'],
])('custom width %s has a correction message', (value, message) => {
    const {breakpointInputError} = require('../../src/utils/plugins/authoring/liveUi/cssResponsive');
    expect(breakpointInputError(value)).toContain(message);
});

test.each(['1', '600', '10000'])('accepts custom whole-pixel width %s', value => {
    const {breakpointInputError} = require('../../src/utils/plugins/authoring/liveUi/cssResponsive');
    expect(breakpointInputError(value)).toBe('');
});

test('custom element-only creation reuses responsive rules supplied by imported effective CSS', async () => {
    base.files['/theme.css'] = '@media (max-width: 640px) {.button {padding: 9px}}';
    base.files['/styles.css'] = '@import "./theme.css";\n' + base.files['/styles.css'];
    preview = await render(base.files);
    expect(button().styles[0].responsive.some(context => context.breakpoint === 640)).toBe(false);
    await propose({action: 'create-rule', breakpoint: 640, property: undefined, value: undefined});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].responsive.find(context => context.breakpoint === 640).declarations).toContainEqual(expect.objectContaining({property: 'padding', value: '9px'}));
    expect(draft.files['/theme.css']).toBe(base.files['/theme.css']);
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
});
