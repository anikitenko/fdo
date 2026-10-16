/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {runPluginWorkspaceTests} from '../../src/utils/plugins/runtime/pluginTestRunner';
jest.mock('electron', () => ({app: {getPath: () => require('node:os').tmpdir()}}));
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({
    getHostPluginNodeModulesPath: () => require('node:path').resolve('node_modules'),
    ensureExecutableEsbuildBinary: () => {}, loadHostEsbuild: () => require('esbuild'),
}));
let files, preview;
beforeEach(async () => {
    files = createPluginTemplateFiles({name: 'style-utility', template: 'utility'});
    preview = await createStaticUiPreview(files, sdk);
});
const assign = element => planVisualSourceEdit(files, preview.elements, {kind: 'style', elementId: element.id, styleFile: '/styles.css', styleKey: 'muted'});
test('assigns imported CSS on the rendering DOM instance, retaining attributes, bindings and real tests', async () => {
    const button = preview.elements.find(item => item.tag === 'button');
    expect(button.availableStyles).toContainEqual({file: '/styles.css', key: 'muted', binding: 'styles'});
    const patch = assign(button);
    expect(patch.after).toContain('dom.createClassFromStyle(styles["muted"])');
    expect(patch.after).toContain("'data-role': 'run'");
    const nextFiles = {...files, [patch.file]: patch.after};
    const next = await createStaticUiPreview(nextFiles, sdk);
    expect(next.status).toBe('ready');
    expect(next.elements.find(item => item.tag === 'button').styles.some(style => style.key === 'muted')).toBe(true);
    expect(typecheckPluginWorkspace(nextFiles, path.resolve('node_modules')).diagnostics).toEqual([]);
    const result = await runPluginWorkspaceTests(nextFiles);
    expect({success: result.success, error: result.error, ...(result.success ? {} : {output: result.output})}).toEqual({success: true, error: null});
});
test('styles a newly inserted component inside the same draft, supports Undo/Redo, and never rewrites CSS', async () => {
    const base = {revision: 'initial', files};
    const render = files => createStaticUiPreview(files, sdk), acceptFiles = files => files;
    let draft = await prepareVisualDraft({base, preview, render, acceptFiles,
        request: {kind: 'insert', component: 'text', elementId: preview.elements.find(item => item.tag === 'main').id}});
    const text = draft.preview.elements.find(item => item.text?.value === 'New text');
    draft = await prepareVisualDraft({base, previous: draft, preview: draft.preview, render, acceptFiles,
        request: {kind: 'style', elementId: text.id, styleFile: '/styles.css', styleKey: 'muted'}});
    expect(draft.preview.elements.find(item => item.id === draft.selectedId).styles[0].key).toBe('muted');
    const styled = draft.files['/render.tsx'];
    expect(draft.files['/styles.css']).toBe(files['/styles.css']);
    const undo = await prepareVisualDraft({base, previous: draft, preview: draft.preview, render, acceptFiles, request: {kind: 'undo'}});
    const redo = await prepareVisualDraft({base, previous: undo, preview: undo.preview, render, acceptFiles, request: {kind: 'redo'}});
    expect(redo.files['/render.tsx']).toBe(styled);
    expect(typecheckPluginWorkspace(redo.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('preserves comments/trailing commas and refuses forged styles, shared calls and computed attribute maps', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace("'data-role': 'run'", "/* keep */ 'data-role': 'run'");
    preview = await createStaticUiPreview(files, sdk);
    const button = preview.elements.find(item => item.tag === 'button');
    expect(assign(button).after).toContain('/* keep */');
    expect(() => planVisualSourceEdit(files, preview.elements, {kind: 'style', elementId: button.id, styleFile: '/styles.css', styleKey: '__proto__'})).toThrow('existing stylesheet class');
    files['/render.tsx'] = files['/render.tsx'].replace('input + button + result', 'input + button + button + result');
    preview = await createStaticUiPreview(files, sdk);
    expect(() => assign(preview.elements.find(item => item.tag === 'button'))).toThrow('unshared attributes');
    files['/render.tsx'] = files['/render.tsx'].replace('input + button + button + result', 'input + button + result').replace("const title =", "const attributes = {class: classFor('muted')};\n  const title =").replace("{class: classFor('muted')}, 'Paste", "attributes, 'Paste");
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    expect(() => assign(preview.elements.find(item => item.tag === 'p'))).toThrow('computed attributes');
});
test('does not offer registration on a helper DOM instance that never emits renderHTML', async () => {
    files['/component.ts'] = `import {DOM} from '@anikitenko/fdo-sdk'; import styles from './styles.css';
export function extra(): string { const dom = new DOM(); return dom.createElement('p', {}, 'Helper text'); }`;
    files['/render.tsx'] = "import {extra} from './component';\n" + files['/render.tsx'].replace('title + intro + content', 'title + intro + content + extra()');
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    expect(preview.elements.find(item => item.text?.value === 'Helper text').styleAssignment).toBeUndefined();
});
test('does not offer styles for markup appended after its DOM instance already emitted HTML', async () => {
    files['/render.tsx'] = files['/render.tsx'].replace('return dom.renderHTML(', 'const rendered = dom.renderHTML(')
        .replace(/\n}\s*$/, `\n  const late = dom.createElement('p', {}, 'Late markup');\n  return rendered + late;\n}\n`);
    preview = await createStaticUiPreview(files, sdk);
    expect(preview.status).toBe('ready');
    expect(preview.elements.find(item => item.text?.value === 'Late markup').styleAssignment).toBeUndefined();
});
