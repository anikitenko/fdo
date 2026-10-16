/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const filesFor=(tab=true,body="''",extra='')=>({'/index.ts':`import {DOM,${tab?'createTabs':'createAccordion'}} from '@anikitenko/fdo-sdk/ui';class P {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(dom.createElement('main',{},${tab?'createTabs':'createAccordion'}(dom,{id:'collection',label:'Settings',${extra}items:[{key:'one',${tab?'label':'title'}:'First',body:${body}}, /* comma , retained */ {key:'two',${tab?'label':'title'}:'Second',body:''},]})));}} export const plugin=new P();`});
const render=files=>createStaticUiPreview(files,sdk,contract);
async function edit(files,request) {
    const preview=await render(files);expect(preview.status==='ready' ? null : preview).toBeNull();
    const element=preview.elements.find(item=>item.sdkComponent);
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'component-collection',elementId:element.id,...request});
    const updated={...files,[patch.file]:patch.after};
    const next=await render(updated);expect(next.status==='ready' ? null : next).toBeNull();
    expect(typecheckPluginWorkspace(updated,path.resolve('node_modules')).diagnostics).toEqual([]);
    return {files:updated,element:next.elements.find(item=>item.sdkComponent),preview:next};
}
test.each([true,false])('add, rename, reorder and remove collection items preserve comments, bodies and valid SDK source (tabs=%s)',async tab=>{
    const files=filesFor(tab,"dom.createElement('p',{},'Authored content')");
    let result=await edit(files,{action:'add'});
    expect(result.element.sdkComponent.collection.items.map(item=>item.key)).toEqual(['one','two','item-1']);
    result=await edit(result.files,{key:'item-1',action:'label',value:'<New & label>'});
    expect(result.preview.html).toContain('&lt;New &amp; label&gt;');
    result=await edit(result.files,{key:'item-1',action:'up'});
    expect(result.element.sdkComponent.collection.items.map(item=>item.key)).toEqual(['one','item-1','two']);
    result=await edit(result.files,{key:'item-1',action:'remove'});
    expect(result.files['/index.ts']).toContain('/* comma , retained */');
    expect(result.files['/index.ts']).toContain("dom.createElement('p',{},'Authored content')");
    expect(result.element.sdkComponent.collection.items.map(item=>item.key)).toEqual(['one','two']);
});
test('collection edits support exact draft Undo/Redo without applying source',async()=>{
    const files=filesFor(),base={files,revision:'collection'},preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    let draft=await prepareVisualDraft({base,preview,request:{kind:'component-collection',elementId:element.id,action:'remove',key:'two'},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');expect(draft.selectedId).toBeTruthy();
    const changed=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(changed);
});
test('protects authored content, active/last-enabled tabs and computed collections',async()=>{
    const files=filesFor(true,"dom.createElement('button',{id:'keep'},'Action')","activeKey:'two',"),preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    const run=request=>planVisualSourceEdit(files,preview.elements,{kind:'component-collection',elementId:element.id,...request});
    expect(()=>run({action:'remove',key:'one'})).toThrow('authored content');
    expect(()=>run({action:'remove',key:'two'})).toThrow('referenced elsewhere');
    expect(()=>run({action:'flag',key:'two',value:true})).toThrow('active tab');
    expect(()=>run({action:'label',key:'two',value:'\nInvalid'})).toThrow('one line');
    const disabled=await edit(filesFor(),{action:'flag',key:'two',value:true});
    expect(()=>planVisualSourceEdit(disabled.files,disabled.preview.elements,{kind:'component-collection',elementId:disabled.element.id,action:'flag',key:'one',value:true})).toThrow('enabled tab');
    const shared=filesFor();shared['/index.ts']=shared['/index.ts'].replace("items:[",'items:items,unused:[').replace('const dom=',"const items=[{key:'shared',label:'Shared',body:''}];const dom=");
    const result=await render(shared);expect(result.status).toBe('ready');expect(result.elements.find(item=>item.sdkComponent).sdkComponent.collection).toMatchObject({editable:false});
});
test('accordion open edits atomically select one exclusive section and preserve multiple mode',async()=>{
    let result=await edit(filesFor(false),{action:'flag',key:'one',value:true});
    result=await edit(result.files,{action:'flag',key:'two',value:true});
    expect(result.element.sdkComponent.collection.items.map(row=>row.flag)).toEqual([false,true]);
    let multiple=await edit(filesFor(false,"''",'multiple:true,'),{action:'flag',key:'one',value:true});
    multiple=await edit(multiple.files,{action:'flag',key:'two',value:true});
    expect(multiple.element.sdkComponent.collection.items.map(row=>row.flag)).toEqual([true,true]);
});

test('item removal retains consumers of keys and generated IDs in other files',async()=>{
    for(const consumer of ["export const selected='two';","export const id='collection-tab-two';"]) {
        const files={...filesFor(),'/consumer.ts':consumer},preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
        expect(element.sdkComponent.collection.items[1].removable).toBe(false);
        expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'component-collection',elementId:element.id,key:'two',action:'remove'})).toThrow('referenced elsewhere');
    }
});

