/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {runPluginWorkspaceTests} from '../../src/utils/plugins/runtime/pluginTestRunner';
jest.mock('electron', () => ({app: {getPath: () => require('node:os').tmpdir()}}));
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({
    getHostPluginNodeModulesPath: () => require('node:path').resolve('node_modules'),
    ensureExecutableEsbuildBinary: () => {}, loadHostEsbuild: () => require('esbuild'),
}));
let files, preview;
beforeEach(async () => {
    files = createPluginTemplateFiles({name: 'visual-structure', template: 'utility'});
    preview = await createStaticUiPreview(files, sdk);
});
const edit = async request => {
    const patch = planVisualSourceEdit(files, preview.elements, request);
    files = {...files, [patch.file]: patch.after};
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    return patch;
};
test('dialog and form bodies accept presets and preserve original handlers, fields, styles and real tests', async () => {
    files = createPluginTemplateFiles({name: 'dialog-structure', template: 'dialogs'});
    const original = {...files};
    preview = await createStaticUiPreview(files, sdk);
    for (const component of ['text', 'input', 'button', 'result', 'container']) {
        const form = preview.elements.find(item => item.tag === 'form');
        expect(form.structure.container).toBeDefined();
        await edit({kind: 'insert', elementId: form.id, component});
    }
    const dialog = preview.elements.find(item => item.tag === 'dialog');
    expect(dialog.structure.container).toBeDefined();
    await edit({kind: 'insert', elementId: dialog.id, component: 'result'});
    expect(files['/index.ts']).toBe(original['/index.ts']);
    expect(files['/styles.css']).toBe(original['/styles.css']);
    expect(files['/render.tsx']).toContain("'data-role': 'save-dialog'");
    expect(files['/render.tsx']).toContain("name: 'label'");
    expect(preview.elements.find(item => item.text?.value === 'New button').structure.removable).toBe(true);
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const result = await runPluginWorkspaceTests(files);
    expect({success: result.success, error: result.error, ...(result.success ? {} : {output: result.output})}).toEqual({success: true, error: null});
}, 30000);

