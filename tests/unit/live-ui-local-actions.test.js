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
const render = files=>createStaticUiPreview(files,sdk);
let base,draft,preview;
const button = ()=>preview.elements.find(item=>item.text?.value === 'New button');
const resultTarget = ()=>button().localActionCreation.targets.find(item=>item.label.startsWith('pre'));
const propose = async request=>{
    const result = await prepareVisualDraft({base,previous:draft,preview,request,render,acceptFiles:files=>files});
    expect(result.status).not.toBe('error'); preview = result.preview;
    return result;
};
beforeEach(async()=>{
    base = {revision:'local-action',files:createPluginTemplateFiles({name:'local-actions',template:'utility'})};
    draft = null; preview = await render(base.files);
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
});

test('creates a handler, binding and result marker atomically with exact Undo/Redo and retained code',async()=>{
    const before = draft.files;
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'Local success'});
    expect(button().actionConnection).toMatchObject({status:'connected',handler:'visualSetText1',editable:true});
    expect(preview.elements.find(item=>item.id===draft.selectedId).text.value).toBe('New button');
    expect(draft.files['/index.ts']).toContain('"visualSetText1": () =>');
    expect(draft.files['/index.ts']).toContain('target.textContent = "Local success"');
    expect(draft.files['/index.ts']).toContain("PluginRegistry.registerHandler('inspectJson'");
    expect(draft.files['/render.tsx']).toContain('"data-fdo-result": "visual-result-1"');
    expect(draft.changedFileCount).toBe(2);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
    const created = draft.files;
    draft = await propose({kind:'undo'}); expect(draft.files).toEqual(before);
    draft = await propose({kind:'redo'}); expect(draft.files).toEqual(created);
    draft = await propose({kind:'disconnect-action',elementId:button().id});
    expect(button().actionConnection.handlers.some(item=>item.name==='visualSetText1')).toBe(true);
    draft = await propose({kind:'connect-action',elementId:button().id,handler:'visualSetText1'});
    expect(button().actionConnection.handler).toBe('visualSetText1');
});

test('works with an empty declarative action contract, without reusing any existing handler',async()=>{
    const files = {...base.files};
    files['/index.ts'] = files['/index.ts'].replace(/handlers:\s*\{[\s\S]*?},\s*bindings:/,'handlers: {}, bindings:').replace(/bindings:\s*\[[\s\S]*?],/,'bindings: [],');
    base = {revision:'empty-actions',files}; draft = null; preview = await render(files);
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
    expect(button().actionConnection.status).toBe('unavailable');
    expect(resultTarget()).toBeDefined();
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'Created from scratch'});
    expect(button().actionConnection.status).toBe('connected');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('installed SDK runs the new textContent handler once without backend access, including HTML-like text',async()=>{
    const text = /* language=TEXT */ '<img src=x onerror="throw new Error(1)"> ${literal}\nLine two';
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text});
    let instance;
    vm.runInNewContext(esbuild.transformSync(draft.files['/index.ts'],{loader:'ts',format:'cjs'}).code,{
        require:name=>name==='@anikitenko/fdo-sdk' ? {...sdk,FDO_SDK:class {constructor(){instance=this;}}} : {},exports:{},
    });
    class Button extends EventTarget {disabled=false;}
    const control = new Button(), original = new Button();
    let writes = 0, actual = '';
    const target = {set textContent(value){writes++;actual=value;}};
    const backend = jest.fn();
    const document = {querySelector:selector=>selector==='[data-fdo-result="visual-result-1"]' ? target : null,
        querySelectorAll:selector=>selector==='[data-fdo-action="visual-action-1"]' ? [control] : selector==='[data-role="run"]' ? [original] : []};
    vm.runInNewContext(esbuild.transformSync(sdk.resolveRenderOnLoadSource(instance.renderOnLoad()),{loader:'ts'}).code,
        {document,window:{createBackendReq:backend},HTMLButtonElement:Button});
    const click = new Event('click',{cancelable:true});control.dispatchEvent(click);
    await new Promise(resolve=>setImmediate(resolve));
    expect(actual).toBe(text);expect(writes).toBe(1);expect(backend).not.toHaveBeenCalled();expect(click.defaultPrevented).toBe(true);
});

