/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';

// These sources live in the virtual plugin workspace, not the host filesystem.
const fixture = name => fs.readFileSync(path.join(__dirname,'../fixtures/live-ui-html-interpolation',name),'utf8');
const filesFor = () => ({
    '/index.ts': `import {render} from './render'; class P {render(){return render();}}`,
    '/render.ts': fixture('render-unit.ts.txt'),
    '/styles.css': 'shell {color: #123456;}',
});
const render = files => createStaticUiPreview(files,sdk);

test('interpolated templates, map/join helpers and SDK wrappers retain selectable HTML source ranges', async () => {
    const files = filesFor(), result = await render(files);
    expect(result.status === 'ready' ? null : result).toBeNull();
    expect(result.elements).toHaveLength(10);
    for (const value of ['Azure FinOps','Overview','Resources','Static text','Refresh','Save']) {
        const element = result.elements.find(item=>item.text?.value === value);
        expect(element).toMatchObject({htmlLiteral:true,text:{file:'/render.ts',kind:'html-literal'}});
        expect(files['/render.ts'].slice(element.text.start,element.text.end)).toBe(value);
        expect(result.html).toContain('data-fdo-ui-id="' + element.id + '"');
    }
});

test('a helper argument label edits only its call site, with exact Undo/Redo', async () => {
    const files = filesFor(), preview = await render(files), base={revision:'interpolated',files};
    const save = preview.elements.find(item=>item.text?.value === 'Save');
    expect(save.structure.unique).toBe(false);
    let draft = await prepareVisualDraft({base,preview,request:{kind:'text',elementId:save.id,value:'Save & inspect'},render,acceptFiles:files=>files});
    expect(draft.files['/render.ts']).toContain("button('save','Save &amp; inspect'");
    expect(draft.preview.elements.some(item=>item.text?.value === 'Save & inspect')).toBe(true);
    expect(draft.preview.elements.some(item=>item.text?.value === 'Refresh')).toBe(true);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});

test('static attributes and inline styles remain editable beside class interpolation', async () => {
    const files = filesFor(), preview = await render(files);
    const root = preview.elements.find(item=>item.tag === 'main');
    expect(root.inlineStyle.editable).toBe(true);
    const style = planVisualSourceEdit(files,preview.elements,{kind:'html-inline-style',elementId:root.id,property:'padding',value:'12px'});
    expect(style.after).toContain('class="${cls}" style="padding: 12px"');
    expect((await render({...files,[style.file]:style.after})).elements.find(item=>item.tag==='main').inlineStyle.value).toContain('12px');
    const input = preview.elements.find(item=>item.tag==='input');
    const attribute = planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:input.id,attribute:'placeholder',value:'Find Azure resources'});
    expect((await render({...files,[attribute.file]:attribute.after})).elements.find(item=>item.tag==='input').editableAttributes)
        .toEqual(expect.arrayContaining([expect.objectContaining({name:'placeholder',value:'Find Azure resources'})]));
});

test('concatenated literal markup maps without inventing ranges for transformed or mixed text', async () => {
    const files = {'/index.ts':`const child = '<p>Child</p>'; class P {render(){return '<main>' + child + '</main>';}}`};
    const result = await render(files);
    expect(result.elements.map(item=>item.tag).sort()).toEqual(['main','p']);
    expect(result.elements.find(item=>item.tag==='p').text.value).toBe('Child');
    const mixed = await render({'/index.ts':"const name='World'; class P {render(){return `<p>Hello ${name}</p>`;}}"});
    expect(mixed.elements).toHaveLength(1);
    expect(mixed.elements[0].text).toBeNull();
});

test('attribute and style fragments in another file edit that file without overwriting the template', async () => {
    const files = {
        '/index.ts': fixture('cross-file-attributes.ts.txt'),
        '/attrs.ts':"export const attrs = 'title=\"Original\" style=\"color:red\"';"};
    const preview = await render(files), root = preview.elements[0];
    const attribute = planVisualSourceEdit(files,preview.elements,{kind:'attribute',elementId:root.id,attribute:'title',value:'Updated'});
    expect(attribute.file).toBe('/attrs.ts');
    expect(attribute.after).toContain('title="Updated"');
    const style = planVisualSourceEdit(files,preview.elements,{kind:'html-inline-style',elementId:root.id,property:'color',value:'blue'});
    expect(style.file).toBe('/attrs.ts');
    expect(style.after).toContain('color:blue');
    const changed = await render({...files,[style.file]:style.after});
    expect(changed.elements[0].inlineStyle.value).toContain('blue');
});

test('shared interpolated attributes cannot silently change another element', async () => {
    const files = {
        '/index.ts': fixture('shared-attributes.ts.txt'),
    };
    const preview = await render(files);
    expect(preview.elements).toHaveLength(2);
    for (const element of preview.elements) {
        expect(element.editableAttributes.find(field=>field.name==='title').editable).toBe(false);
        expect(element.inlineStyle.editable).toBe(false);
    }
});

test('a form label caption edits without replacing its nested control or bindings', async () => {
    const files = {'/index.ts':"const cls='scope'; class P {render(){return `<section class=\"${cls}\"><label>Tenant<select id=\"tenant\"><option value=\"one\">One</option></select></label></section>`;}}"};
    const preview = await render(files), label=preview.elements.find(item=>item.tag==='label');
    expect(label.text.value).toBe('Tenant');
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'text',elementId:label.id,value:'Azure tenant'});
    expect(patch.after).toContain('<label>Azure tenant<select id="tenant">');
    expect((await render({...files,[patch.file]:patch.after})).html).toContain('value="one"');
});

test('button captions beside icons are editable while mixed interactive content cannot be duplicated', async () => {
    const files={'/index.ts':"const label='Overview'; class P {render(){return `<main><button id=\"overview\"><i class=\"icon\"></i>${label}<span hidden></span></button><p>Text <button id=\"run\">Run</button></p></main>`;}}"};
    const preview=await render(files), button=preview.elements.find(item=>item.text?.value==='Overview');
    expect(button.text.partial).toBe(true);
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'text',elementId:button.id,value:'Azure overview'});
    expect(patch.after).toContain("label='Azure overview'");
    expect(patch.after).toContain('<i class="icon"></i>${label}<span hidden></span>');
    const paragraph=preview.elements.find(item=>item.tag==='p');
    expect(paragraph.structure.duplicable).not.toBe(true);
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'duplicate',elementId:paragraph.id})).toThrow('without identity or bindings');
});