test('new form content reorders with exact Undo/Redo while cross-container form/dialog destinations remain restricted', async () => {
    const base = {files: createPluginTemplateFiles({name: 'dialog-draft', template: 'dialogs'}), revision: 'dialog-base'};
    let draft;
    const render = candidate => createStaticUiPreview(candidate, sdk);
    preview = await render(base.files);
    const propose = async request => {
        draft = await prepareVisualDraft({base, previous: draft, preview, request, render, acceptFiles: files => files});
        preview = draft.preview;
    };
    const form = preview.elements.find(item => item.tag === 'form');
    const dialog = preview.elements.find(item => item.tag === 'dialog');
    expect(form.structure.removable).toBe(false);
    const external = preview.elements.find(item => item.tag === 'button' && item.text?.value === 'Configure workspace');
    expect(external.structure.moveTargets?.some(item => [form.id, dialog.id].includes(item.id))).toBeFalsy();
    expect(() => planVisualSourceEdit(base.files, preview.elements, {kind: 'move', elementId: external.id, destinationId: form.id})).toThrow('supported destination');
    await propose({kind: 'insert', elementId: form.id, component: 'text'});
    const text = preview.elements.find(item => item.text?.value === 'New text');
    expect(text.structure.position.up).toBe(true);
    expect(text.structure.moveTargets).toBeUndefined();
    expect(text.structure.moveReason).toContain('form bodies');
    await propose({kind: 'move', elementId: text.id, direction: 'up'});
    const final = draft.files;
    expect(final['/render.tsx'].indexOf('"New text"')).toBeLessThan(final['/render.tsx'].lastIndexOf('+ footer'));
    await propose({kind: 'undo'}); await propose({kind: 'undo'});
    expect(draft.files).toEqual(base.files);
    await propose({kind: 'redo'}); await propose({kind: 'redo'});
    expect(draft.files).toEqual(final);
});
test('insert every preset, reopen mappings, nest, reorder and remove while retaining source contracts and real tests', async () => {
    const original = {...files};
    for (const component of ['text', 'input', 'button', 'result', 'container']) {
        const parent = preview.elements.find(item => item.tag === 'main');
        const patch = await edit({elementId: parent.id, kind: 'insert', component});
        expect(patch.file).toBe('/render.tsx');
        expect(files['/index.ts']).toBe(original['/index.ts']);
        expect(files['/styles.css']).toBe(original['/styles.css']);
    }
    const container = preview.elements.find(item => item.tag === 'section' && item.text?.value === '');
    expect(container.structure.container).toBeDefined();
    await edit({elementId: container.id, kind: 'insert', component: 'text'});
    const text = preview.elements.find(item => item.tag === 'p' && item.text?.value === 'New text' && item.structure.position?.up);
    expect(text).toBeDefined();
    await edit({elementId: text.id, kind: 'move', direction: 'up'});
    const button = preview.elements.find(item => item.text?.value === 'New button');
    expect(button.structure.removable).toBe(true);
    expect(preview.html).toMatch(/disabled/);
    await edit({elementId: button.id, kind: 'remove'});
    expect(preview.html).not.toContain('New button');
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const result = await runPluginWorkspaceTests(files);
    expect({success: result.success, error: result.error, ...(result.success ? {} : {output: result.output})}).toEqual({success: true, error: null});
}, 30000);
test('reorder changes composition only, retaining comments, definitions and action bindings', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('input + button + result', 'input + /* keep boundary */ button + result');
    preview = await createStaticUiPreview(files, sdk);
    const button = preview.elements.find(item => item.tag === 'button');
    const patch = await edit({elementId: button.id, kind: 'move', direction: 'down'});
    expect(patch.after).toContain('input + /* keep boundary */ result + button');
    expect(patch.after).toContain("'data-role': 'run'");
    expect(patch.after.slice(0, patch.start)).toBe(patch.before.slice(0, patch.start));
    expect(patch.after.slice(patch.start + patch.replacement.length)).toBe(patch.before.slice(patch.end));
});
test('protects existing action targets, nonempty containers, multi-root groups and invalid requests', () => {
    const button = preview.elements.find(item => item.tag === 'button');
    const main = preview.elements.find(item => item.tag === 'main');
    const label = preview.elements.find(item => item.tag === 'label');
    expect(label.structure.position).toBeUndefined();
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'remove'})).toThrow('Action targets');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: main.id, kind: 'remove'})).toThrow('non-empty');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: main.id, kind: 'insert', component: '__proto__'})).toThrow('supported component');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'move', direction: 'arbitrary'})).toThrow('cannot move');
});
test('shared/repeated output is read-only for structural edits', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('title + intro + content', 'title + intro + intro + content');
    preview = await createStaticUiPreview(files, sdk);
    const intro = preview.elements.find(item => item.tag === 'p');
    expect(intro.structure.unique).toBe(false);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: intro.id, kind: 'remove'})).toThrow('shared or dynamic');
});
test('empty two-argument containers retain trailing commas and comments when inserting', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('title + intro + content', "title + intro + content + dom.createElement('section', { /* keep attributes */ }, /* keep trailing */)");
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    const empty = preview.elements.find(item => item.tag === 'section' && item.structure.container?.missing);
    expect(empty).toBeDefined();
    await edit({elementId: empty.id, kind: 'insert', component: 'input'});
    expect(files['/render.tsx']).toContain('/* keep attributes */');
    expect(files['/render.tsx']).toContain('/* keep trailing */');
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('moving an imported component changes the parent composition file, preserving the helper module', async () => {
    files['/component.ts'] = `import {DOM} from '@anikitenko/fdo-sdk';
export function extraText(): string { const dom = new DOM(); return dom.createElement('p', {}, 'Imported text'); }`;
    files['/render.tsx'] = "import {extraText} from './component';\n" + files['/render.tsx'].replace('title + intro + content', 'title + intro + content + extraText()');
    const helper = files['/component.ts'];
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    const imported = preview.elements.find(item => item.text?.value === 'Imported text');
    expect(imported.structure.file).toBe('/component.ts');
    const patch = await edit({elementId: imported.id, kind: 'move', direction: 'up'});
    expect(patch.file).toBe('/render.tsx');
    expect(patch.after).toContain('title + intro + extraText() + content');
    expect(files['/component.ts']).toBe(helper);
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('moves an existing action target across containers without moving its definition or bindings', async () => {
    const original = files['/render.tsx'];
    const button = preview.elements.find(item => item.tag === 'button');
    const main = preview.elements.find(item => item.tag === 'main');
    expect(button.structure.moveTargets.map(item => item.id)).toContain(main.id);
    await edit({elementId: button.id, kind: 'move', destinationId: main.id});
    expect(files['/render.tsx']).toContain('input + "" + result');
    expect(files['/render.tsx']).toContain('(title + intro + content) + button');
    expect(files['/render.tsx'].slice(0, files['/render.tsx'].indexOf('const content'))).toBe(original.slice(0, original.indexOf('const content')));
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const moved = preview.elements.find(item => item.tag === 'button');
    expect(moved.structure.position.parentId).toBe(preview.elements.find(item => item.tag === 'main').id);
    expect(preview.html.match(/data-role="run"/g)).toHaveLength(1);
});

test('cross-container moves accept literal inline presets and protect cycles and unavailable bindings', async () => {
    let main = preview.elements.find(item => item.tag === 'main');
    await edit({elementId: main.id, kind: 'insert', component: 'container'});
    main = preview.elements.find(item => item.tag === 'main');
    await edit({elementId: main.id, kind: 'insert', component: 'button'});
    const button = preview.elements.find(item => item.text?.value === 'New button');
    const empty = preview.elements.find(item => item.tag === 'section' && item.text?.value === '');
    expect(button.structure.moveTargets.map(item => item.id)).toContain(empty.id);
    await edit({elementId: button.id, kind: 'move', destinationId: empty.id});
    const moved = preview.elements.find(item => item.text?.value === 'New button');
    expect(moved.structure.position.parentId).toBe(preview.elements.find(item => item.tag === 'section' && item.structure.start === empty.structure.start).id);
    expect(preview.html.match(/New button/g)).toHaveLength(1);
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const parent = preview.elements.find(item => item.id === moved.structure.position.parentId);
    expect(parent.structure.moveTargets?.map(item => item.id) || []).not.toContain(moved.id);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: parent.id, kind: 'move', destinationId: moved.id})).toThrow('supported destination');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: moved.id, kind: 'move', destinationId: 'forged'})).toThrow('supported destination');
});

