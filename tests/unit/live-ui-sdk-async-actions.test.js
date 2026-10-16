/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as sdk from '@anikitenko/fdo-sdk';
import * as esbuild from 'esbuild';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {asyncActionSetupSource} from '../../src/utils/plugins/authoring/liveUi/sdkAsyncActions';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const contract=JSON.parse(fs.readFileSync(require.resolve('@anikitenko/fdo-sdk/ui-components.json'),'utf8'));
const render=files=>createStaticUiPreview(files,sdk,contract);
let base,draft,preview;
const button=()=>preview.elements.find(item=>item.sdkComponent?.identity==='fdo.async-action-button');
const propose=async request=>{draft=await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});preview=draft.preview;expect(preview.status==='ready' ? null : preview).toBeNull();};
beforeEach(async()=>{
    base={revision:'async',files:createPluginTemplateFiles({name:'async-actions',template:'utility'})};draft=null;preview=await render(base.files);
    await propose({kind:'insert-sdk-component',elementId:preview.elements.find(item=>item.tag==='main').id,component:'fdo.async-action-button'});
    await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
});
test('creates and disconnects a typed SDK action atomically without changing other handlers',async()=>{
    expect(button().asyncAction.editable).toBe(true);
    const target=button().asyncAction.targets.find(item=>item.label.startsWith('pre'));
    const before=draft.files;
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:target.id,text:'<saved> & safe'});
    expect(button().asyncAction).toMatchObject({editable:true,status:'connected',row:{text:'<saved> & safe'}});
    expect(button().sdkComponent.properties.find(item=>item.name==='disabled').editable).toBe(false);
    expect(button().asyncAction.targets.some(item=>item.id===target.id)).toBe(true);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const connected=draft.files;
    await propose({kind:'undo'});expect(draft.files).toEqual(before);
    await propose({kind:'redo'});expect(draft.files).toEqual(connected);
    await propose({kind:'disconnect-sdk-async-action',elementId:button().id});
    expect(button().asyncAction).toMatchObject({editable:true,status:'available'});
    expect(draft.files['/index.ts']).toBe(before['/index.ts']);
    expect(draft.files['/render.tsx']).toContain('visual-result-1');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('multiple generated controllers coexist and disconnect independently',async()=>{
    const id=button().sdkComponent.instanceId;
    const target=button().asyncAction.targets[0];
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:target.id,text:'One'});
    await propose({kind:'insert-sdk-component',elementId:preview.elements.find(item=>item.tag==='main').id,component:'fdo.async-action-button'});
    const second=preview.elements.find(item=>item.sdkComponent?.identity==='fdo.async-action-button' && item.sdkComponent.instanceId!==id);
    await propose({kind:'create-sdk-async-action',elementId:second.id,targetId:target.id,text:'Two'});
    expect(preview.elements.filter(item=>item.asyncAction?.status==='connected')).toHaveLength(2);
    await propose({kind:'disconnect-sdk-async-action',elementId:button().id});
    const remaining=preview.elements.find(item=>item.asyncAction?.status==='connected');
    expect(remaining.asyncAction.row.text).toBe('Two');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('custom setup, custom mounts, external identities and edited generated callbacks stay protected',async()=>{
    const current=draft.files;
    for(const code of [
        current['/index.ts'].replace('handlers:', 'setup: () => { console.log("custom"); }, handlers:'),
        current['/index.ts']+'\n// mountAsyncActionButton is managed elsewhere',
        current['/index.ts']+'\nexport const other = "fdo-async-action-button";',
    ]) {
        const files={...current,'/index.ts':code},result=await render(files),element=result.elements.find(item=>item.asyncAction);
        expect(element.asyncAction.editable).toBe(false);
        expect(()=>planVisualSourceEdit(files,result.elements,{kind:'create-sdk-async-action',elementId:element.id,targetId:'invented',text:'x'})).toThrow();
    }
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:button().asyncAction.targets[0].id,text:'One'});
    const files={...draft.files,'/index.ts':draft.files['/index.ts'].replace('target.textContent = action.text','target.innerHTML = action.text')};
    const result=await render(files);
    expect(result.elements.find(item=>item.asyncAction).asyncAction.editable).toBe(false);
});
test('frontend setup writes plain text, honors aborted signals and disposes owned controllers',async()=>{
    let options,disposed=0;
    const target={textContent:''};
    const mount=jest.fn((_root,value)=>{options=value;return {destroy:()=>disposed++};});
    const source=esbuild.transformSync('('+asyncActionSetupSource([{id:'async',marker:'visual-result-1',text:'<safe>'}])+')',{loader:'ts'}).code;
    const setup=vm.runInNewContext(source,{window:{loadFdoUi:async()=>({mountAsyncActionButton:mount})},document:{getElementById:()=>({}),querySelector:()=>target}});
    const cleanup=await setup();expect(mount).toHaveBeenCalledTimes(1);
    await options.onAction({signal:{aborted:true}});expect(target.textContent).toBe('');
    await options.onAction({signal:{aborted:false}});expect(target.textContent).toBe('<safe>');
    cleanup();expect(disposed).toBe(1);
});
test('a partial setup failure destroys controllers already mounted',async()=>{
    let disposed=0,count=0;
    const source=esbuild.transformSync('('+asyncActionSetupSource([{id:'first',marker:'visual-result-1',text:'One'},{id:'second',marker:'visual-result-2',text:'Two'}])+')',{loader:'ts'}).code;
    const setup=vm.runInNewContext(source,{window:{loadFdoUi:async()=>({mountAsyncActionButton:()=>({destroy:()=>disposed++})})},document:{getElementById:()=>({}),querySelector:()=>++count===1 ? {} : null}});
    await expect(setup()).rejects.toThrow('bound result element');expect(disposed).toBe(1);
});

