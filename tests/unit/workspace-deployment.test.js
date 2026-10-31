/** @jest-environment node */
import {workspaceDeployment,deploymentFindings,validateAiDeploymentChanges,deploymentInstructions} from '../../src/utils/plugins/deployment/workspaceDeployment';
import {planDeploymentEdit,reviewDeploymentChange} from '../../src/utils/plugins/deployment/deploymentEditing';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {savedVisualDraft,restoreVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftRecovery';
const source=command=>`import {createScopedProcessExecActionRequest as request} from '@anikitenko/fdo-sdk';export const probe=request('cloud',{command:${JSON.stringify(command)},args:['account','show']});`;
const files=(deployment)=>({'/package.json':JSON.stringify({name:'cloud',source:'index.ts',scripts:{build:'keep'},fdo:{compatibility:{fdo:'>=1.0.3 <2'},...(deployment!==undefined?{deployment}:{})}},null,2),' /unused':'ignored','/index.ts':source('/usr/bin/az')});
const declaration={schemaVersion:1,tools:[{id:'azure-cli'}]};

test('one assessment separates source declaration from unexecuted installation, authentication and authorization',()=>{
    const state=workspaceDeployment(files());
    expect(state.status).toBe('needs-declaration');expect(state.suggestions[0]).toMatchObject({id:'azure-cli',confirmed:true,path:'/index.ts'});
    expect(state.checks).toMatchObject({installation:'not-run',authentication:'not-verified',authorization:'not-verified'});
    expect(state.authentication[0]).toMatchObject({provider:'azure',guidance:{interactive:'az login --use-device-code'}});
    const configured=workspaceDeployment(files(declaration));expect(configured.status).toBe('declared');expect(configured.tools[0].id).toBe('azure-cli');expect(configured.checks.authentication).toBe('not-verified');
});

test('the deployed source graph excludes unused tooling and only reports actual CLI evidence',()=>{
    const original=files();original['/index.ts']="import './backend';";original['/backend.ts']=source('/usr/bin/az');original['/scripts/smoke.ts']=source('/usr/bin/aws');
    const state=workspaceDeployment(original);expect(state.suggestions.map(tool=>tool.id)).toEqual(['azure-cli']);expect(state.usage[0].path).toBe('/backend.ts');
    expect(deploymentFindings(original)).toEqual([expect.objectContaining({file:'/package.json',code:'FDO_DEPLOYMENT_UNDECLARED'})]);
});

test('dynamic defaults are suggestions, not proof or automatic repair findings',()=>{
    const original=files();original['/index.ts']="const settings={cli:'/opt/homebrew/bin/az'};createScopedProcessExecActionRequest('cloud',{command:settings.cli,args:[]});";
    const state=workspaceDeployment(original);expect(state.suggestions[0]).toMatchObject({id:'azure-cli',confirmed:false});expect(deploymentFindings(original)).toEqual([]);
    expect(state.status).toBe('needs-declaration');
});

test('unknown custom tools require a definition without invented publisher trust',()=>{
    const original=files();original['/index.ts']=source('/opt/vendor/bin/other-cli');
    expect(workspaceDeployment(original).unknownCalls[0].command).toContain('other-cli');
    expect(validateAiDeploymentChanges({},original).join(' ')).toContain('FDO_DEPLOYMENT_UNKNOWN');
});

test('AI application requires tool metadata for new CLI code and preserves existing deployment policy',()=>{
    const before=files();before['/index.ts']='export const value=1;';
    expect(validateAiDeploymentChanges(before,files()).join(' ')).toContain('FDO_DEPLOYMENT_REQUIRED');
    expect(validateAiDeploymentChanges(before,files(declaration))).toEqual([]);
    expect(validateAiDeploymentChanges(files(declaration),files()).join(' ')).toContain('cannot remove');
    const changed=files({schemaVersion:1,tools:[]});expect(validateAiDeploymentChanges(files(declaration),changed).join(' ')).toContain('required tool azure-cli');
    const bad=files({schemaVersion:1,tools:{bad:true}});expect(()=>validateAiDeploymentChanges(bad,bad)).not.toThrow();expect(workspaceDeployment(bad).editable).toBe(false);
});

test('AI cannot invent artifact downloads or change image pins behind a code repair',()=>{
    const custom={id:'vendor',command:'vendor',version:'*',executable:'/usr/bin/vendor',installer:{type:'provided'}};
    const next=files({schemaVersion:1,tools:[{id:'azure-cli'},custom]});
    expect(validateAiDeploymentChanges(files(declaration),next).join(' ')).toContain('Review custom installer');
    expect(validateAiDeploymentChanges(next,next)).toEqual([]);
    expect(deploymentInstructions(next)).toContain('not execution');expect(deploymentInstructions(next)).toContain('CLI-backed scaffold');
});

test('reviewed deployment edits preserve scripts, dependencies and support policy',()=>{
    const original=files(),patch=planDeploymentEdit(original,{declaration});
    const after={...original,'/package.json':patch.after};expect(reviewDeploymentChange(original,after).deployment).toEqual(declaration);
    expect(JSON.parse(patch.after).scripts).toEqual({build:'keep'});expect(JSON.parse(patch.after).fdo.compatibility).toEqual({fdo:'>=1.0.3 <2'});
    expect(()=>reviewDeploymentChange(original,{...after,'/index.ts':'changed'})).toThrow('only package.json');
    const tampered=JSON.parse(patch.after);tampered.scripts.build='unsafe';expect(()=>reviewDeploymentChange(original,{...after,'/package.json':JSON.stringify(tampered)})).toThrow('cannot modify');
    expect(planDeploymentEdit(after,{declaration})).toBeNull();
});

test('metadata-only drafts work with unsupported previews, support undo/redo and recover without changing source',async()=>{
    const values=files();delete values[' /unused'];const original=Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
    const base={workspaceId:'cloud',revision:'r1',files:original};
    const render=async()=>({status:'unsupported',message:'Custom render adapter.',elements:[]});const options={base,render,acceptFiles:value=>value};
    const draft=await prepareVisualDraft({...options,preview:await render(),request:{kind:'deployment',declaration}});
    expect(draft.deploymentOnly).toBe(true);expect(draft.files['/index.ts']).toBe(original['/index.ts']);
    const undone=await prepareVisualDraft({...options,previous:draft,preview:draft.preview,request:{kind:'undo'}});expect(undone.patches).toEqual([]);
    const redone=await prepareVisualDraft({...options,previous:undone,preview:undone.preview,request:{kind:'redo'}});expect(redone.files).toEqual(draft.files);
    const recovered=await restoreVisualDraft(savedVisualDraft(base,redone,'sdk'),base,'sdk',render,value=>value);expect(recovered.deploymentOnly).toBe(true);expect(recovered.files).toEqual(draft.files);
});

test('AI cannot weaken a required CLI version to silence the installer check',()=>{
    const before=files({schemaVersion:1,tools:[{id:'azure-cli',version:'2.91.0'}]});
    const after=files({schemaVersion:1,tools:[{id:'azure-cli',version:'*'}]});
    expect(validateAiDeploymentChanges(before,after).join(' ')).toContain('cannot weaken the required version');
});

test('the generator validation boundary rejects new CLI code without its deployment declaration',()=>{
    const {validateGeneratedPluginFiles}=require('../../src/components/editor/utils/validateGeneratedPluginFiles');
    const next=files();const candidate=Object.entries(next).filter(([file])=>file.startsWith('/')).map(([path,content])=>({path,content}));
    expect(validateGeneratedPluginFiles(candidate).errors.join(' ')).toContain('FDO_DEPLOYMENT_REQUIRED');
});

test.each([false,0,'',[]])('malformed deployment declaration %p is reported instead of treated as missing',value=>{
    expect(workspaceDeployment(files(value))).toMatchObject({status:'invalid',editable:false});
});
test('future deployment schemas are preserved rather than silently downgraded',()=>{
    const future=files({schemaVersion:2,tools:[{id:'azure-cli'}]});
    expect(workspaceDeployment(future).editable).toBe(false);
    expect(validateAiDeploymentChanges(future,files(declaration)).join(' ')).toContain('cannot migrate or downgrade');
});
