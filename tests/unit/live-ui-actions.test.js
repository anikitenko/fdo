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
const newButton = () => preview.elements.find(item => item.text?.value === 'New button');
const propose = async request => {
    const result = await prepareVisualDraft({base, previous: draft, preview, request, render, acceptFiles: files => files});
    expect(result.status).not.toBe('error');
    preview = result.preview;
    return result;
};
beforeEach(async () => {
    base = {revision: 'initial', files: createPluginTemplateFiles({name: 'action-utility', template: 'utility'})};
    draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
});

test('connecting an existing click action atomically updates binding and button, retains selection and undoes both', async () => {
    const before = {...draft.files};
    expect(newButton().actionConnection.handlers).toEqual([{name: 'run', preventDefault: true}]);
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('New button');
    expect(newButton().actionConnection).toMatchObject({status: 'connected', handler: 'run', editable: true});
    expect(draft.files['/render.tsx']).toContain('"disabled":false');
    expect(draft.files['/render.tsx']).toContain('"data-fdo-action": "visual-action-1"');
    expect(draft.files['/index.ts']).toContain('"selector":"[data-fdo-action=\\"visual-action-1\\"]","event":"click","handler":"run","preventDefault":true,"required":false');
    expect(draft.files['/index.ts'].replace(/, \{"selector":"\[data-fdo-action=.*?"required":false}/, '')).toBe(base.files['/index.ts']);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const connected = {...draft.files};
    draft = await propose({kind: 'undo'});
    expect(draft.files).toEqual(before);
    expect(newButton().actionConnection.status).toBe('available');
    draft = await propose({kind: 'redo'});
    expect(draft.files).toEqual(connected);
    expect(newButton().structure.removable).toBe(false);
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: newButton().id, kind: 'connect-action', handler: 'run'})).toThrow('different click action');
});

test('supports imported API aliases, comments, trailing commas and distinct connections', async () => {
    base.files['/index.ts'] = base.files['/index.ts'].replace('defineRenderOnLoadActions}', 'defineRenderOnLoadActions as actions}').replace('return defineRenderOnLoadActions(', 'return actions(')
        .replace('required: true}]', 'required: true}, /* retained */]');
    draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    expect(draft.files['/index.ts']).toContain('/* retained */');
    expect(draft.files['/index.ts']).toContain('return actions(');
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    const unconnected = preview.elements.find(item => item.actionConnection?.status === 'available');
    draft = await propose({elementId: unconnected.id, kind: 'connect-action', handler: 'run'});
    expect(draft.files['/render.tsx']).toContain('visual-action-2');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test.each([
    ["selector: '[data-role=\"run\"]'", "selector: 'button'"],
    ["bindings: [", "bindings: [...existing, "],
    ['handlers: {', 'handlers: {...existing,'],
    ["event: 'click'", "event: 'keydown'"],
    ['required: true}', 'required: true, stopPropagation: true}'],
    ['renderOnLoad() {', 'async renderOnLoad() {'],
])('unsupported contracts stay read-only: %s', async (from, to) => {
    const files = {...draft.files, '/index.ts': draft.files['/index.ts'].replace(from, to)};
    const result = await render(files);
    expect(result.status).toBe('ready');
    const button = result.elements.find(item => item.text?.value === 'New button');
    expect(button.actionConnection.status).toBe('unavailable');
    expect(() => planVisualSourceEdit(files, result.elements, {elementId: button.id, kind: 'connect-action', handler: 'run'})).toThrow('existing click action');
});

test('rejects forged handlers and protects existing enabled buttons and bindings', () => {
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: newButton().id, kind: 'connect-action', handler: 'unknown'})).toThrow('existing click action');
    const existing = preview.elements.find(item => item.text?.value === 'Inspect JSON');
    expect(existing.actionConnection).toBeUndefined();
    expect(() => planVisualSourceEdit(draft.files, preview.elements, {elementId: existing.id, kind: 'connect-action', handler: 'run'})).toThrow('unconnected button');
});

