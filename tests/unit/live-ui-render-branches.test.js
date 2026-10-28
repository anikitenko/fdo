/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import domContract from '@anikitenko/fdo-sdk/dom-authoring-contract.json';
import componentContract from '@anikitenko/fdo-sdk/ui-components.json';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {liveUiWorkspacePayload} from '../../src/utils/plugins/authoring/liveUi/workspaceState';

const files = (css = 'shell { color: red; }') => ({
    '/index.ts': `import {render} from './render'; class Plugin {render(){return render();}}`,
    '/render.ts': `import {DOM, DOMText, DOMInput, DOMSemantic, createInlineAlert} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
const tabs: ReadonlyArray<readonly [string,string]> = [['overview','Overview'],['resources','Resources']];
export function render() {
 const text = new DOMText(), fields = new DOMInput(), sem = new DOMSemantic();
 const dom = new DOM().collectStylesFrom(text, fields, sem);
 if (!styles.shell) return dom.renderHTML(text.createText('Styles unavailable'));
 const button = (id: string, label: string, primary = false) => dom.createElement('button', {id, class: primary ? 'primary' : 'plain'}, text.createText(label));
 const select = (options: Array<readonly [string,string]>) => {
   const control = new DOMInput('tenant', {}, {'aria-label':'Tenant'});
   dom.collectStylesFrom(control);
   return control.createSelect(options.map(([label,value]) => fields.createOption(label,value)));
 };
 const nav = sem.createNav(tabs.map(([id,label]) => button(id,label)), {disableDefaultClass:true});
 return dom.renderHTML(sem.createMain([nav, select([['Tenant One','one']]), createInlineAlert(dom,{id:'message',message:'Ready',variant:'info'})], {classes:[dom.createClassFromStyle(styles.shell)]}));
}`,
    '/styles.css': css,
});
const preview = source => createStaticUiPreview(source, sdk, componentContract, domContract);

test('previews stylesheet guards, tuple helpers and contracted input/semantic/text builders', async () => {
    const result = await preview(files());
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toMatch(/<nav\b/);
    expect(result.html).toContain('Overview');
    expect(result.html).toContain('Resources');
    expect(result.html).toContain('Tenant One');
    expect(result.html).toContain('data-fdo-component="fdo.inline-alert"');
    expect(result.html).not.toContain('Styles unavailable');
});

test('returns from the selected guard without interpreting unreachable work', async () => {
    const source = files('other { color: red; }');
    source['/render.ts'] = source['/render.ts'].replace(' const button =', ' fetch("https://example.invalid"); const button =');
    const result = await preview(source);
    expect(result.status).toBe('ready');
    expect(result.html).toContain('Styles unavailable');
});

test.each([
    ['if (unknownRuntimeState) return "unknown";', "Dynamic value 'unknownRuntimeState'"],
    ['if (true) { fetch("https://example.invalid"); }', 'Preview does not execute ExpressionStatement'],
    ['if (true) { while (true) {} }', 'Preview does not execute WhileStatement'],
    ['if (true) { var leaked = "bad"; }', 'block-scoped declarations'],
])('unsupported branch work remains diagnostic: %s', async (statement, message) => {
    const result = await preview({'/index.ts': `class P {render(){${statement} return "ok";}}`});
    expect(result).toMatchObject({status:'unsupported', message:expect.stringContaining(message)});
});

test('helper availability follows supported contract metadata and unsafe methods remain unavailable', async () => {
    const source = {'/index.ts': `import {DOMInput} from '@anikitenko/fdo-sdk'; class P {render(){return new DOMInput().createInput('text');}}`};
    const hidden = {...domContract, classes: domContract.classes.map(item => item.name === 'DOMInput'
        ? {...item, methods:item.methods.map(method => ({...method, staticPreviewSafe:false}))} : item)};
    expect((await createStaticUiPreview(source, sdk, componentContract, hidden)).status).toBe('unsupported');
    expect((await createStaticUiPreview(source, sdk, componentContract, {...domContract,contractVersion:'99.0.0'})).status).toBe('unsupported');
    const callback = {'/index.ts':`import {DOMInput} from '@anikitenko/fdo-sdk'; class P {render(){return new DOMInput('x', {}, {onclick:()=>fetch('bad')}).createInput('text');}}`};
    expect(await preview(callback)).toMatchObject({status:'unsupported',message:expect.stringContaining('plain data')});
});

test('Live UI publishes the current metadata name while retaining the GitOps workspace identity', () => {
    const workspace = {sandboxName:'gitops_collection_azure-finops', pluginName:'gitops_collection_azure-finops',
        fs:{version:()=>({version:'current'})}, files:{
            '/package.json':{content:JSON.stringify({source:'main.ts',name:'azure-finops'})},
            '/main.ts':{model:{getValue:()=>`class P {get metadata(){return {name:'Azure FinOps & Resource Manager',version:'1',author:'Team',description:'Tools',icon:'cloud'};}}`}},
        }};
    expect(liveUiWorkspacePayload(workspace)).toMatchObject({workspaceId:workspace.sandboxName,name:'Azure FinOps & Resource Manager'});
    workspace.files['/main.ts'].model.getValue = () => 'incomplete source';
    expect(liveUiWorkspacePayload(workspace).name).toBe('azure-finops');
});

test.each([
    ["['overview','settings'].includes('overview')", 'true'],
    ["['overview','settings'].includes('overview',1)", 'false'],
    ['[1,2,3].includes(2,-2)', 'true'],
    ["'Azure FinOps'.includes('Fin')", 'true'],
    ["'Azure FinOps'.includes('Azure',1)", 'false'],
    ["'value123'.includes(123)", 'true'],
])('read-only includes preserves JavaScript membership semantics: %s', async (expression, expected) => {
    const result = await preview({'/index.ts':`class P {render(){return String(${expression});}}`});
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toBe(expected);
});

test.each([
    ["'text'.includes(/text/)", 'primitive search value'],
    ["'text'.includes({toString:()=>fetch('bad')})", 'primitive search value'],
    ["['text'].includes('text',{})", 'numeric start position'],
    ["['text'].some(()=>fetch('bad'))", "Method 'some'"],
])('membership support does not enable coercion hooks or arbitrary callbacks: %s', async (expression, message) => {
    expect(await preview({'/index.ts':`class P {render(){return String(${expression});}}`}))
        .toMatchObject({status:'unsupported',message:expect.stringContaining(message)});
});

test('repeated membership searches count toward the preview budget', async () => {
    const values = '[' + Array(200).fill("'x'").join(',') + ']';
    expect(await preview({'/index.ts':`class P {render(){const values=${values};return values.map(value=>values.includes(value)).join('');}}`}))
        .toMatchObject({status:'unsupported',message:expect.stringContaining('budget exceeded')});
});
