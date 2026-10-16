/** @jest-environment node */
import path from 'node:path';
import vm from 'node:vm';
import * as esbuild from 'esbuild';
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
const render=files=>createStaticUiPreview(files,sdk);
let base,draft,preview;
const button=()=>preview.elements.find(item=>item.text?.value==='New button');
const target=()=>button().localActionCreation.targets.find(item=>item.label.startsWith('pre'));
const propose=async request=>{
    const result=await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});
    expect(result.status).not.toBe('error');preview=result.preview;
    return result;
};
beforeEach(async()=>{
    base={revision:'backend-actions',files:createPluginTemplateFiles({name:'backend-actions',template:'utility'})};draft=null;preview=await render(base.files);
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
});

test('creates typed backend contracts, registration and frontend binding atomically; exact Undo/Redo and reconnect',async()=>{
    const before=draft.files, targetId=target().id;
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId,text:'Backend hello'});
    expect(button().actionConnection).toMatchObject({status:'connected',handler:'visualRequest1',editable:true});
    expect(button().localActionSimulation).toEqual({kind:'backend-request',handler:'visualTextBackend1',targetId,text:'Backend hello'});
    expect(draft.files['/index.ts']).toContain('export interface VisualTextInput1');
    expect(draft.files['/index.ts']).toContain('export type VisualTextResult1');
    expect(draft.files['/index.ts']).toContain('VisualPluginRegistry1.registerHandler("visualTextBackend1", handleVisualText1)');
    expect(draft.files['/index.ts']).toContain("PluginRegistry.registerHandler('inspectJson'");
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    expect(draft.changedFileCount).toBe(2);
    const created=draft.files;
    draft = await propose({kind:'undo'});expect(draft.files).toEqual(before);
    draft = await propose({kind:'redo'});expect(draft.files).toEqual(created);
    draft = await propose({kind:'disconnect-action',elementId:button().id});
    expect(button().localActionSimulation).toBeUndefined();
    expect(button().actionConnection.handlers.some(item=>item.name==='visualRequest1')).toBe(true);
    draft = await propose({kind:'connect-action',elementId:button().id,handler:'visualRequest1'});
    expect(button().localActionSimulation.kind).toBe('backend-request');
});

function loadPlugin(files) {
    let instance;const handlers=new Map(),exports={};
    vm.runInNewContext(esbuild.transformSync(files['/index.ts'],{loader:'ts',format:'cjs'}).code,{
        require:name=>name==='@anikitenko/fdo-sdk' ? {...sdk,PluginRegistry:{registerHandler:(name,fn)=>handlers.set(name,fn)},FDO_SDK:class{constructor(){instance=this;}}} : {},exports,module:{exports},
    });
    instance.init();return {instance,handlers,exports};
}

test('installed SDK frontend makes a real typed round trip once, handles error envelopes and restores loading',async()=>{
    const text=/* language=TEXT */ '<img src=x> ${literal}\nBackend data';
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text});
    const {instance,handlers}=loadPlugin(draft.files), handler=handlers.get('visualTextBackend1');
    expect(handler({text})).toEqual({success:true,text,length:text.length});
    for(const input of [null,[],{},'bad',{text:4},{text:'x'.repeat(2001)}]) expect(handler(input).success).toBe(false);
    expect(handler({text:''})).toEqual({success:true,text:'',length:0});
    class Button extends EventTarget {}
    const control=new Button(), original=new Button(), attrs=new Map();
    let actual='',resolveRequest;
    const output={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),set textContent(value){actual=value;}};
    const request=jest.fn(()=>new Promise(resolve=>{resolveRequest=resolve;}));
    const document={querySelector:selector=>selector==='[data-fdo-result="visual-result-1"]' ? output:null,
        querySelectorAll:selector=>selector==='[data-fdo-action="visual-action-1"]' ? [control]:selector==='[data-role="run"]' ? [original]:[]};
    vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()),{loader:'ts'}).code,{document,window:{createBackendReq:request},HTMLButtonElement:Button,Error});
    control.dispatchEvent(new Event('click'));control.dispatchEvent(new Event('click'));
    expect(request).toHaveBeenCalledTimes(1);expect(actual).toBe('Sending request…');expect(attrs.get('aria-busy')).toBe('true');
    const [transport,payload]=request.mock.calls[0];expect(transport).toBe('UI_MESSAGE');expect(payload).toEqual({handler:'visualTextBackend1',content:{text}});
    resolveRequest({result:handler(payload.content)});await new Promise(resolve=>setImmediate(resolve));
    expect(JSON.parse(actual)).toEqual({success:true,text,length:text.length});expect(attrs.get('aria-busy')).toBe('false');
    request.mockResolvedValueOnce({success:false,error:'Backend unavailable'});
    control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
    expect(actual).toBe('Backend unavailable');expect(attrs.get('aria-busy')).toBe('false');
    request.mockRejectedValueOnce(new Error('Request rejected'));
    control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
    expect(actual).toBe('Request rejected');expect(attrs.get('aria-busy')).toBe('false');
});