test('generated action manager can remove async setup and undo restores it',async()=>{
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:button().asyncAction.targets[0].id,text:'Saved'});
    const action=preview.actions.find(item=>item.kind==='SDK async text');
    expect(action).toMatchObject({removable:true,uses:1});
    const connected=draft.files;
    await propose({kind:'remove-action',actionName:action.name});
    expect(preview.actions.some(item=>item.kind==='SDK async text')).toBe(false);
    expect(button().asyncAction.status).toBe('available');
    await propose({kind:'undo'});expect(draft.files).toEqual(connected);
});

test.each(['text','inspect-json'])('async %s backend generation has typed input/results and removes only private code',async preset=>{
    await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'singleLineInput'});
    const input=button().asyncAction.inputs.find(item=>item.tag==='input');
    const before=draft.files;
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:button().asyncAction.targets[0].id,inputId:input.id,preset,display:preset==='text' ? 'text' : 'summary'});
    expect(button().asyncAction).toMatchObject({editable:true,status:'connected',row:{preset,inputTag:'input'}});
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const connected=draft.files;
    await propose({kind:'undo'});expect(draft.files).toEqual(before);
    await propose({kind:'redo'});expect(draft.files).toEqual(connected);
    const action=preview.actions.find(item=>item.kind==='SDK async backend');
    await propose({kind:'remove-action',actionName:action.name});
    expect(draft.files['/index.ts']).not.toContain('visualAsync');
    expect(draft.files['/index.ts']).not.toContain('VisualAsync');
    expect(button().asyncAction.status).toBe('available');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});
test('async backend disconnect refuses changed implementation or references from another module',async()=>{
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:button().asyncAction.targets[0].id,text:'Hi',preset:'text',display:'length'});
    const current=draft.files;
    for(const files of [
        {...current,'/index.ts':current['/index.ts'].replace('length: data.text.length','length: 999')},
        {...current,'/other.ts':'import {handleVisualAsyncText1} from "./index"; export const reused = handleVisualAsyncText1;'},
    ]) {
        const result=await render(files),control=result.elements.find(item=>item.asyncAction);
        expect(control.asyncAction.editable).toBe(false);
        expect(()=>planVisualSourceEdit(files,result.elements,{kind:'disconnect-sdk-async-action',elementId:control.id})).toThrow('modified, shared');
    }
});

test('mixed local and backend buttons retain independent setup and handler ownership',async()=>{
    const first=button().sdkComponent.instanceId,target=button().asyncAction.targets[0];
    await propose({kind:'create-sdk-async-action',elementId:button().id,targetId:target.id,text:'Hi',preset:'text',display:'json'});
    await propose({kind:'insert-sdk-component',elementId:preview.elements.find(item=>item.tag==='main').id,component:'fdo.async-action-button'});
    const second=preview.elements.find(item=>item.asyncAction?.id!==first && item.asyncAction);
    await propose({kind:'create-sdk-async-action',elementId:second.id,targetId:target.id,text:'Local'});
    expect(preview.elements.filter(item=>item.asyncAction?.editable && item.asyncAction.status==='connected')).toHaveLength(2);
    await propose({kind:'disconnect-sdk-async-action',elementId:button().id});
    expect(preview.elements.find(item=>item.asyncAction?.status==='connected').asyncAction.row.text).toBe('Local');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('async backend callbacks validate responses, display results and ignore cancelled late replies',async()=>{
    let onAction,resolveResponse;
    const target={textContent:'Original'};
    const backend=jest.fn(()=>new Promise(resolve=>{resolveResponse=resolve;}));
    const row={id:'async',marker:'visual-result-1',text:'Hi',backend:'visualAsyncTextBackend1',preset:'text',display:'length',inputMarker:'',inputTag:''};
    const source=esbuild.transformSync('('+asyncActionSetupSource([row])+')',{loader:'ts'}).code;
    const setup=vm.runInNewContext(source,{window:{createBackendReq:backend,loadFdoUi:async()=>({mountAsyncActionButton:(_root,options)=>{onAction=options.onAction;return {destroy(){}};}})},document:{getElementById:()=>({}),querySelector:()=>target}});
    await setup();
    const signal={aborted:false},cancelled=onAction({signal});
    expect(backend).toHaveBeenCalledWith('UI_MESSAGE',{handler:row.backend,content:{text:'Hi'}});
    signal.aborted=true;resolveResponse({result:{success:true,text:'Hi',length:2}});await cancelled;
    expect(target.textContent).toBe('Original');
    const success=onAction({signal:{aborted:false}});resolveResponse({result:{success:true,text:'Hi',length:2}});await success;
    expect(target.textContent).toBe('2');
    const invalid=onAction({signal:{aborted:false}});resolveResponse({result:{success:true,text:'Hi',length:999}});
    await expect(invalid).rejects.toThrow('Invalid text response');expect(target.textContent).toBe('2');
});