async function contentEdit(files,key,request) {
    const preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    const patch=planVisualSourceEdit(files,preview.elements,{elementId:element.id,slot:'item:'+key,...request});
    const updated={...files,[patch.file]:patch.after},next=await render(updated);
    expect(next.status==='ready' ? null : next).toBeNull();
    expect(typecheckPluginWorkspace(updated,path.resolve('node_modules')).diagnostics).toEqual([]);
    return {files:updated,preview:next,element:next.elements.find(item=>item.sdkComponent)};
}
test.each([true,false])('item content supports SDK additions, inspection, duplicate/move/remove and exact history (tabs=%s)',async tab=>{
    const original=filesFor(tab,"dom.createElement('p',{},'Keep first body')");
    let result=await contentEdit(original,'two',{kind:'component-slot',component:'text'});
    expect(result.preview.html).toContain('New text');
    expect(result.element.sdkComponent.collection.items[0].slot.children[0].label).toContain('Keep first body');
    let row=result.element.sdkComponent.collection.items[1];
    expect(row.removable).toBe(false);expect(row.slot.children[0]).toMatchObject({movable:true,duplicable:true,removable:true});
    result=await contentEdit(result.files,'two',{kind:'component-slot',component:'result'});
    row=result.element.sdkComponent.collection.items[1];
    result=await contentEdit(result.files,'two',{kind:'component-slot-arrange',action:'up',childId:row.slot.children[1].id});
    expect(result.element.sdkComponent.collection.items[1].slot.children.map(child=>child.label)).toEqual(['pre · Results appear here','p · New text']);
    row=result.element.sdkComponent.collection.items[1];
    result=await contentEdit(result.files,'two',{kind:'component-slot-arrange',action:'duplicate',childId:row.slot.children[1].id});
    expect(result.element.sdkComponent.collection.items[1].slot.children).toHaveLength(3);
    const base={files:result.files,revision:'item-content'},preview=result.preview;
    const request={kind:'component-slot-arrange',slot:'item:two',childId:result.element.sdkComponent.collection.items[1].slot.children[0].id,action:'remove',elementId:result.element.id};
    let draft=await prepareVisualDraft({base,preview,request,render,acceptFiles:files=>files});const changed=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(base.files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(changed);
    result={files:draft.files,preview:draft.preview,element:draft.preview.elements.find(item=>item.sdkComponent)};
    while(result.element.sdkComponent.collection.items[1].slot.children.length) {
        result=await contentEdit(result.files,'two',{kind:'component-slot-arrange',action:'remove',childId:result.element.sdkComponent.collection.items[1].slot.children[0].id});
    }
    expect(result.element.sdkComponent.collection.items[1].removable).toBe(true);
    result=await edit(result.files,{kind:'component-collection',key:'two',action:'remove'});
    expect(result.files['/index.ts']).toContain("dom.createElement('p',{},'Keep first body')");
    expect(result.files['/index.ts']).toContain('/* comma , retained */');
});

test('opaque fragments, shared variables and action identities remain protected inside item bodies',async()=>{
    let result=await contentEdit(filesFor(true,"'<em>Opaque</em>' + dom.createElement('button',{id:'keep-action',type:'button'},'Run')"),'one',{kind:'component-slot',component:'text'});
    const children=result.element.sdkComponent.collection.items[0].slot.children;
    expect(children[0]).toMatchObject({movable:false,removable:false});
    expect(children[1]).toMatchObject({duplicable:false,removable:false});
    expect(()=>planVisualSourceEdit(result.files,result.preview.elements,{kind:'component-slot-arrange',elementId:result.element.id,slot:'item:one',childId:children[1].id,action:'remove'})).toThrow();
    expect(result.files['/index.ts']).toContain("'<em>Opaque</em>'");
});

test.each([true,false])('transfers content across item boundaries atomically, preserving IDs, comments and exact Undo/Redo (tabs=%s)',async tab=>{
    const files=filesFor(tab,"dom.createElement('button',{id:'run-existing',type:'button'},'Run') + /* retain body comment */ dom.createElement('p',{},'Keep first')");
    const preview=await render(files),element=preview.elements.find(item=>item.sdkComponent),child=element.sdkComponent.collection.items[0].slot.children[0];
    expect(child).toMatchObject({transferable:true,removable:false,duplicable:false});
    const base={revision:'item-transfer',files};
    let draft=await prepareVisualDraft({base,preview,request:{kind:'component-slot-arrange',elementId:element.id,slot:'item:one',childId:child.id,action:'transfer',destinationSlot:'item:two'},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    const current=draft.preview.elements.find(item=>item.sdkComponent),rows=current.sdkComponent.collection.items;
    expect(rows[0].slot.children.map(item=>item.label)).toEqual(['p · Keep first']);
    expect(rows[1].slot.children.map(item=>item.label)).toEqual(['button · Run']);
    expect(draft.files['/index.ts']).toContain('/* retain body comment */');
    expect(draft.files['/index.ts'].match(/run-existing/g)).toHaveLength(1);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const saved=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(saved);
    const transferred=draft.preview.elements.find(item=>item.sdkComponent);
    const back=await contentEdit(draft.files,'two',{kind:'component-slot-arrange',childId:transferred.sdkComponent.collection.items[1].slot.children[0].id,action:'transfer',destinationSlot:'item:one'});
    expect(back.element.sdkComponent.collection.items[0].slot.children.map(item=>item.label)).toEqual(['p · Keep first','button · Run']);
    expect(back.element.sdkComponent.collection.items[1].removable).toBe(true);
});
test('transfer refuses same-item and missing destinations while preserving opaque source',async()=>{
    const files=filesFor(true,"'<em>Opaque</em>' + dom.createElement('p',{},'Inline')"),preview=await render(files),element=preview.elements.find(item=>item.sdkComponent),child=element.sdkComponent.collection.items[0].slot.children[1];
    for(const destinationSlot of ['item:one','item:missing']) expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'component-slot-arrange',elementId:element.id,slot:'item:one',childId:child.id,action:'transfer',destinationSlot})).toThrow('different editable');
    expect(element.sdkComponent.collection.items[0].slot.children[0].transferable).toBe(false);
});