test('rejects forged requests, invalid text and unsupported async initialization; ignores customized callbacks for simulation',async()=>{
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'create-backend-action',elementId:button().id,targetId:'fake',text:'No'})).toThrow('supported result');
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'x'.repeat(2001)})).toThrow('2,000');
    const custom=await render({...draft.files,'/index.ts':draft.files['/index.ts'].replace('init(): void','async init(): Promise<void>')});
    expect(custom.elements.find(item=>item.text?.value==='New button').localActionCreation.backend).toBeNull();
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'Example'});
    const modified=await render({...draft.files,'/index.ts':draft.files['/index.ts'].replace("target.textContent = 'Sending request…';","target.textContent = 'Changed';")});
    expect(modified.elements.find(item=>item.text?.value==='New button').localActionSimulation).toBeUndefined();
});

test('same-file source and repeated backend creation avoid collisions and preserve contracts',async()=>{
    const files={...base.files};files['/index.ts']=files['/index.ts'].replace("import {Render} from './render';",'')+'\n'+files['/render.tsx'];
    base={revision:'same-backend',files};draft=null;preview=await render(files);
    for(let i=0;i<2;i++) {
        draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
        draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
        const fresh=preview.elements.find(item=>item.localActionCreation),output=fresh.localActionCreation.targets.at(-1);
        draft = await propose({kind:'create-backend-action',elementId:fresh.id,targetId:output.id,text:'Request '+i});
    }
    expect(draft.changedFileCount).toBe(1);
    expect(draft.files['/index.ts']).toContain('visualTextBackend2');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('binds a managed textarea atomically and reads its latest value with SDK frontend validation',async()=>{
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'input'});
    const input=button().localActionCreation.inputs[0],targetId=target().id;
    expect(input.tag).toBe('textarea');
    const before=draft.files;
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId,inputId:input.id});
    expect(button().localActionSimulation).toMatchObject({kind:'backend-request',inputId:input.id,inputLabel:input.label,text:''});
    expect(draft.files['/render.tsx']).toContain('"data-fdo-input": "visual-input-1"');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const created=draft.files;
    draft = await propose({kind:'undo'});expect(draft.files).toEqual(before);
    draft = await propose({kind:'redo'});expect(draft.files).toEqual(created);
    const {instance,handlers}=loadPlugin(draft.files);
    class Button extends EventTarget {}
    const control=new Button(),original=new Button(),attrs=new Map(),inputNode={value:'First',disabled:false,readOnly:false};let actual='';
    const output={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),set textContent(value){actual=value;}};
    const request=jest.fn(async(type,payload)=>({result:handlers.get(payload.handler)(payload.content)}));
    let missing=false;
    const document={querySelector:selector=>selector==='[data-fdo-input="visual-input-1"]' ? (missing ? null : inputNode) : selector==='[data-fdo-result="visual-result-1"]' ? output : null,
        querySelectorAll:selector=>selector==='[data-fdo-action="visual-action-1"]' ? [control] : selector==='[data-role="run"]' ? [original] : []};
    vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()),{loader:'ts'}).code,{document,window:{createBackendReq:request},HTMLButtonElement:Button,Error});
    const click=async()=>{control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));expect(attrs.get('aria-busy')).toBe('false');};
    await click();expect(JSON.parse(actual).text).toBe('First');
    inputNode.value='<b>Changed</b>';await click();expect(JSON.parse(actual).text).toBe('<b>Changed</b>');
    inputNode.value='';await click();expect(JSON.parse(actual)).toEqual({success:true,text:'',length:0});
    const accepted=request.mock.calls.length;
    inputNode.value='x'.repeat(2001);await click();expect(actual).toContain('at most 2,000');expect(request).toHaveBeenCalledTimes(accepted);
    inputNode.value='Restored';inputNode.readOnly=true;await click();expect(actual).toContain('unavailable');
    inputNode.readOnly=false;inputNode.disabled=true;await click();expect(actual).toContain('unavailable');
    inputNode.disabled=false;missing=true;await click();expect(actual).toContain('unavailable');
    expect(request).toHaveBeenCalledTimes(accepted);
});

