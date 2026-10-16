/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render=files=>createStaticUiPreview(files,sdk,contract);
const filesFor=entry=>({'/index.ts':`import {DOM} from '${entry}'; class P {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(dom.createElement('main',{},dom.createElement('p',{},'Keep existing content')));}} export const plugin = new P();`});
test.each(contract.components.map(item=>item.identity))('inserts %s with matching SDK entry, source mapping and reversible history',async component=>{
    const files=filesFor('@anikitenko/fdo-sdk/ui'),base={revision:'insert',files};
    const preview=await render(files),parent=preview.elements.find(item=>item.tag==='main');
    expect(parent.sdkInsertions.map(item=>item.identity)).toContain(component);
    let draft=await prepareVisualDraft({base,preview,request:{kind:'insert-sdk-component',component,elementId:parent.id},render,acceptFiles:files=>files});
    expect(draft.preview.status === 'ready' ? null : draft).toBeNull();
    const selected=draft.preview.elements.find(item=>item.id===draft.selectedId);
    expect(selected.sdkComponent.identity).toBe(component);expect(selected.sdkComponent.appearance.length).toBeGreaterThan(0);
    expect(draft.preview.html).toContain('Keep existing content');
    expect(typecheckPluginWorkspace(draft.files, path.resolve('node_modules')).diagnostics).toEqual([]);
    const created=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).tag).toBe('main');
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(created);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).sdkComponent.identity).toBe(component);
});
test('IDs and import aliases stay unique through repeated additions and existing names',async()=>{
    let files=filesFor('@anikitenko/fdo-sdk');
    files['/index.ts'] += '\nexport const fdoCreateDialog = "fdo-dialog";';
    for(let i=0;i<2;i++) {
        const preview=await render(files),parent=preview.elements.find(item=>item.tag==='main');
        const patch=planVisualSourceEdit(files,preview.elements,{kind:'insert-sdk-component',component:'fdo.dialog',elementId:parent.id});
        files={...files,[patch.file]:patch.after};
    }
    const preview=await render(files),ids=preview.elements.filter(item=>item.sdkComponent).map(item=>item.sdkComponent.instanceId);
    expect(new Set(ids).size).toBe(2);expect(ids).not.toContain('fdo-dialog');
    expect(typecheckPluginWorkspace(files, path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('non-container leaves and unsupported contracts cannot insert SDK components',async()=>{
    const files=filesFor('@anikitenko/fdo-sdk');
    const preview=await createStaticUiPreview(files,sdk,{...contract,contractVersion:'2.0.0'});
    expect(preview.elements.every(item=>!item.sdkInsertions)).toBe(true);
    const supported=await render(files),child=supported.elements.find(item=>item.tag==='p');
    expect(()=>planVisualSourceEdit(files,supported.elements,{kind:'insert-sdk-component',component:'fdo.dialog',elementId:child.id})).toThrow('SDK layout container');
});

test.each(['@anikitenko/fdo-sdk','@anikitenko/fdo-sdk/ui'])('nested layout insertion uses its own SDK receiver and preserves siblings (%s)',async entry=>{
    const files = {'/index.ts':`import {DOM} from '${entry}'; class P {render(){const dom = new DOM().collectStylesFrom(); return dom.renderHTML(dom.createElement('main',{},dom.createElement('section',{'aria-label':'Settings'},dom.createElement('div',{},dom.createElement('p',{},'Keep nested content'))) + dom.createElement('aside',{},'Keep sibling')));}} export const plugin = new P();`};
    const preview = await render(files), parent = preview.elements.find(item=>item.tag==='div');
    expect(parent.sdkInsertions.map(item=>item.identity)).toContain('fdo.dialog');
    const base = {revision:'nested-insert',files};
    let draft = await prepareVisualDraft({base,preview,request:{kind:'insert-sdk-component',component:'fdo.dialog',elementId:parent.id},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).sdkComponent.identity).toBe('fdo.dialog');
    expect(draft.files['/index.ts']).toContain(`from "${entry}"`);
    expect(draft.preview.html).toContain('Keep nested content');
    expect(draft.preview.html).toContain('Keep sibling');
    const {parseFragment,serialize} = require('parse5');
    const tree = parseFragment(draft.preview.html), nodes = [];
    const walk = node=>{nodes.push(node); for(const child of node.childNodes || []) walk(child);};walk(tree);
    const component = nodes.find(node=>node.attrs?.some(attr=>attr.name==='data-fdo-component'));
    expect(component.parentNode.tagName).toBe('div');
    const sibling = nodes.find(node=>node.tagName==='aside');
    expect(serialize(sibling)).toBe('Keep sibling');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const changed = draft.files;
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(files);
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).tag).toBe('div');
    draft = await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});

test.each([
    ['form',"dom.createElement('form',{},CHILD)"],
    ['native dialog',"dom.createElement('dialog',{},CHILD)"],
    ['custom dialog',"dom.createElement('section',{role:'dialog'},CHILD)"],
    ['multi-role dialog',"dom.createElement('section',{role:'alertdialog dialog'},CHILD)"],
    ['native popover',"dom.createElement('section',{popover:'auto'},CHILD)"],
    ['literal wrapper',"'<section>' + CHILD + '</section>'"],
])('insertion cannot cross a protected %s ancestor',async(_label,wrapper)=>{
    const child = "dom.createElement('div',{},'Content')";
    const files = {'/index.ts':`import {DOM} from '@anikitenko/fdo-sdk'; class P {render(){const dom = new DOM();return dom.renderHTML(dom.createElement('main',{},${wrapper.replace('CHILD',child)}));}}`};
    const preview = await render(files), element = preview.elements.find(item=>item.tag==='div');
    expect(preview.status).toBe('ready');
    expect(element.sdkInsertions).toBeUndefined();
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'insert-sdk-component',component:'fdo.dialog',elementId:element.id})).toThrow('SDK layout container');
});

