/** @jest-environment node */
import fs from 'node:fs';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render=files=>createStaticUiPreview(files,sdk,contract);
async function fixture() {
    let files=createPluginTemplateFiles({name:'opener-test',template:'blank'});
    for(const component of ['fdo.dialog','fdo.popover','fdo.confirmation-dialog','button']) {
        const preview=await render(files),parent=preview.elements.find(e=>e.tag==='main');
        const patch=planVisualSourceEdit(files,preview.elements,{kind:component==='button' ? 'insert' : 'insert-sdk-component',elementId:parent.id,component});
        files={...files,[patch.file]:patch.after};
    }
    return files;
}
const buttonOf=preview=>preview.elements.find(e=>e.text?.value==='New button');
async function change(files,request) {const preview=await render(files),button=buttonOf(preview);const patch=planVisualSourceEdit(files,preview.elements,{elementId:button.id,...request});return {...files,[patch.file]:patch.after};}
test('connect, retarget and disconnect preserve existing setup, handlers, content and test files',async()=>{
    const files=await fixture(),preview=await render(files),button=buttonOf(preview);
    expect(button.overlayOpener.targets.map(t=>t.identity)).toEqual(['fdo.dialog','fdo.popover','fdo.confirmation-dialog']);
    const dialog=button.overlayOpener.targets[0],popover=button.overlayOpener.targets[1];
    const connected=await change(files,{kind:'connect-overlay-opener',targetId:dialog.id});
    const state=buttonOf(await render(connected)).overlayOpener;
    expect(state).toMatchObject({editable:true,status:'connected',targetId:dialog.id});
    expect((await render(connected)).html).toContain('aria-haspopup="dialog"');
    expect(connected['/index.ts']).toBe(files['/index.ts']);
    const retargeted=await change(connected,{kind:'connect-overlay-opener',targetId:popover.id});
    expect(buttonOf(await render(retargeted)).overlayOpener).toMatchObject({editable:true,targetId:popover.id});
    const restored=await change(retargeted,{kind:'disconnect-overlay-opener'});
    expect(buttonOf(await render(restored)).overlayOpener).toMatchObject({status:'available',editable:true});
    expect(restored['/render.tsx']).not.toContain('data-fdo-ui-open');
    expect(restored['/index.ts']).toBe(files['/index.ts']);
});
test('opener changes retain button selection and support exact Undo/Redo',async()=>{
    const files=await fixture(),base={revision:'opener',files},preview=await render(files),button=buttonOf(preview);
    let draft=await prepareVisualDraft({base,preview,request:{kind:'connect-overlay-opener',elementId:button.id,targetId:button.overlayOpener.targets[0].id},render,acceptFiles:files=>files});
    expect(draft.preview.elements.find(e=>e.id===draft.selectedId).tag).toBe('button');
    const connected=draft.files;
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(connected);
});
test('custom mounting and referenced targets stay protected; confirmation requires an explicit outcome',async()=>{
    const files=await fixture();
    await expect(change(files,{kind:'connect-overlay-opener',targetId:'fdo-confirmation-dialog'})).rejects.toThrow('supported confirmation result');
    files['/custom.ts']='export const setup = "mountDialog";';
    expect(buttonOf(await render(files)).overlayOpener).toMatchObject({editable:false,reason:expect.stringContaining('Custom wiring')});
});

