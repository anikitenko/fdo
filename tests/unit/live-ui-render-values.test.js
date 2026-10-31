/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';

const preview = source => createStaticUiPreview({'/index.ts': source}, sdk);

test.each([
    ['Boolean()', false], ['Boolean(undefined)', false], ['Boolean(null)', false], ['Boolean(false)', false],
    ['Boolean(0)', false], ['Boolean(-0)', false], ['Boolean(0/0)', false], ["Boolean('')", false],
    ['Boolean(true)', true], ['Boolean(1)', true], ["Boolean('false')", true], ['Boolean([])', true],
    ['Boolean({})', true], ["Boolean({valueOf:()=>fetch('never')})", true],
])('preview conversion preserves ToBoolean without invoking coercion: %s', async (expression, value) => {
    expect(await preview(`class P {render(){return String(${expression});}}`)).toMatchObject({status:'ready', html:String(value)});
});

test('a locally declared Boolean helper retains its lexical meaning', async () => {
    expect(await preview('function Boolean(value){return !value;} class P {render(){return String(Boolean(true));}}'))
        .toMatchObject({status:'ready',html:'false'});
});

test('optional computed access short-circuits before evaluating the key', async () => {
    expect(await preview("class P {render(){const state=null;return String(state?.[fetch('never')]);}}"))
        .toMatchObject({status:'ready',html:'undefined'});
});

test('rest/spread, collection choices and return-only switch helpers preserve inspectable SDK elements', async () => {
    const files = {'/index.ts': `import {DOM} from '@anikitenko/fdo-sdk';
function escape(value:string) {return value.replace(/[&<>]/g, character=>{switch(character){case '&':return '&amp;';case '<':return '&lt;';default:return '&gt;';}});}
function classes(...values) {return values.filter(value=>Boolean(value)).join(' ');}
function options(items) {return Array.from(new Set(items.map(item=>item))).sort();}
function emptyCount(items) {for(const item of items){return item;}return 0;}
class P {render(){
 const dom=new DOM(), state={};
 const busy=Boolean(state.loading || state.savingConfiguration);
 const choices=options(['GPU B','GPU A','GPU B']);
 return dom.renderHTML(dom.createElement('main',{class:classes('panel',undefined,'ready'),'aria-busy':String(busy)},
  dom.createElement('h1',{},'Availability'),
  dom.createElement('p',{},escape('A&B')),
  dom.createElement('select',{},...choices.map(choice=>dom.createElement('option',{},escape(choice)))),
  dom.createElement('span',{},String(emptyCount([]))),
  dom.createElement('span',{},String((state.snapshot?.items ?? []).length > 0)),
  dom.createElement('span',{},String(300 / 60))));
}}`};
    const result = await createStaticUiPreview(files, sdk);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toContain('aria-busy="false"');
    expect(result.html).toContain('class="panel ready"');
    expect(result.html).toContain('A&amp;B');
    expect(result.html.indexOf('GPU A')).toBeLessThan(result.html.indexOf('GPU B'));
    const title = result.elements.find(element => element.tag === 'h1');
    const edit = planVisualSourceEdit(files, result.elements, {kind:'text',elementId:title.id,value:'Edited availability'});
    expect((await createStaticUiPreview({...files,[edit.file]:edit.after},sdk)).html).toContain('Edited availability');
});

test.each([
    'return String(new Boolean(false));',
    "return String(new Set({values:()=>fetch('never')}));",
    "return Array.from({values:()=>fetch('never')}).join('');",
    "return ['a'].sort(()=>fetch('never')).join('');",
    "return [{toString:()=>fetch('never')}].sort().join('');",
    "return ['a'].filter(()=>fetch('never')).join('');",
    'return [...{}].join();',
    "for(const value of ['one']){fetch('never');}return 'bad';",
])('new adapters keep unsupported execution diagnostic: %s', async source => {
    expect(await preview(`class P {render(){${source}}}`)).toMatchObject({status:'unsupported',html:''});
});

test('local classes cannot be mistaken for intrinsic constructors or Boolean conversion', async () => {
    expect(await preview('class Boolean {} class P {render(){return String(Boolean(false));}}')).toMatchObject({status:'unsupported'});
    expect(await preview('class Set {} class P {render(){return Array.from(new Set([])).join();}}')).toMatchObject({status:'unsupported'});
});

test('repeated set construction charges collection work against the expression budget', async () => {
    const values = '[' + Array(200).fill('0').join(',') + ']';
    expect(await preview(`class P {render(){const values=${values};return values.map(()=>String(Boolean(new Set(values)))).join('');}}`))
        .toMatchObject({status:'unsupported',message:expect.stringContaining('budget')});
});

test('nested array loops still stop at the preview statement budget', async () => {
    const values = '[' + Array(200).fill('0').join(',') + ']';
    expect(await preview(`class P {render(){const values=${values};for(const a of values){for(const b of values){}}return 'bad';}}`))
        .toMatchObject({status:'unsupported',message:expect.stringContaining('budget')});
});