test('excludes ambiguous, custom-wired, password and read-only inputs; rejects forged binding identities',async()=>{
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'input'});
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'create-backend-action',elementId:button().id,targetId:target().id,inputId:'fake'})).toThrow('unique, enabled SDK');
    const before=draft.files;
    for(const attrs of ['readonly: true,','disabled: true,','id: "custom",','"data-role": "custom",']) {
        const at=button().localActionCreation.inputs[0].insert;
        const files={...before,'/render.tsx':before['/render.tsx'].slice(0,at)+attrs+before['/render.tsx'].slice(at)};
        const next=await render(files);
        expect(next.elements.find(item=>item.text?.value==='New button').localActionCreation.inputs).toEqual([]);
    }
    for (const type of ['text','search','password','number']) {
        const at=button().localActionCreation.inputs[0].insert;
        const source=(before['/render.tsx'].slice(0,at)+`type: "${type}",`+before['/render.tsx'].slice(at)).replace(/(["'])textarea\1/g,'"input"');
        const next=await render({...before,'/render.tsx':source});
        const available=next.elements.find(item=>item.text?.value==='New button').localActionCreation.inputs;
        expect(available).toHaveLength(['text','search'].includes(type) ? 1 : 0);
        if (type === 'text') {
            const btn=next.elements.find(item=>item.text?.value==='New button');
            const patch=planVisualSourceEdit({...before,'/render.tsx':source},next.elements,{kind:'create-backend-action',elementId:btn.id,targetId:btn.localActionCreation.targets[0].id,inputId:available[0].id});
            expect(patch.patches.some(item=>item.added.includes('querySelector<HTMLInputElement>'))).toBe(true);
        }
    }
    const input=button().localActionCreation.inputs[0];
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,inputId:input.id});
    const ambiguous=await render({...draft.files,'/extra.ts':'export const duplicate = "visual-input-1";'});
    expect(ambiguous.elements.find(item=>item.text?.value==='New button').localActionSimulation).toBeUndefined();
    const customized=await render({...draft.files,'/index.ts':draft.files['/index.ts'].replace('const text = input.value;','const text = input.value.trim();')});
    expect(customized.elements.find(item=>item.text?.value==='New button').localActionSimulation).toBeUndefined();
});

test('maps a response field to a different result with atomic history and unchanged backend/input code',async()=>{
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'Mapping'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
    base={revision:'mapping-comments',files:{...draft.files,'/index.ts':draft.files['/index.ts'].replace("target.textContent = 'Sending request…';","/* Preserve request explanation. */ target.textContent = 'Sending request…';")}};
    draft=null;preview=await render(base.files);
    const current=button().backendResultMapping;
    const second=current.targets.find(item=>item.id!==current.targetId && !item.marker);
    const before=base.files;
    draft = await propose({kind:'backend-result',elementId:button().id,targetId:second.id,display:'text'});
    expect(button().localActionSimulation).toMatchObject({targetId:second.id,display:'text'});
    expect(draft.files['/index.ts']).toContain('/* Preserve request explanation. */');
    expect(draft.files['/render.tsx']).toContain('"data-fdo-result": "visual-result-2"');
    expect(draft.files['/index.ts'].split('// Live UI backend preset.')[1]).toBe(before['/index.ts'].split('// Live UI backend preset.')[1]);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const after=draft.files;
    draft = await propose({kind:'undo'});expect(draft.files).toEqual(before);
    draft = await propose({kind:'redo'});expect(draft.files).toEqual(after);
    draft = await propose({kind:'backend-result',elementId:button().id,targetId:second.id,display:'length'});
    expect(button().localActionSimulation.display).toBe('length');
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'backend-result',elementId:button().id,targetId:second.id,display:'constructor'})).toThrow('supported result');
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'backend-result',elementId:button().id,targetId:'fake',display:'text'})).toThrow('supported result');
});

test.each(['text','length'])('SDK frontend displays %s values faithfully, including empty strings and zero',async display=>{
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'',display});
    const {instance,handlers}=loadPlugin(draft.files);
    class Button extends EventTarget {}
    const control=new Button(),original=new Button(),attrs=new Map();let output='';
    const targetNode={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),set textContent(value){output=value;}};
    const request=jest.fn(async(type,payload)=>({result:handlers.get(payload.handler)(payload.content)}));
    const document={querySelector:()=>targetNode,querySelectorAll:selector=>selector==='[data-fdo-action="visual-action-1"]' ? [control]:selector==='[data-role="run"]' ? [original]:[]};
    vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()),{loader:'ts'}).code,{document,window:{createBackendReq:request},HTMLButtonElement:Button,Error});
    control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
    expect(output).toBe(display==='text' ? '' : '0');expect(attrs.get('aria-busy')).toBe('false');
});

