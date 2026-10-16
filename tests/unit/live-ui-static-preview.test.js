/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {PLUGIN_TEMPLATES} from '../../src/utils/plugins/authoring/pluginTemplateCatalog';
import {pickLiveUiSources, liveUiWorkspacePayload} from '../../src/utils/plugins/authoring/liveUi/workspaceState';

test.each(PLUGIN_TEMPLATES.map(template => template.value))('previews the real %s template with installed SDK CSS and escaped text', async template => {
    const files = createPluginTemplateFiles({name: 'preview', displayName: 'Preview <Team>', template});
    const result = await createStaticUiPreview(files, sdk);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toContain('Preview &lt;Team&gt;');
    expect(result.html).toContain('#101820');
    expect(result.html).toContain('<style');
});

test('does not execute module initialization, constructors, init or backend handlers', async () => {
    const files = createPluginTemplateFiles({name: 'preview'});
    files['/index.ts'] = files['/index.ts'].replace('init(): void {', 'init(): void { throw new Error("must not execute");');
    files['/index.ts'] += '\nthrow new Error("module init must not execute");\nfetch("https://example.invalid");';
    expect((await createStaticUiPreview(files, sdk)).status).toBe('ready');
});

test('isolates SDK 1.6 collectors across helpers, cached markup and concurrent previews without draining legacy styles', async () => {
    const files = color => ({'/index.ts': `import {DOM, DOMText} from '@anikitenko/fdo-sdk';
class Plugin { render() {
 const text = new DOMText(); const dom = new DOM().collectStylesFrom(text);
 const content = text.createPText('Owned', {style: {color: '${color}'}});
 const cached = dom.renderHTML(content);
 return cached + dom.renderHTML(content);
} }`});
    const legacy = new sdk.DOM();
    legacy.createClassFromStyle({'--legacy-poison': 'yes'});
    try {
        const [a, b] = await Promise.all([createStaticUiPreview(files('#112233'), sdk), createStaticUiPreview(files('#445566'), sdk)]);
        expect(a.status).toBe('ready'); expect(b.status).toBe('ready');
        expect(a.html).toContain('#112233'); expect(a.html).not.toContain('#445566');
        expect(b.html).toContain('#445566'); expect(b.html).not.toContain('#112233');
        expect(a.html + b.html).not.toContain('--legacy-poison');
        expect(legacy.renderHTML('')).toContain('--legacy-poison');
    } finally {legacy.renderHTML('');}
});

test('collectors reject arbitrary inputs and SDK component calls remain diagnostic without being executed', async () => {
    const bad = await createStaticUiPreview({'/index.ts': `import {DOM} from '@anikitenko/fdo-sdk'; class P {render(){const dom = new DOM(); dom.collectStylesFrom({}); return dom.renderHTML('');}}`}, sdk);
    expect(bad).toMatchObject({status: 'unsupported', message: expect.stringContaining('preview-owned')});
    const createDialog = jest.fn(() => {throw new Error('must not execute');});
    const component = await createStaticUiPreview({'/index.ts': `import {DOM,createDialog} from '@anikitenko/fdo-sdk/ui'; class P {render(){const dom = new DOM().collectStylesFrom(); return dom.renderHTML(createDialog(dom,{id:'x',title:'Title'}));}}`}, {...sdk, createDialog});
    expect(component).toMatchObject({status: 'unsupported', message: expect.stringContaining('dedicated Live UI source adapter')});
    expect(createDialog).not.toHaveBeenCalled();
});

test.each([
    'return fetch("https://example.invalid");',
    'while (true) {}',
    'return dom.constructor.constructor("return process")();',
    'return String.prototype;',
    'return "hello".replace(/(a+)+$/, "x");',
])('unsupported code is diagnostic instead of executed: %s', async source => {
    const result = await createStaticUiPreview({'/index.ts': `class Plugin { render() { ${source} } }`}, sdk);
    expect(result).toMatchObject({status: 'unsupported', html: '', location: {path: '/index.ts'}});
    expect(result.message).toBeTruthy();
});

test('recursive helpers stop within the preview expression budget', async () => {
    const result = await createStaticUiPreview({'/index.ts': 'function recurse() { return recurse(); } class Plugin { render() { return recurse(); } }'}, sdk);
    expect(result.status).toBe('unsupported');
    expect(result.message).toMatch(/depth/);
});

test('large joined output is rejected before expanding it into an HTML string', async () => {
    const source = `class Plugin { render() { const part = ${JSON.stringify('x'.repeat(600))}; const parts = [${Array(1000).fill('part').join(',')}]; return parts.join(''); } }`;
    const result = await createStaticUiPreview({'/index.ts': source}, sdk);
    expect(result.status).toBe('unsupported');
    expect(result.message).toMatch(/exceeds 500 KB/);
});

test('workspace publication uses current source models and skips dependency/build models', () => {
    const getValue = jest.fn(() => 'current');
    const workspace = {sandboxName: 'sandbox_a', pluginName: 'a', fs: {version: () => ({version: 'blue'})}, files: {
        '/index.ts': {model: {getValue}, content: 'old'},
        '/styles.css': {content: '.panel {}'},
        '/node_modules/a.js': {model: {getValue: () => {throw new Error('Do not touch dependencies');}}},
        '/dist/index.cjs': {content: 'compiled'},
    }};
    expect(liveUiWorkspacePayload(workspace)).toEqual({workspaceId: 'sandbox_a', name: 'a', snapshot: 'blue', files: {'/index.ts': 'current', '/styles.css': '.panel {}'}});
    expect(pickLiveUiSources({'/../a.ts': 'bad', '/README.md': 'text'})).toEqual({});
});
