/** @jest-environment node */
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
const render=files=>createStaticUiPreview(files,sdk);
let base,draft,preview;
const button=()=>preview.elements.find(item=>item.text?.value==='New button');
const propose=async request=>{draft=await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});expect(draft.status).not.toBe('error');preview=draft.preview;};
beforeEach(async()=>{
    base={revision:'lifecycle',files:createPluginTemplateFiles({name:'lifecycle',template:'utility'})};draft=null;preview=await render(base.files);
    for(const component of ['button','result']) await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component});
});
const create=async kind=>propose({kind:kind==='local' ? 'create-local-action' : 'create-backend-action',elementId:button().id,targetId:button().localActionCreation.targets.find(item=>item.label.startsWith('pre')).id,text:kind==='inspect-json' ? '{}' : 'Hello',...(kind==='inspect-json' ? {preset:kind} : {})});
test.each(['local','text','inspect-json'])('removes connected %s action and all owned code with exact Undo/Redo',async kind=>{
    await create(kind);
    const before=draft.files,entry=preview.actions[0];expect(entry.removable).toBe(true);expect(entry.uses).toBe(1);
    await propose({kind:'remove-action',actionName:entry.name,elementId:button().id});
    expect(preview.actions).toEqual([]);
    expect(draft.files['/index.ts']).not.toContain(entry.name);
    expect(draft.files['/render.tsx']).not.toContain('data-fdo-result');
    expect(button().localActionCreation).toBeDefined();
    expect(draft.files['/index.ts']).toContain("PluginRegistry.registerHandler('inspectJson'");
    if(kind!=='local') {expect(draft.files['/index.ts']).not.toContain('VisualPluginRegistry');expect(draft.files['/index.ts']).not.toContain(kind==='text' ? 'VisualTextInput' : 'VisualJsonInput');}
    const {typecheckPluginWorkspace}=require('../../src/utils/sdk/pluginWorkspaceTypecheck');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const after=draft.files;await propose({kind:'undo'});expect(draft.files).toEqual(before);
    await propose({kind:'redo'});expect(draft.files).toEqual(after);
});
test('disconnected actions remain discoverable and removable without an element selection',async()=>{
    await create('text');await propose({kind:'disconnect-action',elementId:button().id});
    expect(preview.actions[0]).toMatchObject({uses:0,removable:true});
    await propose({kind:'remove-action',actionName:'visualRequest1'});
    expect(preview.actions).toEqual([]);expect(draft.files['/index.ts']).not.toContain('visualTextBackend1');
});
test('shared actions and external backend/type references prevent destructive cleanup',async()=>{
    await create('text');
    await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    const fresh=preview.elements.find(item=>item.localActionCreation);
    await propose({kind:'connect-action',elementId:fresh.id,handler:'visualRequest1'});
    expect(preview.actions[0]).toMatchObject({uses:2,removable:false});expect(preview.actions[0].reason).toContain('multiple');
    await propose({kind:'disconnect-action',elementId:fresh.id});expect(preview.actions[0].removable).toBe(true);
    for(const extra of ["import {VisualTextResult1} from './index'; export type Shared = VisualTextResult1;","export const otherHandler = 'visualTextBackend1';","export const otherHandler = `visualTextBackend1`;","export * from './index';","import * as plugin from './index'; export const shared = plugin;"]) {
        const next=await render({...draft.files,'/extra.ts':extra});expect(next.actions[0].removable).toBe(false);expect(next.actions[0].reason).toContain('referenced elsewhere');
    }
    const changed=await render({...draft.files,'/index.ts':draft.files['/index.ts'].replace('length: data.text.length','length: data.text.length + 1')});
    expect(changed.actions[0].removable).toBe(false);expect(changed.actions[0].reason).toContain('has changed');
});

test('removing the last input-bound action releases its input marker and conversion lock',async()=>{
    await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'input'});
    const input=button().localActionCreation.inputs[0];
    await propose({kind:'create-backend-action',elementId:button().id,targetId:button().localActionCreation.targets.find(item=>item.label.startsWith('pre')).id,inputId:input.id});
    expect(preview.elements.find(item=>item.id===input.id).inputKind.bound).toBe(true);
    await propose({kind:'remove-action',actionName:'visualRequest1'});
    expect(draft.files['/render.tsx']).not.toContain('data-fdo-input');
    expect(preview.elements.find(item=>item.tag==='textarea' && item.inputKind).inputKind.bound).toBe(false);
});

test('removing one of two distinct actions retains their shared result identity until the last removal',async()=>{
    await create('local');
    await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    const fresh=preview.elements.find(item=>item.localActionCreation);
    await propose({kind:'create-local-action',elementId:fresh.id,targetId:fresh.localActionCreation.targets.find(item=>item.marker==='visual-result-1').id,text:'Second'});
    await propose({kind:'remove-action',actionName:'visualSetText1'});
    expect(preview.actions).toHaveLength(1);expect(draft.files['/render.tsx']).toContain('data-fdo-result');
    expect(preview.elements.find(item=>item.actionConnection?.handler==='visualSetText2').localActionSimulation).toBeDefined();
    await propose({kind:'remove-action',actionName:'visualSetText2'});
    expect(preview.actions).toEqual([]);expect(draft.files['/render.tsx']).not.toContain('data-fdo-result');
});