test('JSON inspection preset generates typed contracts and matches the trusted fixture helper across JSON types',async()=>{
    const {inspectJsonFixture}=require('../../src/utils/plugins/authoring/liveUi/jsonInspection');
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'{"hello":"world"}',preset:'inspect-json',display:'summary'});
    expect(button().localActionSimulation).toMatchObject({preset:'inspect-json',handler:'visualJsonBackend1',display:'summary'});
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const {handlers}=loadPlugin(draft.files),inspect=handlers.get('visualJsonBackend1');
    for(const text of ['{"hello":"world","nested":{"value":1}}','[1,2,3]','[]','{}','null','true','42','"<b>text</b>"']) {
        expect(inspect({text})).toEqual(inspectJsonFixture(text));
    }
    expect(inspect({text:'bad'})).toMatchObject({success:false,error:expect.stringContaining('Invalid JSON:')});
    expect(inspect(null).success).toBe(false);expect(inspect({text:'x'.repeat(2001)}).success).toBe(false);
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'backend-result',elementId:button().id,targetId:button().backendResultMapping.targetId,display:'text'})).toThrow('supported result');
    for(const display of ['valueType','itemCount','topLevelKeys','json','summary']) {
        draft = await propose({kind:'backend-result',elementId:button().id,targetId:button().backendResultMapping.targetId,display});
        expect(button().localActionSimulation.preset).toBe('inspect-json');
    }
});

test('installed SDK JSON action returns keys as inert text and reports malformed input with loading cleanup',async()=>{
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'{"<b>key</b>":1}',preset:'inspect-json',display:'topLevelKeys'});
    const {instance,handlers}=loadPlugin(draft.files);
    class Button extends EventTarget {}
    const control=new Button(),original=new Button(),attrs=new Map();let output='';
    const targetNode={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),set textContent(value){output=value;}};
    const request=jest.fn(async(type,payload)=>({result:handlers.get(payload.handler)(payload.content)}));
    const document={querySelector:()=>targetNode,querySelectorAll:selector=>selector==='[data-fdo-action="visual-action-1"]' ? [control]:selector==='[data-role="run"]' ? [original]:[]};
    vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()),{loader:'ts'}).code,{document,window:{createBackendReq:request},HTMLButtonElement:Button,Error});
    control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
    expect(JSON.parse(output)).toEqual(['<b>key</b>']);expect(attrs.get('aria-busy')).toBe('false');
    request.mockResolvedValueOnce({result:handlers.get('visualJsonBackend1')({text:'bad'})});
    control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
    expect(output).toContain('Invalid JSON:');expect(attrs.get('aria-busy')).toBe('false');
});

test('maps one JSON response to multiple outputs with exact history and remains removable',async()=>{
    draft = await propose({kind:'create-backend-action',elementId:button().id,targetId:target().id,text:'{}',preset:'inspect-json',display:'summary'});
    for(let i=0;i<2;i++) draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
    const mapping=button().backendResultMapping,extras=mapping.targets.filter(item=>!item.marker);
    const before=draft.files;
    draft = await propose({kind:'backend-result',elementId:button().id,targetId:mapping.targetId,display:'summary',outputs:[{targetId:extras[0].id,display:'itemCount'},{targetId:extras[1].id,display:'topLevelKeys'}]});
    expect(button().localActionSimulation.outputs).toEqual([{targetId:extras[0].id,display:'itemCount'},{targetId:extras[1].id,display:'topLevelKeys'}]);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    expect(preview.actions[0].removable).toBe(true);
    const after=draft.files;draft = await propose({kind:'undo'});expect(draft.files).toEqual(before);
    draft = await propose({kind:'redo'});expect(draft.files).toEqual(after);
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'backend-result',elementId:button().id,targetId:mapping.targetId,display:'summary',outputs:[{targetId:mapping.targetId,display:'itemCount'}]})).toThrow('distinct');
    draft = await propose({kind:'backend-result',elementId:button().id,targetId:mapping.targetId,display:'summary',outputs:[]});
    expect(button().localActionSimulation.outputs).toBeUndefined();
    draft = await propose({kind:'remove-action',actionName:'visualRequest1',elementId:button().id});expect(preview.actions).toEqual([]);
});