test('confirmation creates explicit text outcome and supports atomic undo, retarget and disconnect',async()=>{
    let files=await fixture(),preview=await render(files);
    const insert=planVisualSourceEdit(files,preview.elements,{kind:'insert',component:'result',elementId:preview.elements.find(item=>item.tag==='main').id});
    files={...files,[insert.file]:insert.after};preview=await render(files);
    const button=buttonOf(preview),base={revision:'confirmation',files};
    const result=button.overlayOpener.resultTargets.find(item=>item.label.startsWith('pre'));
    let draft=await prepareVisualDraft({base,preview,request:{kind:'connect-overlay-opener',elementId:button.id,targetId:'fdo-confirmation-dialog',confirmTargetId:result.id,confirmText:'<confirmed> & safe'},render,acceptFiles:files=>files});
    const connected=draft.files,control=buttonOf(draft.preview);
    expect(draft.selectedId).toBe(control.id);
    expect(control.overlayOpener).toMatchObject({editable:true,status:'connected',confirmation:{targetId:result.id,text:'<confirmed> & safe'}});
    expect(connected['/index.ts']).toBe(files['/index.ts']);
    expect(draft.preview.html).toContain('data-fdo-ui-confirm-text="&lt;confirmed&gt; &amp; safe"');
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'redo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(connected);
    files=await change(draft.files,{kind:'connect-overlay-opener',targetId:'fdo-dialog'});
    expect(files['/render.tsx']).not.toContain('data-fdo-ui-confirm-');
    expect(buttonOf(await render(files)).overlayOpener).toMatchObject({editable:true,targetId:'fdo-dialog'});
    files=await change(files,{kind:'disconnect-overlay-opener'});
    expect(buttonOf(await render(files)).overlayOpener).toMatchObject({editable:true,status:'available'});
});
test('confirmation result text is data even when it resembles SDK methods or identities',async()=>{
    let files=await fixture(),preview=await render(files);
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'insert',component:'result',elementId:preview.elements.find(item=>item.tag==='main').id});
    files={...files,[patch.file]:patch.after};preview=await render(files);
    const result=buttonOf(preview).overlayOpener.resultTargets.find(item=>item.label.startsWith('pre'));
    files=await change(files,{kind:'connect-overlay-opener',targetId:'fdo-confirmation-dialog',confirmTargetId:result.id,confirmText:'fdo-confirmation-dialog mountConfirmationDialog'});
    expect(buttonOf(await render(files)).overlayOpener.editable).toBe(true);
    files=await change(files,{kind:'connect-overlay-opener',targetId:'fdo-confirmation-dialog',confirmTargetId:result.id,confirmText:'visual-result-1'});
    expect(buttonOf(await render(files)).overlayOpener.editable).toBe(true);
});

test('confirmation edits an opener and result in different modules in one draft step',async()=>{
    let files=await fixture(),preview=await render(files);
    const patch=planVisualSourceEdit(files,preview.elements,{kind:'insert',component:'result',elementId:preview.elements.find(item=>item.tag==='main').id});
    files={...files,[patch.file]:patch.after};preview=await render(files);
    const result=preview.elements.find(item=>item.tag==='pre' && item.text?.value==='Results appear here');
    const original=files[result.structure.file];
    files[result.structure.file]='import {confirmationResult} from "./confirmation-result";\n'+original.slice(0,result.structure.start)+'confirmationResult(dom)'+original.slice(result.structure.end);
    files['/confirmation-result.ts']='import {DOM} from "@anikitenko/fdo-sdk"; export function confirmationResult(dom: DOM): string {return dom.createElement("pre", {}, "Results appear here");}';
    preview=await render(files);expect(preview.status==='ready' ? null : preview).toBeNull();
    const button=buttonOf(preview),target=button.overlayOpener.resultTargets.find(item=>item.file==='/confirmation-result.ts');
    expect(target).toBeDefined();
    const base={revision:'cross-module-confirm',files};
    let draft=await prepareVisualDraft({base,preview,request:{kind:'connect-overlay-opener',elementId:button.id,targetId:'fdo-confirmation-dialog',confirmTargetId:target.id,confirmText:'Confirmed'},render,acceptFiles:files=>files});
    expect(draft.changedFileCount).toBe(2);expect(buttonOf(draft.preview).overlayOpener.editable).toBe(true);
    expect(draft.files['/confirmation-result.ts']).toContain('data-fdo-result');
    draft=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});expect(draft.files).toEqual(files);
});
