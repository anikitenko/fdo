/** @jest-environment node */
import {expect, test} from '@jest/globals';
import path from 'node:path';
import * as sdk from '@anikitenko/fdo-sdk';
import fixture from '../fixtures/live-ui/existing-bindings.cjs';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';

const render=files=>createStaticUiPreview(files,sdk);
const control=preview=>preview.elements.find(item=>item.sdkBindings?.connect?.selector==='#refresh');
const apply=(files,patch)=>{const next={...files};for(const item of patch.patches)next[item.file]=item.after;return next;};
const plan=(files,preview,request)=>planVisualSourceEdit(files,preview.elements,{kind:'sdk-handler',elementId:control(preview).id,...request});

test('rename changes the handler key and every declared binding atomically, with Undo/Redo',async()=>{
    const base={revision:'base',files:fixture()},preview=await render(base.files);
    expect(()=>plan(base.files,preview,{action:'rename',handler:'command',name:'checkAvailability'})).toThrow('Acknowledge');
    const draft=await prepareVisualDraft({base,preview,request:{kind:'sdk-handler',elementId:control(preview).id,action:'rename',handler:'command',name:'checkAvailability',confirmSharedHandler:true},render,acceptFiles:files=>files});
    expect(draft.status).not.toBe('error');
    const target=control(draft.preview).sdkBindings;
    expect(target.handlers.find(item=>item.name==='checkAvailability').uses).toBe(3);
    expect(draft.preview.elements.flatMap(item=>item.sdkBindings?.items || []).every(item=>item.handler==='checkAvailability')).toBe(true);
    expect(draft.files['/view.ts']).toBe(base.files['/view.ts']);
    expect(draft.files['/index.ts']).toBe(base.files['/index.ts']);
    const undo=await prepareVisualDraft({base,previous:draft,preview:draft.preview,request:{kind:'undo'},render,acceptFiles:files=>files});
    expect(undo.files).toEqual(base.files);
    const redo=await prepareVisualDraft({base,previous:undo,preview:undo.preview,request:{kind:'redo'},render,acceptFiles:files=>files});
    expect(redo.files).toEqual(draft.files);
});

test('create and duplicate add unconnected functions without executing or rewriting other handlers',async()=>{
    const files=fixture(),preview=await render(files);
    const code='({element}) => { if(element) element.textContent="Saved"; } // trailing comment';
    const created=apply(files,plan(files,preview,{action:'create',name:'saveSelection',code}));
    const next=await render(created),added=control(next).sdkBindings.handlers.find(item=>item.name==='saveSelection');
    expect(added.uses).toBe(0);
    expect(added.functionSource).toContain('element.textContent="Saved"');
    expect(created['/features/actions.ts']).toContain(files['/features/actions.ts'].slice(files['/features/actions.ts'].indexOf('   command:'),files['/features/actions.ts'].indexOf('  bindings:')));
    expect(typecheckPluginWorkspace(created,path.resolve('node_modules')).diagnostics).toEqual([]);
    const duplicated=apply(created,plan(created,next,{action:'duplicate',handler:'command',name:'commandCopy'}));
    const handlers=control(await render(duplicated)).sdkBindings.handlers;
    expect(handlers.find(item=>item.name==='commandCopy')).toMatchObject({uses:0,functionSource:handlers.find(item=>item.name==='command').functionSource});
});

test('code editing changes only the selected callback and never executes it during preview',async()=>{
    const files=fixture(),preview=await render(files),code='({element}) => { throw new Error("must not run"); }';
    expect(()=>plan(files,preview,{action:'update',handler:'command',code})).toThrow('Acknowledge');
    const changed=apply(files,plan(files,preview,{action:'update',handler:'command',code,confirmSharedHandler:true}));
    const next=await render(changed);
    expect(next.status).toBe('ready');
    expect(control(next).sdkBindings.handlers.find(item=>item.name==='command').functionSource).toContain('must not run');
    expect(changed['/features/actions.ts']).toContain("alternative:({element})=>{if(element)element.textContent='Requested';}");
    expect(changed['/view.ts']).toBe(files['/view.ts']);
});

