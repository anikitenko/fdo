/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {previewRegExp, replacePreviewString} from '../../src/utils/plugins/authoring/liveUi/stringPreview';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
const reject = message => {throw new Error(message);};
const replace = (input, search, replacement, all = false) => replacePreviewString(input,search,replacement,{all,reject,invoke:jest.fn(),tick:jest.fn()});

test.each([
    ['aaa','a','x',false], ['aaa','a','x',true], ['abc','','-',false], ['abc','','-',true],
    ['abc','missing','x',true], ['aaaa','aa','x',true], ['','', '$&$$',true],
    ['aabaa','b',"$`/$&/$'/$$/$1/$<name>",false], ['aaaa','a',"$`$&$'$$",true],
    ['aAa', /a/gi, 'X',false], ['a\nb\nc', /\r?\n/g,' ',false],
    ['a  b\tc', /\s+/g,'-',true], ['a😀b', new RegExp('', 'gu'),'-',false],
    ['a😀b', '', '-',true], ['abc', /^/g,'-',false], ['abc', /$/g,'-',false],
])('replacement matches native semantics for %p / %p', (input, search, replacement, all) => {
    // The empty regex is represented by native /(?:)/ for this low-level Unicode
    // advancement case; source-level grouping remains unsupported below.
    const expected = all ? input.replaceAll(search,replacement) : input.replace(search,replacement);
    expect(replace(input,search,replacement,all)).toBe(expected);
});

test.each(['&','[&<>"\']','[a-z]','\\[word\\]','hello','\\s+','^\\s+','[\\r\\n]+','\\r?\\n',''])('admits bounded pattern %s', pattern => {
    expect(previewRegExp(pattern,'g',reject)).toBeInstanceOf(RegExp);
});
test.each(['(a+)+$','a*','(word)','(?=a)','a|b','\\1','\\s+$','^\\s+|\\s+$','[a-z]+','a{1000000}'])('rejects unaudited pattern %s before regex execution', pattern => {
    expect(() => previewRegExp(pattern,'g',reject)).toThrow('preview adapter');
});
test('invalid flags/patterns, coercion objects and non-global replaceAll are rejected', () => {
    expect(() => previewRegExp('a','v',reject)).toThrow('flags');
    expect(() => previewRegExp('a','gg',reject)).toThrow('not valid');
    expect(() => previewRegExp('[','g',reject)).toThrow('not closed');
    expect(() => previewRegExp('a'.repeat(129),'g',reject)).toThrow('128');
    expect(() => replace('abc',{},'x')).toThrow('string or supported');
    expect(() => replace('abc','a',{})).toThrow('string replacement');
    expect(() => replace('abc',/a/,'x',true)).toThrow('global');
});
test('expanding replacement tokens stop before joining an oversized output', () => {
    expect(() => replace('x'.repeat(2000),'x',"$'",true)).toThrow('500 KB');
});

const filesFor = expression => ({'/index.ts':`class Plugin {render(){return ${expression};}}`});
test.each([
    [`'&"<>'.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`, '&amp;&quot;&lt;&gt;'],
    [`'x_x'.replaceAll('_', '<p>safe static text</p>')`, 'x<p>safe static text</p>x'],
    [`'a a'.replace(/a/g,(match,index,whole)=>String(index)+match+whole)`, '0aa a 2aa a'],
])('restricted interpreter supports replacement: %s', async (expression, expected) => {
    const result = await createStaticUiPreview(filesFor(expression),sdk);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toBe(expected);
});
test('replacement callbacks remain interpreted and cannot access network/process/SDK instances', async () => {
    for (const expression of [`'x'.replace('x',()=>fetch('https://example.invalid'))`, `'x'.replace('x',()=>({text:'unsafe'}))`, `'x'.replace('x',()=>process.exit())`]) {
        const result = await createStaticUiPreview(filesFor(expression),sdk);
        expect(result.status).toBe('unsupported');
        expect(result.html).toBe('');
        expect(result.location.path).toBe('/index.ts');
    }
});
test('per-match budget stops empty-output callbacks as well as large replacement output', async () => {
    const result = await createStaticUiPreview(filesFor(`${JSON.stringify('a'.repeat(10000))}.replace(/a/g,()=> '')`),sdk);
    expect(result.status).toBe('unsupported');
    expect(result.message).toMatch(/budget/);
});
test('literal placeholder replacement retains nested SDK elements and their source mapping', async () => {
    const {planVisualSourceEdit} = require('../../src/utils/plugins/authoring/liveUi/sourceEdits');
    const files = {'/index.ts':`import {DOM} from '@anikitenko/fdo-sdk';
function escapeText(value:string) {return value.replace(/&/g,'&amp;').replace(/</g,'&lt;');}
class Plugin {render(){const dom = new DOM(); const title = dom.createElement('h1',{},'Mapped title'); return dom.renderHTML('<main>__CONTENT__</main>'.replace('__CONTENT__', title + escapeText('A&B')));}}`};
    const result = await createStaticUiPreview(files,sdk);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.html).toContain('A&amp;B');
    const title = result.elements.find(item => item.tag === 'h1');
    expect(title.structure.unique).toBe(true);
    const edit = planVisualSourceEdit(files,result.elements,{kind:'text',elementId:title.id,value:'Changed title'});
    const updated = await createStaticUiPreview({...files,[edit.file]:edit.after},sdk);
    expect(updated.html).toContain('Changed title'); expect(updated.html).toContain('A&amp;B');
});
