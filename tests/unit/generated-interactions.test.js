import {validateGeneratedInteractions as validate} from '../../src/utils/plugins/validation/generatedInteractions';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';
import {validateAiWorkspaceCandidate} from '../../src/components/editor/utils/validateAiWorkspaceCandidate';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';

const file=content=>({path:'/actions.ts',content});
const valid=file(`import {defineRenderOnLoadActions as actions} from '@anikitenko/fdo-sdk';
export function createActions(){return actions({strict:true,lifecycleKey:'tools.main',handlers:{run:({document})=>{document.querySelector('#result').textContent='Done';}},bindings:[{selector:'#run',event:'click',handler:'run'}]});}`);
const manual=file(`export function mount(){const button=document.querySelector('#run');button.addEventListener('click',()=>{document.querySelector('#result').textContent='Done';});}`);

test.each([
    `document.querySelector('#run').addEventListener('click',()=>{});`,
    `const event='input';root['addEventListener'](event,()=>{});`,
    'root?.addEventListener(`change`,()=>{});',
    `button.onclick=()=>{};`,
    `button['onchange']=function(){};`,
    `button.setAttribute('onclick','run()');`,
    `const form=document.querySelector('form');form.requestSubmit();`,
    `const form=document.getElementById('settings');form.submit();`,
    `const script=\`const dispatch=()=>{};form.addEventListener('submit',dispatch);\`;`,
    `class P {renderOnLoad(){return "button.addEventListener('click',()=>{});";}}`,
    `export function makeActions(){return \`document.querySelector('#run').addEventListener('click',()=>{});\`;}`,
    `import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';defineRenderOnLoadActions({setup:()=>{root.addEventListener('click',()=>{});},handlers:{run:()=>{}},bindings:[]});`,
    `import * as sdk from '@anikitenko/fdo-sdk';const bindings=[{selector:'form',event:'submit',handler:'run'}];sdk.defineRenderOnLoadActions({handlers:{run:()=>{}},bindings});`,
    `dom.createElement('button',{type:'submit'},'Save');`,
    `dom.createElement('button',{onclick:'run()'},'Save');`,
    `dom.createElement('form',{onsubmit:'run()'},'');`,
    `new DOMButton().createStaticButton('Save',{},'save',{type:'submit'});`,
    `const button=document.querySelector('button');button.type='submit';`,
    `const button=document.querySelector('button');button.setAttribute('type','submit');`,
    `for(const event of ['click','change'])root.addEventListener(event,run);`,
    `['click','input'].forEach(event=>root.addEventListener(event,run));`,
    `root.addEventListener(active?'click':'change',run);`,
    `export const markup='<button onclick="run()">Run</button>';`,
    'export const markup=`<form><button>Save</button></form>`;',
    `export const markup='<input type="submit" value="Save">';`,
])('rejects new manual/submit interaction wiring: %s',content=>{
    const errors=validate([file(content)]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(error=>/^\/actions\.ts:\d+: SDK_ACTION_BINDING_REQUIRED:/.test(error))).toBe(true);
});

test.each([
    valid.content,
    `import * as sdk from '@anikitenko/fdo-sdk';export const actions=()=>sdk.createRenderOnLoadActionsSource({handlers:{save:({document})=>{document.querySelector('output').textContent='Saved';}},bindings:[{selector:'#save',event:'click',handler:'save'}]});`,
    `import {createDialog} from '@anikitenko/fdo-sdk';createDialog(dom,{onConfirm:()=>{document.querySelector('output').textContent='Confirmed';}});`,
    `window.addEventListener('resize',resize);window.addEventListener('pagehide',cleanup);`,
    `button.onclick=null;button.onchange=undefined;button.removeEventListener('click',oldListener);`,
    `export const form='<form><input name="name"><button type="button">Save</button></form>';`,
    `client.submit({job:'build'});`,
    `// button.addEventListener('click',()=>{});\nexport const help='Use SDK actions for buttons.';`,
])('permits SDK handlers, component callbacks, grouping and lifecycle work: %s',content=>{
    expect(validate([file(content)])).toEqual([]);
});

test('an unused SDK import cannot hide a manual handler',()=>{
    expect(validate([file(`import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';\n${manual.content}`)]))
        .toEqual([expect.stringContaining('manual click listener')]);
});

test('test fixtures are excluded, while unchanged legacy wiring survives unrelated edits and formatting',()=>{
    expect(validate([{...manual,path:'/actions.test.ts'}])).toEqual([]);
    expect(validate([manual],{baseline:[manual]})).toEqual([]);
    expect(validate([file(manual.content+"\nexport const color='blue';")],{baseline:[manual]})).toEqual([]);
    expect(validate([file(manual.content.replaceAll("'",'"'))],{baseline:[manual]})).toEqual([]);
    expect(validate([file(manual.content+"\nroot.addEventListener('change',()=>{});")],{baseline:[manual]})).toHaveLength(1);
    expect(validate([file(manual.content.replace("textContent='Done'","textContent='Changed'"))],{baseline:[manual]})).toHaveLength(1);
});

test('new copies of an existing legacy listener are still rejected',()=>{
    const source=file("root.addEventListener('click',run);");
    expect(validate([file(source.content+'\n'+source.content)],{baseline:[source]})).toHaveLength(1);
});

test('the per-file generation validator rejects local-only listeners without a backend bridge',()=>{
    expect(validateGeneratedPluginFiles([manual],{partial:true}).errors).toContainEqual(expect.stringContaining('SDK_ACTION_BINDING_REQUIRED'));
});

test('the final merged candidate blocks bypasses before build and does not mutate the workspace',async()=>{
    const workspaceFiles=[file('export const baseline=true;')],build=jest.fn(),typecheck=jest.fn(async()=>({success:true}));
    const errors=await validateAiWorkspaceCandidate({files:[manual],workspaceFiles,readWorkspace:()=>workspaceFiles,
        build,typecheck,assertActive:()=>{}});
    expect(errors).toContainEqual(expect.stringContaining('SDK_ACTION_BINDING_REQUIRED'));
    expect(build).not.toHaveBeenCalled();expect(workspaceFiles[0].content).toBe('export const baseline=true;');
});

test('staged generation repairs an interaction violation before accepting the file',async()=>{
    const request=jest.fn().mockResolvedValueOnce(JSON.stringify(manual)).mockResolvedValueOnce(JSON.stringify(valid));
    const result=await generateStagedWorkspace({prompt:'Implement the Run action',workspaceFiles:[file('export const baseline=true;')],repairPaths:['/actions.ts'],request});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].prompt).toContain('SDK_ACTION_BINDING_REQUIRED');
    expect(request.mock.calls[1][0].prompt).toContain('SDK ACTION REPAIR EXAMPLE');
    expect(result).toContain(valid.content);
});

test('a reported action repair cannot grandfather the rejected source as legacy wiring',async()=>{
    const request=jest.fn().mockResolvedValueOnce(JSON.stringify(manual)).mockResolvedValueOnce(JSON.stringify(valid));
    const result=await generateStagedWorkspace({prompt:'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\n- /actions.ts:1: SDK_ACTION_BINDING_REQUIRED: replace the click listener.',
        workspaceFiles:[manual],repairPaths:['/actions.ts'],request});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].prompt).toContain('SDK ACTION REPAIR EXAMPLE');
    expect(result).toContain(valid.content);
});