test('unused removal retains bound handlers and the final SDK handler cannot be removed',async()=>{
    const files=fixture(),preview=await render(files);
    expect(()=>plan(files,preview,{action:'remove',handler:'command'})).toThrow('Disconnect or rewire');
    const removed=apply(files,plan(files,preview,{action:'remove',handler:'alternative'}));
    expect(control(await render(removed)).sdkBindings.handlers.map(item=>item.name)).toEqual(['command']);
    removed['/features/actions.ts']=removed['/features/actions.ts'].replace(/bindings:\[[\s\S]*?],/,'bindings:[],');
    const emptyPreview=await render(removed);
    expect(()=>plan(removed,emptyPreview,{action:'remove',handler:'command'})).toThrow('at least one handler');
});

test.each([
    {action:'create',name:'__proto__',code:'()=>{}'},
    {action:'create',name:'command',code:'()=>{}'},
    {action:'create',name:'newHandler',code:'(()=>{})()'},
    {action:'create',name:'newHandler',code:'()=>{}; globalThis.changed = true;'},
    {action:'update',handler:'forged',code:'()=>{}'},
])('invalid or forged handler edits are rejected before producing patches: %p',async request=>{
    const files=fixture(),preview=await render(files);
    expect(()=>plan(files,preview,request)).toThrow();
});

test('direct consumer references protect renames and dynamic handler references protect removal',async()=>{
    const files=fixture();files['/consumer.ts']='export const read=(value:any)=>value.handlers.command;';
    let preview=await render(files);
    expect(()=>plan(files,preview,{action:'rename',handler:'command',name:'newCommand',confirmSharedHandler:true})).toThrow('/consumer.ts');
    delete files['/consumer.ts'];
    files['/features/actions.ts']=files['/features/actions.ts'].replace("handler:'command'","handler:chosenHandler").replace(' const actions:'," const chosenHandler='command';\n const actions:");
    preview=await render(files);
    expect(control(preview).sdkBindings.handlers.find(item=>item.name==='alternative').referencesComplete).toBe(false);
    expect(()=>plan(files,preview,{action:'remove',handler:'alternative'})).toThrow('Dynamic references');
});

test('a callback that captures the options object is rejected without replacing the draft',async()=>{
    const base={revision:'base',files:fixture()},preview=await render(base.files);
    const result=await prepareVisualDraft({base,preview,request:{kind:'sdk-handler',elementId:control(preview).id,action:'update',handler:'command',
        code:'() => actions.handlers.alternative()',confirmSharedHandler:true},render,acceptFiles:files=>files});
    expect(result).toMatchObject({status:'error',message:expect.stringContaining('referenced outside')});
});

test.each([
    'value.handlers?.command',
    '(()=>{const h=value.handlers;return h.command;})()',
    '(()=>{const {handlers:h}=value;return h.command;})()',
    '(()=>{const {command}=value.handlers;return command;})()',
])('renames protect direct optional, aliased and destructured consumers: %s',async expression=>{
    const files=fixture();files['/consumer.ts']='export const read=(value:any)=>'+expression+';';
    const preview=await render(files);
    expect(()=>plan(files,preview,{action:'rename',handler:'command',name:'newCommand',confirmSharedHandler:true})).toThrow('/consumer.ts');
});

test.each([
    'command({element}) { if(element) element.textContent="Original"; }',
    'command: "({element}) => { if(element) element.textContent=\'Original\'; }"',
])('method and serialized SDK callbacks retain their semantics when edited: %s',async original=>{
    const files=fixture();
    files['/features/actions.ts']=files['/features/actions.ts'].replace("command:({element})=>{if(element)element.dispatchEvent(new CustomEvent('availability-command'));}",original);
    const preview=await render(files),code='({element}) => { if(element) element.textContent="Updated"; }';
    const changed=apply(files,plan(files,preview,{action:'update',handler:'command',code,confirmSharedHandler:true}));
    const next=await render(changed);
    expect(control(next).sdkBindings.handlers.find(item=>item.name==='command').functionSource).toBe(code);
    expect(typecheckPluginWorkspace(changed,path.resolve('node_modules')).diagnostics).toEqual([]);
});
