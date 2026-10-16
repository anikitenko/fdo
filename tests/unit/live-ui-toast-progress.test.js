/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const filesFor=(extra='')=>({'/index.ts':`import {DOM,createToast} from '@anikitenko/fdo-sdk/ui';class P {render(){const dom=new DOM().collectStylesFrom();return dom.renderHTML(dom.createElement('main',{},createToast(dom,{id:'notice',message:'Keep message',${extra}})));}} export const plugin=new P();`});
const render=files=>createStaticUiPreview(files,sdk,contract);
async function edit(files,operation) {
    const preview=await render(files);expect(preview.status==='ready' ? null : preview).toBeNull();
    const element=preview.elements.find(item=>item.sdkComponent);
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'toast-progress',elementId:element.id,...operation});
    const nextFiles={...files,[patch.file]:patch.after},next=await render(nextFiles);
    expect(next.status==='ready' ? null : next).toBeNull();
    expect(typecheckPluginWorkspace(nextFiles,path.resolve('node_modules')).diagnostics).toEqual([]);
    return {files:nextFiles,preview:next,element:next.elements.find(item=>item.sdkComponent)};
}
test('add, update and remove progress preserve the toast and support no-net-edit add/remove',async()=>{
    const files=filesFor();let result=await edit(files,{action:'add'});
    expect(result.element.sdkComponent.toastProgress).toMatchObject({present:true,value:{label:'Progress',value:null,max:100}});
    expect(result.preview.html).toContain('id="notice-progress"');
    result=await edit(result.files,{action:'update',value:{label:'Upload <safe>',value:0,max:10}});
    expect(result.preview.html).toContain('aria-label="Upload &lt;safe&gt;"');expect(result.preview.html).toContain('value="0"');
    result=await edit(result.files,{action:'update',value:{label:'Upload <safe>',value:5,max:10}});
    expect(result.element.sdkComponent.toastProgress.value.value).toBe(5);
    result=await edit(result.files,{action:'remove'});
    expect(result.files).toEqual(files);expect(result.preview.html).not.toContain('notice-progress');
});
test('updates preserve nested styles, explicit ARIA references, other toast options and comments',async()=>{
    const files=filesFor("/* before */ progress:{label:'Upload',value:80,max:100,/* nested */ ariaLabelledBy:'external-label',ariaDescribedBy:'help',options:{classes:['keep'],style:{'--fdo-ui-progress-color':'red'}}}, /* after */ options:{classes:['toast-keep']},");
    const result=await edit(files,{action:'update',value:{label:'Upload',value:5,max:10}});
    expect(result.files['/index.ts']).toContain("ariaLabelledBy:'external-label',ariaDescribedBy:'help',options:{classes:['keep'],style:{'--fdo-ui-progress-color':'red'}}");
    expect(result.files['/index.ts']).toContain('/* nested */');expect(result.files['/index.ts']).toContain('/* after */');
    expect(result.preview.html).toContain('aria-describedby="help"');
});
test('omitted numeric fields can be added together while retaining an external label',async()=>{
    const result=await edit(filesFor("progress:{ariaLabelledBy:'external'},"),{action:'update',value:{label:'',value:5,max:10}});
    expect(result.element.sdkComponent.toastProgress.value).toEqual({label:'',value:5,max:10});
    expect(result.preview.html).toContain('aria-labelledby="external"');
});
test('each progress operation uses exact Undo/Redo and leaves source untouched until Apply',async()=>{
    const files=filesFor(),base={files,revision:'toast'},preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    let draft=await prepareVisualDraft({base,preview,request:{kind:'toast-progress',action:'add',elementId:element.id},render,acceptFiles:files=>files});
    const saved=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(saved);
});
test('computed fields are retained, while literal fields remain editable',async()=>{
    const files=filesFor("progress:{label:'Upload',value:amount,max:100},");files['/index.ts']=files['/index.ts'].replace('const dom=','const amount=30;const dom=');
    const result=await edit(files,{action:'update',value:{label:'Changed',value:30,max:100}});
    expect(result.files['/index.ts']).toContain('value:amount');
    expect(result.element.sdkComponent.toastProgress.removable).toBe(false);
    expect(()=>planVisualSourceEdit(result.files,result.preview.elements,{kind:'toast-progress',elementId:result.element.id,action:'update',value:{label:'Changed',value:40,max:100}})).toThrow('computed');
});
test('progress consumers, ID references, computed objects and collisions block destructive changes',async()=>{
    for(const consumer of ["export const update='setProgress';","export const child='notice-progress';"]) {
        const files={...filesFor("progress:{label:'Upload',value:20},"),'/consumer.ts':consumer};
        const preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
        expect(element.sdkComponent.toastProgress.removable).toBe(false);
        expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'toast-progress',action:'remove',elementId:element.id})).toThrow('referenced');
    }
    const shared=filesFor('progress:shared,');shared['/index.ts']=shared['/index.ts'].replace('const dom=',"const shared={label:'Upload'};const dom=");
    const preview=await render(shared);expect(preview.elements.find(item=>item.sdkComponent).sdkComponent.toastProgress.editable).toBe(false);
    const collision={...filesFor(),'/consumer.ts':"export const child='notice-progress';"},next=await render(collision),element=next.elements.find(item=>item.sdkComponent);
    expect(()=>planVisualSourceEdit(collision,next.elements,{kind:'toast-progress',action:'add',elementId:element.id})).toThrow('derived progress ID');
});
test.each([{label:'',value:0,max:100},{label:'Upload',value:11,max:10},{label:'Upload',value:-1,max:10},{label:'Upload',value:0,max:0},{label:'Upload',value:NaN,max:10},{label:'Upload',value:null,max:Infinity}])('rejects invalid progress settings %p',async value=>{
    const files=filesFor("progress:{label:'Upload'},"),preview=await render(files),element=preview.elements.find(item=>item.sdkComponent);
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'toast-progress',action:'update',elementId:element.id,value})).toThrow();
});