test('cannot move a late-defined container into an earlier container or across render scopes', async () => {
    const content = preview.elements.find(item => item.tag === 'section');
    const main = preview.elements.find(item => item.tag === 'main');
    expect(content.structure.moveTargets?.map(item => item.id) || []).not.toContain(main.id);
    // The root is its existing parent, not a new destination. Its own descendants
    // are excluded even where they have a writable container composition.
    expect(content.structure.moveTargets?.map(item => item.id) || []).not.toContain(content.id);
    files['/render.tsx'] = files['/render.tsx'].replace('const button =', "const early = dom.createElement('aside', {}, '');\n    const button =").replace('title + intro + content', 'title + intro + content + early');
    preview = await createStaticUiPreview(files, sdk);
    const lateButton = preview.elements.find(item => item.tag === 'button');
    const early = preview.elements.find(item => item.tag === 'aside');
    expect(lateButton.structure.moveTargets.map(item => item.id)).not.toContain(early.id);
    files['/extra.ts'] = `import {DOM} from '@anikitenko/fdo-sdk';
export function extra(): string { const dom = new DOM(); return dom.createElement('aside', {}, ''); }`;
    files['/render.tsx'] = "import {extra} from './extra';\n" + files['/render.tsx'].replace('title + intro + content', 'title + intro + content + extra()');
    preview = await createStaticUiPreview(files, sdk);
    const button = preview.elements.find(item => item.tag === 'button');
    const aside = preview.elements.find(item => item.tag === 'aside' && item.structure.file === '/extra.ts');
    expect(button.structure.moveTargets.map(item => item.id)).not.toContain(aside.id);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'move', destinationId: aside.id})).toThrow('supported destination');
});

test('rejects moving a container into its writable nested descendant', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('input + button + result', "input + button + result + dom.createElement('aside', {}, '')");
    preview = await createStaticUiPreview(files, sdk);
    const outer = preview.elements.find(item => item.tag === 'section');
    const inner = preview.elements.find(item => item.tag === 'aside');
    expect(inner.structure.container).toBeDefined();
    expect(outer.structure.moveTargets).toBeDefined();
    expect(outer.structure.moveTargets.map(item => item.id)).not.toContain(inner.id);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: outer.id, kind: 'move', destinationId: inner.id})).toThrow('supported destination');
});

