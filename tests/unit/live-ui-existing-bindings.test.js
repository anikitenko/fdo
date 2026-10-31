/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import fixture from '../fixtures/live-ui/existing-bindings.cjs';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';

const render=files=>createStaticUiPreview(files,sdk);
const control=(preview,id='#refresh')=>preview.elements.find(item=>item.sdkBindings?.connect?.selector===id
    || item.sdkBindings?.items.some(binding=>binding.selector===id));
const applyPatch=(files,patch)=>{const result={...files};for(const item of patch.patches || [patch])result[item.file]=item.after;return result;};

test('imports and typed Object.assign factories expose existing handlers, setup, and all control events without execution',async()=>{
    const define=jest.fn(()=>{throw new Error('Must not execute action lifecycle');});
    const result=await createStaticUiPreview(fixture(),{...sdk,defineRenderOnLoadActions:define});
    expect(result.status).toBe('ready');
    const target=control(result).sdkBindings;
    expect(target.reason).toBe('');
    expect(target.items[0]).toMatchObject({selector:'#refresh',event:'click',handler:'command',editable:true,matches:1,
        location:{path:'/features/actions.ts'},options:{required:true,preventDefault:false}});
    expect(target.handlers.find(handler=>handler.name==='command')).toMatchObject({uses:3,location:{path:'/features/actions.ts'}});
    expect(target.setup.code).toContain('Preview must not execute setup');
    expect(control(result,'#query').sdkBindings.items[0].event).toBe('input');
    expect(define).not.toHaveBeenCalled();
});