test('the installed SDK dispatches the new binding to the existing handler exactly once', async () => {
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const vm = require('node:vm'), esbuild = require('esbuild');
    let instance;
    const sandbox = {require: name => name === '@anikitenko/fdo-sdk' ? {...sdk, FDO_SDK: class {constructor() {instance = this;}}} : {}, exports: {}};
    vm.runInNewContext(esbuild.transformSync(draft.files['/index.ts'], {loader: 'ts', format: 'cjs'}).code, sandbox);
    const source = sdk.resolveRenderOnLoadSource(instance.renderOnLoad());
    class Button extends EventTarget {disabled = false;}
    const original = new Button(), connected = new Button();
    const result = {dataset: {}, style: {}, setAttribute: jest.fn(), removeAttribute: jest.fn(), textContent: ''};
    const request = jest.fn(async () => ({result: {message: 'Object with two keys', valid: true}}));
    const document = {
        querySelector: selector => selector === '[data-role="result"]' ? result : {value: '{"a":1,"b":2}'},
        querySelectorAll: selector => selector === '[data-role="run"]' ? [original] : selector === '[data-fdo-action="visual-action-1"]' ? [connected] : [],
    };
    vm.runInNewContext(esbuild.transformSync(source, {loader: 'ts'}).code, {document, window: {createBackendReq: request}, HTMLButtonElement: Button});
    const click = new Event('click', {cancelable: true});
    connected.dispatchEvent(click);
    await new Promise(resolve => setImmediate(resolve));
    expect(click.defaultPrevented).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('UI_MESSAGE', {handler: 'inspectJson', content: {text: '{"a":1,"b":2}'}});
    expect(result.textContent).toBe('Object with two keys');
    expect(connected.disabled).toBe(false);
    expect(original.disabled).toBe(false);
    // A different view can omit only the new optional button without failing
    // the module's pre-existing strict contract.
    expect(() => vm.runInNewContext(esbuild.transformSync(source, {loader: 'ts'}).code, {
        document: {...document, querySelectorAll: selector => selector === '[data-role="run"]' ? [new Button()] : []},
        window: {createBackendReq: request}, HTMLButtonElement: Button,
    })).not.toThrow();
});

test('same-file bindings and markup retain selection through connection and a follow-up text edit', async () => {
    base.files['/index.ts'] = base.files['/index.ts'].replace("import {Render} from './render';", '') + '\n' + base.files['/render.tsx'];
    draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const selected = preview.elements.find(item => item.id === draft.selectedId);
    expect(selected.text.value).toBe('New button');
    expect(selected.actionConnection.status).toBe('connected');
    expect(draft.changedFileCount).toBe(1);
    draft = await propose({elementId: selected.id, kind: 'text', value: 'Inspect again'});
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('Inspect again');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});


const addAlternateAction = () => {
    base.files['/index.ts'] = base.files['/index.ts'].replace('handlers: {', 'handlers: { alternate: ({element}) => { if (element instanceof HTMLElement) element.setAttribute("data-alternate", "yes"); },')
        .replace('bindings: [', `bindings: [{selector: '[data-role="alternate"]', event: 'click', handler: 'alternate', preventDefault: false, required: false}, `);
};
test('rewiring preserves the target and unrelated handler source, and undo restores both files', async () => {
    addAlternateAction(); draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const before = {...draft.files};
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'alternate'});
    expect(newButton().actionConnection).toMatchObject({status: 'connected', handler: 'alternate', editable: true});
    expect(draft.files['/render.tsx']).toContain('"data-fdo-action": "visual-action-1"');
    expect(draft.files['/index.ts']).toContain('"handler":"alternate","preventDefault":false');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    draft = await propose({kind: 'undo'}); expect(draft.files).toEqual(before);
    expect(newButton().actionConnection.handler).toBe('run');
    draft = await propose({kind: 'redo'}); expect(newButton().actionConnection.handler).toBe('alternate');
});

test('disconnect removes only the owned binding and marker, enables removal and preserves exact undo', async () => {
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const before = {...draft.files};
    draft = await propose({elementId: newButton().id, kind: 'disconnect-action'});
    expect(draft.files['/index.ts']).not.toContain('visual-action-1');
    expect(draft.files['/render.tsx']).not.toContain('visual-action-1');
    expect(draft.files['/render.tsx']).toContain('"disabled":true');
    expect(newButton().actionConnection.status).toBe('available');
    expect(newButton().structure.removable).toBe(true);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const after = {...draft.files};
    draft = await propose({kind: 'undo'}); expect(draft.files).toEqual(before);
    expect(preview.elements.find(item => item.id === draft.selectedId).actionConnection.status).toBe('connected');
    draft = await propose({kind: 'redo'}); expect(draft.files).toEqual(after);
    draft = await propose({elementId: newButton().id, kind: 'remove'});
    expect(preview.html).not.toContain('New button');
});

test.each(['reference', 'duplicate-binding', 'custom-options', 'custom-title'])('customized or shared connections remain read-only: %s', async mode => {
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const files = {...draft.files};
    if (mode === 'reference') files['/notes.ts'] = '// Preserve visual-action-1 for another consumer';
    if (mode === 'duplicate-binding') files['/index.ts'] = files['/index.ts'].replace('bindings: [', `bindings: [{selector: '[data-fdo-action="visual-action-1"]', event: 'click', handler: 'run'}, `);
    if (mode === 'custom-options') files['/index.ts'] = files['/index.ts'].replace('"required":false}', '"required":false,"once":true}');
    if (mode === 'custom-title') files['/render.tsx'] = files['/render.tsx'].replace('Connected action: run', 'Custom title');
    const result = await render(files);
    const button = result.elements.find(item => item.text?.value === 'New button');
    expect(button.actionConnection).toMatchObject({status: 'connected', editable: false});
    expect(() => planVisualSourceEdit(files, result.elements, {elementId: button.id, kind: 'disconnect-action'})).toThrow('requires editing');
    expect(() => planVisualSourceEdit(files, result.elements, {elementId: button.id, kind: 'connect-action', handler: 'run'})).toThrow('existing click action');
});