test('same-file handlers and markup preserve selection and source positions',async()=>{
    const files = {...base.files};
    files['/index.ts'] = files['/index.ts'].replace("import {Render} from './render';",'')+'\n'+files['/render.tsx'];
    base = {revision:'same-file',files};draft=null;preview=await render(files);
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'result'});
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'One file'});
    expect(draft.changedFileCount).toBe(1);
    expect(preview.elements.find(item=>item.id===draft.selectedId).text.value).toBe('New button');
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('reuses a managed result marker with unique handler and button identities',async()=>{
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'First'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    const fresh = preview.elements.find(item=>item.localActionCreation);
    const target = fresh.localActionCreation.targets.find(item=>item.marker==='visual-result-1');
    expect(target).toBeDefined();
    draft = await propose({kind:'create-local-action',elementId:fresh.id,targetId:target.id,text:'Second'});
    expect(draft.files['/index.ts']).toContain('"visualSetText2": () =>');
    expect(draft.files['/render.tsx'].match(/"data-fdo-result":/g)).toHaveLength(1);
    expect(typecheckPluginWorkspace(draft.files,path.resolve('node_modules')).diagnostics).toEqual([]);
});

test('rejects forged targets, oversized text, custom setup and ambiguous result markers',async()=>{
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'create-local-action',elementId:button().id,targetId:'fake',text:'No'})).toThrow('unique supported SDK');
    expect(()=>planVisualSourceEdit(draft.files,preview.elements,{kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'x'.repeat(2001)})).toThrow('2,000');
    const files = {...draft.files,'/index.ts':draft.files['/index.ts'].replace('handlers: {','setup: () => {}, handlers: {')};
    const custom = await render(files);
    expect(custom.elements.find(item=>item.text?.value==='New button').localActionCreation).toBeUndefined();
});

test('ambiguous managed result markers and controls cannot become result targets',async()=>{
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId:resultTarget().id,text:'First'});
    draft = await propose({kind:'insert',elementId:preview.elements.find(item=>item.tag==='main').id,component:'button'});
    const files = {...draft.files,'/extra.ts':'export const duplicateIdentity = "visual-result-1";'};
    const ambiguous = await render(files), fresh = ambiguous.elements.find(item=>item.localActionCreation);
    expect(fresh.localActionCreation.targets.some(item=>item.marker==='visual-result-1')).toBe(false);
    expect(fresh.localActionCreation.targets.every(item=>!item.label.startsWith('button') && !item.label.startsWith('textarea'))).toBe(true);
    expect(()=>planVisualSourceEdit(files,ambiguous.elements,{kind:'create-local-action',elementId:fresh.id,targetId:ambiguous.elements.find(item=>item.tag==='pre' && item.text?.value==='Results appear here').id,text:'Blocked'})).toThrow('unique supported SDK');
});

test('simulation describes only the complete proven preset and rejects custom callbacks or setup',async()=>{
    const targetId = resultTarget().id;
    draft = await propose({kind:'create-local-action',elementId:button().id,targetId,text:'Simulation text'});
    expect(button().localActionSimulation).toEqual({kind:'set-text',targetId,text:'Simulation text'});
    for (const replacement of [
        'target.textContent = "Simulation text"; window.createBackendReq();',
        'target.innerHTML = "Simulation text";',
        'target.textContent = dynamicText;',
    ]) {
        const files = {...draft.files,'/index.ts':draft.files['/index.ts'].replace('target.textContent = "Simulation text";',replacement)};
        const changed = await render(files);
        expect(changed.elements.find(item=>item.text?.value==='New button').localActionSimulation).toBeUndefined();
    }
    const custom = await render({...draft.files,'/index.ts':draft.files['/index.ts'].replace('handlers: {','setup: () => {}, handlers: {')});
    expect(custom.elements.find(item=>item.text?.value==='New button').localActionSimulation).toBeUndefined();
});
