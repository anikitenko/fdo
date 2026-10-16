/** @jest-environment node */
import fs from 'node:fs';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render=files=>createStaticUiPreview(files,sdk,contract);
let base,draft,preview;
const propose=async request=>{draft=await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});preview=draft.preview;expect(preview.status==='ready' ? null : preview).toBeNull();};
const button=()=>preview.elements.find(item=>item.text?.value==='New button');
beforeEach(async()=>{
    base={revision:'toast-actions',files:createPluginTemplateFiles({name:'toast-actions',template:'blank'})};draft=null;preview=await render(base.files);
    await propose({kind:'insert-sdk-component',component:'fdo.toast-region',elementId:preview.elements.find(item=>item.tag==='main').id});
    await propose({kind:'insert-sdk-slot-component',component:'fdo.toast',slot:'body',elementId:preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region').id});
    await propose({kind:'insert',component:'button',elementId:preview.elements.find(item=>item.tag==='main').id});
});
test('toast connection preserves source selection and supports update/disconnect and exact history',async()=>{
    expect(button().toastAction.targets).toHaveLength(1);
    const before=draft.files;
    await propose({kind:'connect-toast-action',elementId:button().id,regionId:'fdo-toast-region',toastId:'fdo-toast',visible:1,queued:0,duration:0});
    expect(button().toastAction).toMatchObject({editable:true,status:'connected',visible:1,queued:0,duration:0});expect(draft.selectedId).toBe(button().id);
    expect(draft.files['/index.ts']).toBe(before['/index.ts']);
    const connected=draft.files;
    await propose({kind:'undo'});expect(draft.files).toEqual(before);
    await propose({kind:'redo'});expect(draft.files).toEqual(connected);
    await propose({kind:'disconnect-toast-action',elementId:button().id});
    expect(button().toastAction).toMatchObject({editable:true,status:'available'});
    expect(draft.files['/render.tsx']).not.toContain('data-fdo-ui-toast-');
});
test('limits are inherited and locked when another button owns the region queue',async()=>{
    await propose({kind:'connect-toast-action',elementId:button().id,regionId:'fdo-toast-region',toastId:'fdo-toast',visible:1,queued:1,duration:0});
    await propose({kind:'text',elementId:button().id,value:'First toast'});
    await propose({kind:'insert-sdk-slot-component',component:'fdo.toast',slot:'body',elementId:preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region').id});
    await propose({kind:'insert',component:'button',elementId:preview.elements.find(item=>item.tag==='main').id});
    expect(button().toastAction.targets).toMatchObject([{toastId:'fdo-toast-2',visible:1,queued:1,locked:true}]);
    const request={kind:'connect-toast-action',elementId:button().id,regionId:'fdo-toast-region',toastId:'fdo-toast-2',visible:2,queued:1,duration:0};
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,request)).toThrow('consistent queue limits');
    await propose({...request,visible:1});expect(button().toastAction.editable).toBe(true);
});
test('custom controllers and referenced toast identities stay protected',async()=>{
    for(const source of ['export const setup = "mountToastRegion";','export const toast = "fdo-toast";']) {
        const result=await render({...draft.files,'/custom.ts':source}),control=result.elements.find(item=>item.text?.value==='New button');
        expect(control.toastAction.editable && control.toastAction.targets.length>0).toBe(false);
    }
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'connect-toast-action',elementId:button().id,regionId:'fdo-toast-region',toastId:'fdo-toast',visible:1,queued:-1,duration:0})).toThrow('valid, consistent');
});

test('SDK guidance in markdown does not masquerade as custom runtime code',async()=>{
    const result=await render({...draft.files,'/SKILL.md':'Use mountToastRegion with mountToast for custom notification routing.'});
    expect(result.elements.find(item=>item.text?.value==='New button').toastAction.targets).toHaveLength(1);
});

test('buttons inside a Toast Region cannot target that containing region',async()=>{
    const region=preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region');
    await propose({kind:'component-slot',elementId:region.id,slot:'body',component:'button'});
    const current=preview.elements.find(item=>item.sdkComponent?.identity==='fdo.toast-region');
    const childIds=new Set(current.sdkComponent.slots[0].children.map(child=>child.id));
    const nested=preview.elements.find(item=>item.tag==='button' && childIds.has(item.id));
    expect(nested.toastAction.targets).toEqual([]);
});