test('repeated/shared layout calls remain protected at every nested level',async()=>{
    const files = {'/index.ts':`import {DOM} from '@anikitenko/fdo-sdk'; class P {render(){const dom = new DOM();const shared = dom.createElement('section',{},dom.createElement('div',{},'Shared'));return dom.renderHTML(dom.createElement('main',{},shared + shared));}}`};
    const preview = await render(files);
    for(const element of preview.elements.filter(item=>['section','div'].includes(item.tag))) expect(element.sdkInsertions).toBeUndefined();
});

test('a different nested DOM owner cannot lose component styles outside the root collector',async()=>{
    const files = {'/index.ts':`import {DOM} from '@anikitenko/fdo-sdk'; class P {render(){const dom = new DOM().collectStylesFrom(); const other = new DOM(); return dom.renderHTML(dom.createElement('main',{},other.createElement('section',{},other.createElement('div',{},'Different owner'))));}}`};
    const preview = await render(files);
    expect(preview.elements.find(item=>item.tag==='main').sdkInsertions).toHaveLength(contract.components.length);
    for (const element of preview.elements.filter(item=>['section','div'].includes(item.tag))) expect(element.sdkInsertions).toBeUndefined();
});

test.each(['@anikitenko/fdo-sdk','@anikitenko/fdo-sdk/ui'])('Toast Region composes distinct editable toasts with reversible drafts (%s)', async entry=>{
    const files={'/index.ts':`import {DOM,createToastRegion} from '${entry}'; class P {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(createToastRegion(dom,{id:'notices',label:'Notifications',body:dom.createElement('p',{},'Keep this')}));}}`};
    const base={revision:'region',files};
    let preview=await render(files),region=preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region');
    expect(region.sdkComponent.slots[0].sdkInsertions.map(item=>item.identity)).toEqual(['fdo.toast']);
    let draft=await prepareVisualDraft({base,preview,request:{kind:'insert-sdk-slot-component',slot:'body',component:'fdo.toast',elementId:region.id},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.preview.elements.find(item=>item.id===draft.selectedId).sdkComponent.identity).toBe('fdo.toast');
    const first=draft.files;
    region=draft.preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region');
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'insert-sdk-slot-component',slot:'body',component:'fdo.toast',elementId:region.id},render,acceptFiles:files=>files});
    const toasts=draft.preview.elements.filter(item=>item.sdkComponent?.identity==='fdo.toast');
    expect(toasts.map(item=>item.sdkComponent.instanceId)).toEqual(['fdo-toast','fdo-toast-2']);
    expect(toasts.every(item=>item.sdkComponent.properties.find(field=>field.name==='message').editable)).toBe(true);
    expect(draft.preview.html).toContain('Keep this');
    expect(draft.files['/index.ts']).toContain(`from "${entry}"`);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const changed=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(first);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(draft.files).toEqual(changed);
});

test('Toast insertion supports absent body but rejects other components, shared options and unsupported contracts',async()=>{
    const source=`import {DOM,createToastRegion} from '@anikitenko/fdo-sdk'; class P {render(){const dom=new DOM();return dom.renderHTML(createToastRegion(dom,{id:'notices',label:'Notifications'}));}}`;
    const files={'/index.ts':source};
    const preview=await render(files),region=preview.elements.find(item=>item.sdkComponent);
    const request={kind:'insert-sdk-slot-component',slot:'body',component:'fdo.toast',elementId:region.id};
    const patch=planVisualSourceEdit(files,preview.elements,request);
    expect((await render({...files,[patch.file]:patch.after})).status).toBe('ready');
    expect(()=>planVisualSourceEdit(files,preview.elements,{...request,component:'fdo.dialog'})).toThrow('Toast Region');
    expect(()=>planVisualSourceEdit(files,preview.elements,{...request,slot:'footer'})).toThrow('Toast Region');
    const shared={'/index.ts':source.replace('class P',"const options={id:'notices',label:'Notifications'}; class P").replace("{id:'notices',label:'Notifications'}));",'options));')};
    const sharedPreview=await render(shared),sharedRegion=sharedPreview.elements.find(item=>item.sdkComponent);
    expect(sharedRegion.sdkComponent.slots[0].sdkInsertions).toBeUndefined();
    expect(()=>planVisualSourceEdit(shared,sharedPreview.elements,{...request,elementId:sharedRegion.id})).toThrow('Toast Region');
    const unknown=await createStaticUiPreview(files,sdk,{...contract,contractVersion:'2.0.0'});
    expect(unknown.elements?.every(item=>!item.sdkComponent?.slots.some(slot=>slot.sdkInsertions))).not.toBe(false);
});
