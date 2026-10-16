/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const filesFor = child=>({'/index.ts':`import {DOM} from '@anikitenko/fdo-sdk'; class P {render(){const dom = new DOM();return dom.renderHTML(dom.createElement('main',{},${child}));}} export const plugin = new P();`});
const render = files=>createStaticUiPreview(files,sdk);
const clone = (files,preview,element)=>planVisualSourceEdit(files,preview.elements,{kind:'duplicate',elementId:element.id});

test.each([
    ['p',"dom.createElement('p',{},'Original')"],
    ['pre',"dom.createElement('pre',{role:'status','aria-live':'polite'},'Result')"],
    ['section',"dom.createElement('section',{'aria-label':'New section'},'')"],
    ['button',"dom.createElement('button',{type:'button',disabled:true},'Unconnected')"],
])('duplicates safe inline SDK %s and selects an independent editable source',async(tag,child)=>{
    const files = filesFor(child), preview = await render(files), original = preview.elements.find(item=>item.tag===tag);
    expect(original.structure.duplicable).toBe(true);
    const base = {revision:'sdk-duplicate',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'duplicate',elementId:original.id},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    const copies = draft.preview.elements.filter(item=>item.tag===tag), copy = draft.preview.elements.find(item=>item.id===draft.selectedId);
    expect(copies).toHaveLength(2);
    expect(copy.structure.start).toBe(copies[1].structure.start);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).structure.start).toBe(original.structure.start);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).structure.start).toBe(copy.structure.start);
});

test('the duplicated text can be edited without touching the original or its style registration',async()=>{
    const files = filesFor("dom.createElement('p',{class:cls},'Original')");
    files['/index.ts'] = files['/index.ts'].replace('return dom.renderHTML',"const cls = dom.createClassFromStyle({color:'red'}); return dom.renderHTML");
    const preview = await render(files), original = preview.elements.find(item=>item.tag==='p');
    const patch = clone(files,preview,original), next = {...files,[patch.file]:patch.after};
    const copied = await render(next), copy = copied.elements.filter(item=>item.tag==='p')[1];
    expect(copied.elements.filter(item=>item.tag==='p').map(item=>item.classNames)).toEqual([original.classNames,original.classNames]);
    const edit = planVisualSourceEdit(next,copied.elements,{kind:'text',elementId:copy.id,value:'Independent copy'});
    const result = await render({...next,[edit.file]:edit.after});
    expect(result.elements.filter(item=>item.tag==='p').map(item=>item.text.value)).toEqual(['Original','Independent copy']);
    expect(edit.after).toContain("const cls = dom.createClassFromStyle({color:'red'});");
    expect(result.html).toContain('color:red');
});

test.each([
    "dom.createElement('p',{id:'target'},'Text')",
    "dom.createElement('button',{type:'button'},'Active')",
    "dom.createElement('button',{disabled:true,'data-action':'run'},'Bound')",
    "dom.createElement('p',{'aria-labelledby':'label'},'Referenced')",
    "dom.createElement('section',{},dom.createElement('p',{id:'nested-target'},'Nested'))",
    "dom.createElement('textarea',{},'Value')",
    "dom.createElement('div',{role:'dialog'},'')",
    "dom.createElement('div',{role:'tab'},'Tab')",
    "dom.createElement('div',{role:'menuitemcheckbox'},'Toggle item')",
    "dom.createElement('div',{role:'button'},'Active control')",
    "dom.createElement('script',{},'')",
])('rejects identity, binding, control, populated or executable compositions: %s',async child=>{
    const files = filesFor(child), preview = await render(files), element = preview.elements.find(item=>item.tag!=='main' && item.structure.start===files['/index.ts'].indexOf(child));
    expect(element.structure.duplicable).not.toBe(true);
    expect(()=>clone(files,preview,element)).toThrow('unique inline SDK composition');
});

test('named and repeated source fragments cannot be duplicated as inline independent copies',async()=>{
    for(const expression of ['part','part + part']) {
        const files = filesFor(expression);
        files['/index.ts'] = files['/index.ts'].replace('return dom.renderHTML',"const part = dom.createElement('p',{},'Shared'); return dom.renderHTML");
        const preview = await render(files), element = preview.elements.find(item=>item.tag==='p');
        expect(element.structure.duplicable).not.toBe(true);
        expect(()=>clone(files,preview,element)).toThrow('unique inline SDK composition');
    }
});

test('duplicates an entire SDK card, keeps comments/styles, selects the copy and edits only its nested text',async()=>{
    const card = "dom.createElement('section',{class:cls,'aria-label':'Card'},dom.createElement('h2',{},'Title') + /* keep content separator */ dom.createElement('div',{},dom.createElement('p',{},'Detail') + dom.createElement('button',{type:'button',disabled:true},'Unconnected')))";
    const files = filesFor(card + " + dom.createElement('aside',{},'Unchanged sibling')");
    files['/index.ts'] = files['/index.ts'].replace('return dom.renderHTML',"const cls = dom.createClassFromStyle({color:'red'}); return dom.renderHTML");
    const base = {revision:'card-copy',files}, preview = await render(files), original = preview.elements.find(item=>item.tag==='section');
    expect(original.structure.duplicable).toBe(true);
    expect(original.structure.duplicateElementCount).toBe(5);
    expect(original.structure.removable).toBe(false);
    let draft = await prepareVisualDraft({base,preview,request:{kind:'duplicate',elementId:original.id},render,acceptFiles:files=>files});
    const sections = draft.preview.elements.filter(item=>item.tag==='section');
    expect(sections).toHaveLength(2);
    expect(draft.selectedId).toBe(sections[1].id);
    expect(draft.files['/index.ts'].split('/* keep content separator */')).toHaveLength(3);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const copied = draft.files;
    const paragraphs = draft.preview.elements.filter(item=>item.tag==='p');
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'text',elementId:paragraphs[1].id,value:'Copy detail'},render,acceptFiles:files=>files});
    expect(draft.preview.elements.filter(item=>item.tag==='p').map(item=>item.text.value)).toEqual(['Detail','Copy detail']);
    expect(draft.preview.html).toContain('color:red');
    expect(draft.preview.elements.find(item=>item.tag==='aside').text.value).toBe('Unchanged sibling');
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(copied);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    expect(draft.selectedId).toBe(original.id);
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(copied);
    expect(draft.selectedId).toBe(draft.preview.elements.filter(item=>item.tag==='section')[1].id);
});

test.each([
    "dom.createElement('p',{id:'target'},'Referenced')",
    "dom.createElement('p',{'aria-labelledby':'label'},'Referenced')",
    "dom.createElement('button',{disabled:true,'data-action':'run'},'Bound')",
    "dom.createElement('button',{type:'button'},'Active')",
    "dom.createElement('input',{name:'value'},'')",
    "dom.createElement('div',{role:'dialog'},'')",
    "'<button id=\"hidden\">Raw content</button>'",
    "named",
])('rejects a populated SDK container with unsafe/opaque descendant: %s',async child=>{
    const expression = "dom.createElement('section',{}," + child + ")";
    const files = filesFor(expression);
    if(child==='named') files['/index.ts'] = files['/index.ts'].replace('return dom.renderHTML',"const named = dom.createElement('p',{},'Shared named markup'); return dom.renderHTML");
    const preview = await render(files), root = preview.elements.find(item=>item.tag==='section');
    expect(root.structure.duplicable).toBe(false);
    expect(root.structure.duplicateReason).toBeTruthy();
    expect(()=>clone(files,preview,root)).toThrow('unique inline SDK composition');
});