test.each(['first', 'middle', 'last', 'only'])('disconnect preserves comments and valid separators for %s binding', async position => {
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    const files = {...draft.files};
    const {parse} = require('@babel/parser');
    const index = files['/index.ts'];
    const ast = parse(index, {sourceType: 'module', plugins: ['typescript']});
    const plugin = ast.program.body.find(node => node.type === 'ClassDeclaration');
    const call = plugin.body.body.find(node => node.key?.name === 'renderOnLoad').body.body[0].argument;
    const array = call.arguments[0].properties.find(node => node.key?.name === 'bindings').value;
    const owned = index.slice(array.elements.at(-1).start, array.elements.at(-1).end);
    const original = index.slice(array.elements[0].start, array.elements[0].end);
    const extra = `{selector: '[data-role="other"]', event: 'click', handler: 'run', required: false, preventDefault: true}`;
    const nodes = position === 'only' ? [owned] : position === 'first' ? [owned, original] : position === 'middle' ? [original, owned, extra] : [original, owned];
    files['/index.ts'] = index.slice(0, array.start) + '[/* before, retained */ ' + nodes.join(', /* gap, retained */ ') + ', /* trailing, retained */]' + index.slice(array.end);
    files['/render.tsx'] = files['/render.tsx'].replace('"data-fdo-action":', '/* attribute, retained */ "data-fdo-action":');
    preview = await render(files); base = {revision: 'comments', files}; draft = null;
    draft = await propose({elementId: newButton().id, kind: 'disconnect-action'});
    for (const comment of ['before, retained', 'trailing, retained']) expect(draft.files['/index.ts']).toContain(comment);
    expect(draft.files['/render.tsx']).toContain('attribute, retained');
    expect(draft.files['/index.ts']).not.toContain('visual-action-1');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    draft = await propose({kind: 'undo'}); expect(draft.files).toEqual(files);
});

test('same-file disconnect retains selection and can be reconnected without another source model', async () => {
    base.files['/index.ts'] = base.files['/index.ts'].replace("import {Render} from './render';", '') + '\n' + base.files['/render.tsx'];
    draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    draft = await propose({elementId: newButton().id, kind: 'disconnect-action'});
    expect(preview.elements.find(item => item.id === draft.selectedId).text.value).toBe('New button');
    expect(newButton().structure.removable).toBe(true);
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    expect(newButton().actionConnection.editable).toBe(true);
    expect(draft.changedFileCount).toBe(1);
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('installed SDK dispatches only the replacement action and attaches no listener after disconnect', async () => {
    addAlternateAction(); draft = null; preview = await render(base.files);
    draft = await propose({elementId: preview.elements.find(item => item.tag === 'main').id, kind: 'insert', component: 'button'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'run'});
    draft = await propose({elementId: newButton().id, kind: 'connect-action', handler: 'alternate'});
    const boot = files => {
        const vm = require('node:vm'), esbuild = require('esbuild');
        let instance;
        vm.runInNewContext(esbuild.transformSync(files['/index.ts'], {loader: 'ts', format: 'cjs'}).code, {
            require: name => name === '@anikitenko/fdo-sdk' ? {...sdk, FDO_SDK: class {constructor() {instance = this;}}} : {}, exports: {},
        });
        class Button extends EventTarget {attributes = {}; setAttribute(name, value) {this.attributes[name] = value;}}
        const target = new Button(), original = new Button();
        const attach = jest.spyOn(target, 'addEventListener');
        const document = {querySelectorAll: selector => selector === '[data-role="run"]' ? [original] : selector === '[data-fdo-action="visual-action-1"]' ? [target] : []};
        vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()), {loader: 'ts'}).code,
            {document, window: {}, HTMLElement: Button});
        return {target, attach};
    };
    const changed = boot(draft.files);
    const click = new Event('click', {cancelable: true});
    changed.target.dispatchEvent(click);
    expect(changed.attach).toHaveBeenCalledTimes(1);
    expect(changed.target.attributes['data-alternate']).toBe('yes');
    expect(click.defaultPrevented).toBe(false);
    draft = await propose({elementId: newButton().id, kind: 'disconnect-action'});
    expect(boot(draft.files).attach).not.toHaveBeenCalled();
});