test('default tab selection inserts, updates and removes activeKey without changing keys or bodies',async()=>{
    const files=filesFor(true,"dom.createElement('p',{},'Keep body')");
    let result=await edit(files,{action:'default-tab',value:'two'});
    expect(result.element.sdkComponent.collection).toMatchObject({activeKey:'two',effectiveActiveKey:'two'});
    expect(result.preview.html).toContain('data-fdo-tab="two"');
    result=await edit(result.files,{action:'default-tab',value:'one'});
    expect(result.element.sdkComponent.collection.activeKey).toBe('one');
    result=await edit(result.files,{action:'default-tab',value:''});
    expect(result.element.sdkComponent.collection).toMatchObject({activeKey:null,effectiveActiveKey:'one'});
    expect(result.files).toEqual(files); // A set/reset cycle must leave no net source edit.
});

test('default-tab and exclusive opening edits participate in exact draft Undo/Redo',async()=>{
    const exclusive=filesFor(false);exclusive['/index.ts']=exclusive['/index.ts'].replace("title:'First'","title:'First',open:true");
    for(const [files,operation] of [[filesFor(),{action:'default-tab',value:'two'}],[exclusive,{action:'flag',key:'two',value:true}]]) {
        const preview=await render(files),element=preview.elements.find(item=>item.sdkComponent),base={files,revision:'initial-state'};
        let draft=await prepareVisualDraft({base,preview,request:{kind:'component-collection',elementId:element.id,...operation},render,acceptFiles:files=>files});
        expect(draft.preview.status).toBe('ready');const changed=draft.files;
        draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
        draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(changed);
    }
});

test('resetting default tab retains separator comments, including commas inside comments',async()=>{
    const files=filesFor(true,"''","/* before */ activeKey:'two' /* comma , in comment */, /* after */ ");
    const result=await edit(files,{action:'default-tab',value:''});
    expect(result.files['/index.ts']).toContain('/* before */');expect(result.files['/index.ts']).toContain('/* comma , in comment */');expect(result.files['/index.ts']).toContain('/* after */');
    expect(result.files['/index.ts']).not.toContain('activeKey:');
});

test('default selection refuses disabled/missing keys and computed activeKey, and exclusive opening protects computed peers',async()=>{
    const result=await edit(filesFor(),{action:'flag',key:'two',value:true});
    const run=value=>planVisualSourceEdit(result.files,result.preview.elements,{kind:'component-collection',elementId:result.element.id,action:'default-tab',value});
    for(const value of ['two','missing',{},null]) expect(()=>run(value)).toThrow('enabled tab');
    const shared=filesFor(true,"''","activeKey:chosen,");shared['/index.ts']=shared['/index.ts'].replace('const dom=',"const chosen='two';const dom=");
    const preview=await render(shared),element=preview.elements.find(item=>item.sdkComponent);
    expect(element.sdkComponent.collection.activeTarget.editable).toBe(false);
    expect(()=>planVisualSourceEdit(shared,preview.elements,{kind:'component-collection',elementId:element.id,action:'default-tab',value:'one'})).toThrow('computed');
    const computed=filesFor(false);computed['/index.ts']=computed['/index.ts'].replace("body:''}","body:'',open:chosen}").replace('const dom=','const chosen=true;const dom=');
    const next=await render(computed),root=next.elements.find(item=>item.sdkComponent);
    expect(next.status).toBe('ready');
    expect(()=>planVisualSourceEdit(computed,next.elements,{kind:'component-collection',elementId:root.id,action:'flag',key:'two',value:true})).toThrow('computed state');
});