test('moves into a two-argument container while preserving trailing comments and commas', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('title + intro + content', "title + intro + content + dom.createElement('aside', { /* attributes */ }, /* trailing */)");
    preview = await createStaticUiPreview(files, sdk);
    const button = preview.elements.find(item => item.tag === 'button');
    const aside = preview.elements.find(item => item.tag === 'aside');
    await edit({elementId: button.id, kind: 'move', destinationId: aside.id});
    expect(files['/render.tsx']).toContain('/* attributes */');
    expect(files['/render.tsx']).toContain('/* trailing */');
    const moved = preview.elements.find(item => item.tag === 'button');
    expect(moved.structure.position.index).toBe(0);
    expect(moved.structure.position.count).toBe(1);
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('a populated inline container can move as one subtree with stable inputs and registered stylesheet classes', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('title + intro + content', `title + intro + content +
        dom.createElement('section', {'aria-label': 'Moving panel'},
            dom.createElement('p', {}, name) + /* retained child boundary */
            dom.createElement('button', {type: 'button', disabled: true, class: dom.createClassFromStyle(styles['button'])}, 'Nested button')) +
        dom.createElement('aside', {'aria-label': 'Destination'}, '')`);
    preview = await createStaticUiPreview(files, sdk);
    const section = preview.elements.find(item => item.tag === 'section' && files['/render.tsx'].slice(item.structure.start, item.structure.end).includes('Moving panel'));
    const aside = preview.elements.find(item => item.tag === 'aside');
    expect(section.structure.moveTargets.map(item => item.id)).toContain(aside.id);
    await edit({elementId: section.id, kind: 'move', destinationId: aside.id});
    const moved = preview.elements.find(item => item.tag === 'section' && item.structure.position?.parentId === preview.elements.find(item => item.tag === 'aside').id);
    expect(moved).toBeDefined();
    expect(preview.elements.filter(item => item.text?.value === 'Nested button')).toHaveLength(1);
    expect(preview.elements.find(item => item.text?.value === 'Nested button').styles[0].key).toBe('button');
    expect(files['/render.tsx']).toContain('/* retained child boundary */');
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test.each([
    "dom.createElement('p', {}, escapeText(name))",
    "dom.createElement('p', {...{title: name}}, 'Spread')",
    "dom.createElement('p', {title: ({value: name}).value}, 'Object access')",
])('inline helpers, spreads and arbitrary reads keep their evaluation site: %s', expression => {
    return (async () => {
        files['/render.tsx'] = files['/render.tsx'].replace('title + intro + content', `title + intro + content + ${expression} + dom.createElement('aside', {}, '')`);
        preview = await createStaticUiPreview(files, sdk);
        expect(preview.status).toBe('ready');
        const target = preview.elements.filter(item => item.tag === 'p').at(-1);
        expect(target.structure.moveTargets).toBeUndefined();
        expect(target.structure.moveReason).toContain('evaluation site');
        const aside = preview.elements.find(item => item.tag === 'aside');
        expect(() => planVisualSourceEdit(files, preview.elements, {elementId: target.id, kind: 'move', destinationId: aside.id})).toThrow('supported destination');
    })();
});

test('primitive inputs unavailable at an earlier destination exclude it', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('const button =', "const early = dom.createElement('aside', {}, '');\n    const lateLabel = 'After destination';\n    const button =")
        .replace('title + intro + content', "title + intro + content + early + dom.createElement('p', {title: lateLabel}, 'Late input')");
    preview = await createStaticUiPreview(files, sdk);
    const target = preview.elements.find(item => item.text?.value === 'Late input');
    const early = preview.elements.find(item => item.tag === 'aside');
    expect(target.structure.moveTargets.map(item => item.id)).not.toContain(early.id);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: target.id, kind: 'move', destinationId: early.id})).toThrow('supported destination');
});

test.each([
    ['const otherDom = new DOM();', "dom.createElement('section', {}, otherDom.createElement('p', {}, 'Other DOM'))", 'section'],
    ["const otherStyles = {button: {color: 'red'}};", "dom.createElement('button', {class: dom.createClassFromStyle(otherStyles.button)}, 'Local style object')", 'button'],
])('inline moves do not cross DOM ownership or trust unregistered style objects: %s', async (declaration, expression, tag) => {
    files['/render.tsx'] = files['/render.tsx'].replace('const dom = new DOM();', 'const dom = new DOM(); ' + declaration)
        .replace('title + intro + content', `title + intro + content + ${expression} + dom.createElement('aside', {}, '')`);
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    const target = preview.elements.filter(item => item.tag === tag).at(-1);
    expect(target.structure.moveTargets).toBeUndefined();
    expect(target.structure.moveReason).toContain('evaluation site');
});
