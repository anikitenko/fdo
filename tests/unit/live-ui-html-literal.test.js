/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const render = files => createStaticUiPreview(files,sdk);
const filesFor = source => ({'/index.ts':`class Plugin {render(){return ${source};}}`});
const inspectorFiles = () => ({
    '/index.ts':`import {Render} from './render'; class Plugin {render(){return Render().replace('data-inspect class="pure-button pure-button-primary" type="submit"','data-inspect class="pure-button pure-button-primary" type="button"');} init(){throw new Error('must not execute');}}`,
    '/render.tsx':fs.readFileSync(path.join(__dirname,'../fixtures/live-ui-html-literal/render.tsx'),'utf8'),
});
test('the JSON inspector literal HTML has a selectable tree and exact source locations after render replacement', async () => {
    const files = inspectorFiles();
    const result = await render(files);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.elements.length).toBeGreaterThan(20);
    const heading = result.elements.find(item => item.tag === 'h1');
    expect(heading).toMatchObject({htmlLiteral:true,text:{value:'JSON Inspector',kind:'html-literal'},location:{path:'/render.tsx'},structure:{removable:false}});
    expect(files['/render.tsx'].slice(heading.structure.start,heading.structure.end)).toBe('<h1>JSON Inspector</h1>');
    const button = result.elements.find(item => item.tag === 'button');
    expect(button.text.value).toBe('Inspect JSON');
    expect(result.html).toMatch(/data-inspect class="pure-button pure-button-primary" type="button"/);
    expect(result.elements.filter(item => ['style','script'].includes(item.tag))).toHaveLength(0);
    expect(result.elements.some(item => item.tag === 'textarea')).toBe(true);
});
test('literal HTML text preserves JS syntax, entities and exact Undo/Redo without changing bindings or CSS', async () => {
    const files = inspectorFiles(), preview = await render(files), base = {revision:'literal-base',files};
    const heading = preview.elements.find(item => item.tag === 'h1');
    const value = 'A & <B> ` ${process.exit()} \\ "quoted"';
    let draft = await prepareVisualDraft({base,preview,request:{kind:'text',elementId:heading.id,value},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.preview.elements.find(item => item.tag === 'h1').text.value).toBe(value);
    expect(draft.files['/index.ts']).toBe(files['/index.ts']);
    expect(draft.files['/render.tsx'].replace(/<h1>[\s\S]*?<\/h1>/,'<h1>JSON Inspector</h1>')).toBe(files['/render.tsx']);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});
test('transformed text and repeated source calls do not acquire invented writable ranges', async () => {
    const transformed = await render(filesFor("'<main><h1>Original</h1></main>'.replace('Original','Changed')"));
    expect(transformed.status).toBe('ready');
    expect(transformed.elements.find(item => item.tag === 'h1').text).toBeNull();
    const files = {'/index.ts':"function chunk(){return '<p>Repeated</p>';} class Plugin {render(){return chunk().replace('Repeated','Repeated');}}"};
    const result = await render(files);
    expect(result.status).toBe('ready');
    // No-op replacements can conservatively lose provenance, but never invent it.
    expect(result.elements.every(item => !item.text || files[item.text.file].slice(item.text.start,item.text.end) === 'Repeated')).toBe(true);
});
test('escaped/interpolated literals, mixed text and protected layout remain conservative', async () => {
    const escaped = await render(filesFor("'<main>\\n<h1>Escaped</h1></main>'"));
    expect(escaped.elements).toHaveLength(0);
    const files = filesFor('`<main><p>Text <em>nested</em></p></main>`');
    const result = await render(files);
    const paragraph = result.elements.find(item => item.tag === 'p');
    expect(paragraph.text).toBeNull();
    expect(() => planVisualSourceEdit(files,result.elements,{kind:'remove',elementId:paragraph.id})).toThrow('Literal HTML');
    expect(() => planVisualSourceEdit(files,result.elements,{kind:'text',elementId:paragraph.id,value:'Wrong'})).toThrow('computed');
});

test('multiline text edits remain valid inside a quoted HTML string', async () => {
    const files = filesFor("'<main><p>First</p></main>'");
    const preview = await render(files), paragraph = preview.elements.find(item=>item.tag==='p');
    const edit = planVisualSourceEdit(files,preview.elements,{kind:'text',elementId:paragraph.id,value:'One\nTwo\tThree'});
    const result = await render({...files,[edit.file]:edit.after});
    expect(result.status).toBe('ready');
    expect(result.elements.find(item=>item.tag==='p').text.value).toBe('One\nTwo\tThree');
});

test.each([
    '`<main><textarea id="source" placeholder="Original &amp; hint"></textarea></main>`',
    "'<main><textarea id=source placeholder=Original></textarea></main>'",
    '"<main><textarea id=source placeholder=Original></textarea></main>"',
])('HTML attribute set/add/remove preserve the enclosing JS literal: %s', async source => {
    const files = filesFor(source), preview = await render(files);
    const textarea = preview.elements.find(item=>item.tag==='textarea');
    expect(textarea.editableAttributes.find(item=>item.name==='placeholder').editable).toBe(true);
    const value = 'Paste "quoted" & <JSON> ` ${example} \\ here';
    const edit = planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:textarea.id,attribute:'placeholder',value});
    let currentFiles = {...files,[edit.file]:edit.after};
    let result = await render(currentFiles);
    expect(result.status === 'ready' ? null : result).toBeNull();
    let target = result.elements.find(item=>item.tag==='textarea');
    expect(target.editableAttributes.find(item=>item.name==='placeholder').value).toBe(value);
    const add = planVisualSourceEdit(currentFiles,result.elements,{kind:'attribute',elementId:target.id,attribute:'aria-label',value:'JSON source'});
    currentFiles = {...currentFiles,[add.file]:add.after}; result = await render(currentFiles);
    target = result.elements.find(item=>item.tag==='textarea');
    expect(target.editableAttributes.find(item=>item.name==='aria-label')).toMatchObject({value:'JSON source',present:true,editable:true});
    const remove = planVisualSourceEdit(currentFiles,result.elements,{kind:'attribute',elementId:target.id,attribute:'placeholder',action:'remove'});
    result = await render({...currentFiles,[remove.file]:remove.after});
    expect(result.elements.find(item=>item.tag==='textarea').editableAttributes.find(item=>item.name==='placeholder').present).toBe(false);
    expect(remove.after).toContain('id=');
});

