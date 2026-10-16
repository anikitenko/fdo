/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import postcss from 'postcss';
import path from 'node:path';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {validBreakpoint, breakpointKey, mediaBreakpointOf, breakpointFormError, breakpointParams, breakpointPreviewWidth} from '../../src/utils/plugins/authoring/liveUi/cssResponsive';

test('recognizes inclusive minimum/maximum pairs in either order and rejects unsupported media syntax', () => {
    const root = postcss.parse('@media (min-width:768px) {} @media (max-width:900px) and (min-width:600px) {} @media screen and (min-width:800px) {} @media (min-width:900px) and (max-width:600px) {} @media (600px <= width <= 900px) {}');
    expect(root.nodes.map(mediaBreakpointOf)).toEqual([{min: 768}, {min: 600, max: 900}, null, null, {min: 600, max: 900}]);
    expect(breakpointKey({max: 900, min: 600})).toBe('range:600:900');
    expect(breakpointParams({max: 900, min: 600})).toBe('(min-width: 600px) and (max-width: 900px)');
    expect(breakpointPreviewWidth({min: 600, max: 900})).toBe(750);
    expect(breakpointPreviewWidth({min: 768})).toBe(768);
});
test.each([
    ['(width <= 640px)', 640], ['(640px >= width)', 640],
    ['(width >= 640px)', {min: 640}], ['(640px <= width)', {min: 640}],
    ['(600px <= width <= 900px)', {min: 600, max: 900}],
    ['(900px >= WIDTH >= 600px)', {min: 600, max: 900}],
    ['(width >= 600px) and (max-width: 900px)', {min: 600, max: 900}],
    ['(width <= 600px) and (600px <= width)', {min: 600, max: 600}],
])('recognizes inclusive width comparison %s', (params, expected) => {
    expect(mediaBreakpointOf(postcss.parse(`@media ${params} {}`).first)).toEqual(expected);
});
test.each([
    '(width < 640px)', '(width > 640px)', '(600px < width <= 900px)',
    '(900px >= width <= 600px)', '(900px <= width <= 600px)',
    '(width >= 0px)', '(width <= 10001px)', '(width <= 640.5px)',
    '(width <= 40rem)', '(height <= 640px)', 'screen and (width <= 640px)',
    '(width <= 640px), (width >= 900px)', '(width <= 640px) or (width >= 900px)',
    '(width <= 640px) and (max-width: 640px)',
    '(600px <= width <= 900px) and (min-width: 600px)',
])('keeps unsupported or ambiguous comparison %s read-only', params => {
    expect(mediaBreakpointOf(postcss.parse(`@media ${params} {}`).first)).toBeNull();
});
test('validates structured queries and gives inline range corrections', () => {
    for (const query of [{min: 768}, {min: 600, max: 900}, {min: 600, max: 600}, {max: 480}]) expect(validBreakpoint(query)).toBe(true);
    for (const query of [{min: 900, max: 600}, {min: '768'}, {min: 1.5}, {min: 0}, {min: 10001}, {min: 600, query: 'body'}, {}, [], Object.create({min: 600})]) expect(validBreakpoint(query)).toBe(false);
    expect(breakpointFormError('range', '900', '600')).toContain('Minimum width must');
    expect(breakpointFormError('range', '600', '900px')).toContain('without units');
    expect(breakpointFormError('min', '', '')).toContain('minimum');
    expect(breakpointFormError('range', '600', '900')).toBe('');
});
let base, preview, draft;
const render = files => createStaticUiPreview(files, sdk);
const button = () => preview.elements.find(element => element.tag === 'button');
const propose = async request => {
    draft = await prepareVisualDraft({base, previous: draft, preview, render, acceptFiles: files => files,
        request: {elementId: button().id, kind: 'css', styleFile: '/styles.css', styleKey: button().styles[0].key,
            breakpoint: {min: 768}, property: 'padding', value: '11px', ...request}});
    preview = draft.preview; return draft;
};
beforeEach(async () => {
    const files = createPluginTemplateFiles({name: 'media-utility', template: 'utility'});
    base = {files, revision: 'initial'}; draft = null; preview = await render(files);
});
test('creates minimum and range rules on one isolated class and preserves multi-file undo/redo', async () => {
    const old = button().styles[0].copyStyle;
    await propose({action: 'create-rule', property: undefined, value: undefined});
    await propose();
    await propose({breakpoint: {min: 600, max: 900}, property: 'color', value: 'pink'});
    await propose({breakpoint: {min: 600, max: 900}, state: 'hover', property: 'color', value: 'lime'});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle.padding).toBe(old.padding);
    expect(button().styles[0].copyStyle['@media (min-width: 768px)'].padding).toBe('11px');
    expect(button().styles[0].copyStyle['@media (min-width: 600px) and (max-width: 900px)']).toMatchObject({color: 'pink', '&:hover': {color: 'lime'}});
    const final = draft.files;
    for (let i = 0; i < 4; i++) await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    for (let i = 0; i < 4; i++) await propose({kind: 'redo'});
    expect(draft.files).toEqual(final);
    expect(typecheckPluginWorkspace(final, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('matches reversed range terms and edits/removes shared declarations without changing other conditions', async () => {
    base.files['/styles.css'] += '\n/* keep */\n@media (max-width:900px) and (min-width:600px) { .button {color:red} .other {gap:2px} }\n@media (min-width:600px) {.button {color:blue}}\n@media screen and (min-width:800px) {.button {color:yellow}}';
    preview = await render(base.files);
    await propose({scope: 'shared', breakpoint: {min: 600, max: 900}, property: 'color', value: 'pink'});
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    expect(draft.files['/styles.css']).toContain('@media (max-width:900px) and (min-width:600px)');
    expect(draft.files['/styles.css']).toContain('.other {gap:2px}');
    expect(draft.files['/styles.css']).toContain('@media screen and (min-width:800px) {.button {color:yellow}}');
    expect(draft.files['/styles.css']).toContain('@media (min-width:600px) {.button {color:blue}}');
    await propose({scope: 'shared', breakpoint: {min: 600, max: 900}, action: 'remove', property: 'color', value: undefined});
    expect(button().styles[0].responsive.find(context => breakpointKey(context.breakpoint) === 'range:600:900').declarations).toEqual([]);
});
test('rejects malformed ranges and ambiguous equivalent range additions without partial changes', async () => {
    base.files['/styles.css'] += '\n@media (max-width:900px) and (min-width:600px) {.button {color:red}}\n@media (min-width:600px) and (max-width:900px) {.button {color:blue}}';
    preview = await render(base.files);
    const request = {kind: 'css', scope: 'shared', elementId: button().id, styleFile: '/styles.css', styleKey: 'button', breakpoint: {min: 600, max: 900}, property: 'gap', value: '3px'};
    expect(() => planVisualSourceEdit(base.files, preview.elements, request)).toThrow('unambiguous');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, breakpoint: {min: 900, max: 600}})).toThrow('minimum no greater');
    expect(() => planVisualSourceEdit(base.files, preview.elements, {...request, breakpoint: {min: 600, extra: 'body'}})).toThrow('integer max-width');
});