test('rewiring one helper-built button preserves shared markup, other bindings, handlers and setup with Undo/Redo',async()=>{
    const base={revision:'base',files:fixture()}, preview=await render(base.files), selected=control(preview);
    const binding=selected.sdkBindings.items[0];
    const draft=await prepareVisualDraft({base,preview,request:{kind:'sdk-binding',action:'update',elementId:selected.id,
        bindingId:binding.id,handler:'alternative',event:'click',options:{...binding.options,preventDefault:true}},render,acceptFiles:files=>files});
    expect(draft.preview.status).toBe('ready');
    expect(draft.files['/view.ts']).toBe(base.files['/view.ts']);
    expect(draft.files['/index.ts']).toBe(base.files['/index.ts']);
    expect(draft.files['/features/actions.ts']).toContain("/* refresh binding retained */");
    expect(draft.files['/features/actions.ts']).toContain("{selector:'#save',event:'click',handler:'command'}");
    expect(draft.files['/features/actions.ts']).toContain(base.files['/features/actions.ts'].slice(base.files['/features/actions.ts'].indexOf('  setup:'),base.files['/features/actions.ts'].indexOf('\n };')));
    expect(control(draft.preview).sdkBindings.items[0]).toMatchObject({handler:'alternative',options:{preventDefault:true}});
    const undo=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(undo.files).toEqual(base.files);
    const redo=await prepareVisualDraft({base,previous:undo,preview:undo.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(redo.files).toEqual(draft.files);
});

test('disconnect and reconnect edit the listener array without modifying dynamic disabled state or deleting handlers',async()=>{
    const files=fixture(), preview=await render(files), target=control(preview), binding=target.sdkBindings.items[0];
    const disconnected=applyPatch(files,planVisualSourceEdit(files,preview.elements,{kind:'sdk-binding',action:'remove',elementId:target.id,bindingId:binding.id}));
    expect(disconnected['/view.ts']).toBe(files['/view.ts']);
    expect(disconnected['/features/actions.ts']).toContain('/* refresh binding retained */');
    const next=await render(disconnected), button=control(next);
    expect(button.sdkBindings.items).toEqual([]);
    const connected=applyPatch(disconnected,planVisualSourceEdit(disconnected,next.elements,{kind:'sdk-binding',action:'add',elementId:button.id,event:'click',handler:'command'}));
    expect(control(await render(connected)).sdkBindings.items[0]).toMatchObject({selector:'#refresh',handler:'command'});
});

test('custom attribute selectors are reviewable and shared selectors require acknowledgement before changes',async()=>{
    const files=fixture();
    files['/features/actions.ts']=files['/features/actions.ts'].replace("selector:'#refresh'",`selector:'[data-domain="availability"]'`);
    const preview=await render(files), target=preview.elements.find(item=>item.sdkBindings?.items.some(binding=>binding.matches===2)), binding=target.sdkBindings.items.find(binding=>binding.matches===2);
    const request={kind:'sdk-binding',action:'remove',elementId:target.id,bindingId:binding.id};
    expect(()=>planVisualSourceEdit(files,preview.elements,request)).toThrow('acknowledge');
    expect(planVisualSourceEdit(files,preview.elements,{...request,confirmShared:true}).file).toBe('/features/actions.ts');
});

test('complex selectors remain reviewable with source and cannot acquire duplicate guessed connections',async()=>{
    const files=fixture();files['/features/actions.ts']=files['/features/actions.ts'].replace("selector:'#refresh'","selector:'main > button:first-child'");
    const preview=await render(files), target=preview.elements.find(item=>item.tag==='button');
    expect(target.sdkBindings.unresolved[0].code).toContain('main > button:first-child');
    expect(target.sdkBindings.connect).toBeNull();
});

test('dynamic initialization and escaped options stay protected without blocking the preview',async()=>{
    const files=fixture();files['/features/actions.ts']=files['/features/actions.ts'].replace(' return Object.assign',' unknownConsumer(actions);\n return Object.assign');
    const preview=await render(files);
    expect(preview.status).toBe('ready');
    expect(preview.elements.find(item=>item.tag==='button').sdkBindings.reason).toContain('dynamic initialization');
});

test('constant aliases remain traceable, while an options object passed to another consumer is protected',async()=>{
    const files=fixture();
    files['/features/actions.ts']=files['/features/actions.ts'].replace(' return Object.assign(defineActions(actions),actions);',' const alias=actions;\n return Object.assign(defineActions(alias),alias);');
    expect(control(await render(files)).sdkBindings.items[0].editable).toBe(true);
    files['/features/actions.ts']=files['/features/actions.ts'].replace(' const alias=actions;',' const alias=actions;\n const escaped=consume(actions);');
    const result=await render(files);
    expect(result.status).toBe('ready');
    expect(result.elements.find(item=>item.tag==='button').sdkBindings.reason).toContain('referenced outside');
});

test('cyclic re-exports terminate without executing a module or losing the rendered UI',async()=>{
    const files=fixture();
    files['/features/actions.ts']="export {createActions} from './cycle';";
    files['/features/cycle.ts']="export {createActions} from './actions';";
    const result=await render(files);
    expect(result.status).toBe('ready');
    expect(result.elements.find(item=>item.tag==='button').sdkBindings.reason).toContain('circular');
});

test('invalid edits cannot forge handler IDs, bind a second event listener, or combine passive and preventDefault',async()=>{
    const files=fixture(), preview=await render(files), target=control(preview), binding=target.sdkBindings.items[0];
    const request={kind:'sdk-binding',action:'update',elementId:target.id,bindingId:binding.id,event:'click',handler:'command',options:binding.options};
    expect(()=>planVisualSourceEdit(files,preview.elements,{...request,handler:'forged'})).toThrow('existing handler');
    expect(()=>planVisualSourceEdit(files,preview.elements,{...request,bindingId:'forged'})).toThrow('current editable');
    expect(()=>planVisualSourceEdit(files,preview.elements,{...request,options:{...binding.options,passive:true,preventDefault:true}})).toThrow('passive');
    expect(()=>planVisualSourceEdit(files,preview.elements,{kind:'sdk-binding',action:'add',elementId:target.id,event:'click',handler:'command'})).toThrow('already has a binding');
});