test('HTML attribute edits share exact draft Undo/Redo and keep form identities/CSS unchanged', async () => {
    const files = inspectorFiles(), preview = await render(files), base = {revision:'attributes',files};
    const textarea = preview.elements.find(item=>item.tag==='textarea');
    let draft = await prepareVisualDraft({base,preview,request:{kind:'attribute',elementId:textarea.id,attribute:'placeholder',value:'Paste a config'},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.files['/index.ts']).toBe(files['/index.ts']);
    expect(draft.files['/render.tsx']).toContain('id="json-source" aria-describedby="json-editor-hint"');
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    for (const attribute of ['id','class','style','onclick','data-inspect','aria-describedby']) expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:textarea.id,attribute,value:'changed'})).toThrow('supported literal attribute');
});

test('transformed/duplicate HTML start tags are read-only and empty attributes remain distinct from absent', async () => {
    const files = inspectorFiles(), preview = await render(files);
    const button = preview.elements.find(item=>item.tag==='button');
    expect(button.editableAttributes.every(item=>!item.editable)).toBe(true);
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:button.id,attribute:'title',value:'Changed'})).toThrow('supported literal attribute');
    // Intentionally malformed HTML: duplicate attributes must remain read-only.
    const duplicate = await render(filesFor(/* language=TEXT */ '`<main><p title="first" title="second">Text</p></main>`'));
    expect(duplicate.elements.find(item=>item.tag==='p').editableAttributes.every(item=>!item.editable)).toBe(true);
    const emptyFiles = filesFor('`<main><p title="">Text</p></main>`'), empty = await render(emptyFiles);
    const paragraph = empty.elements.find(item=>item.tag==='p');
    expect(paragraph.editableAttributes.find(item=>item.name==='title')).toMatchObject({present:true,value:'',editable:true});
    expect(()=>planVisualSourceEdit(emptyFiles,empty.elements,{kind:'attribute',elementId:paragraph.id,attribute:'aria-label',value:'bad\nvalue'})).toThrow('one line');
    const remove = planVisualSourceEdit(emptyFiles,empty.elements,{kind:'attribute',elementId:paragraph.id,attribute:'title',action:'remove'});
    const removed = await render({...emptyFiles,[remove.file]:remove.after});
    expect(removed.elements.find(item=>item.tag==='p').editableAttributes.find(item=>item.name==='title').present).toBe(false);
});

test.each(['`<main><input placeholder=first/></main>`','`<main><input placeholder="first"/></main>`'])('inserting attributes preserves slash semantics: %s', async source => {
    const files = filesFor(source), preview = await render(files);
    const input = preview.elements.find(item=>item.tag==='input');
    const expected = source.includes('=first/') ? 'first/' : 'first';
    expect(input.editableAttributes.find(item=>item.name==='placeholder').value).toBe(expected);
    const {parseFragment} = require('parse5');
    const findInput = html => parseFragment(html).childNodes[0].childNodes.find(node=>node.tagName==='input');
    expect(findInput(preview.html).attrs.find(item=>item.name==='placeholder').value).toBe(expected);
    const edit = planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:input.id,attribute:'aria-label',value:'JSON'});
    const updated = await render({...files,[edit.file]:edit.after});
    expect(findInput(updated.html).attrs.find(item=>item.name==='placeholder').value).toBe(expected);
    expect(findInput(updated.html).attrs.find(item=>item.name==='aria-label').value).toBe('JSON');
});