test('edits existing comparison syntax, adds a combined state, and preserves unrelated queries through undo', async () => {
    const untouched = '\n@media (width < 600px) {.button {color:yellow}}\n@media (width >= 40rem) {.button {color:blue}}';
    base.files['/styles.css'] += '\n/* keep range */\n@media (900px >= width >= 600px) { /* keep inner */ .button {color:red} .other {gap:2px} }' + untouched;
    preview = await render(base.files);
    const range = {min: 600, max: 900};
    expect(button().styles[0].responsive.filter(context => breakpointKey(context.breakpoint) === breakpointKey(range))).toHaveLength(1);
    await propose({scope: 'shared', breakpoint: range, property: 'color', value: 'pink'});
    await propose({scope: 'shared', breakpoint: range, state: 'hover:focus', property: 'color', value: 'lime'});
    expect(draft.files['/styles.css']).toContain('@media (900px >= width >= 600px) { /* keep inner */');
    expect(draft.files['/styles.css']).toContain('.other {gap:2px}');
    expect(draft.files['/styles.css']).toContain(untouched);
    expect(draft.files['/styles.css']).not.toContain('@media (min-width: 600px)');
    expect(draft.files['/render.tsx']).toBe(base.files['/render.tsx']);
    const final = draft.files;
    await propose({kind: 'undo'}); await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); await propose({kind: 'redo'});
    expect(draft.files).toEqual(final);
    expect(typecheckPluginWorkspace(final, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('isolates comparison rules without rewriting the condition and reuses the copied rule', async () => {
    base.files['/styles.css'] += '\n@media (600px <= width <= 900px) {.button {padding:7px}}';
    preview = await render(base.files);
    await propose({breakpoint: {min: 600, max: 900}, property: 'color', value: 'pink'});
    expect(button().styles[0].key).toBe('button-local');
    expect(button().styles[0].copyStyle['@media (600px <= width <= 900px)']).toMatchObject({padding: '7px', color: 'pink'});
    expect(draft.files['/styles.css'].startsWith(base.files['/styles.css'])).toBe(true);
    expect(draft.files['/styles.css']).not.toContain('@media (min-width: 600px)');
});

test('equivalent comparison and legacy rules do not allow ambiguous property additions', async () => {
    base.files['/styles.css'] += '\n@media (width <= 640px) {.button {color:red}}\n@media (max-width:640px) {.button {color:blue}}';
    preview = await render(base.files);
    const context = button().styles[0].responsive.filter(item => item.breakpoint === 640);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({canAddDeclarations: false, declarations: []});
    expect(() => planVisualSourceEdit(base.files, preview.elements, {kind: 'css', scope: 'shared', elementId: button().id,
        styleFile: '/styles.css', styleKey: 'button', breakpoint: 640, property: 'gap', value: '3px'})).toThrow('unambiguous');
});
