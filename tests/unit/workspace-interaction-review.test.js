import {findWorkspaceInteractionIssues,validateGeneratedInteractions,interactionRepairDiagnostics,isSandboxedFormSubmissionError} from '../../src/utils/plugins/validation/generatedInteractions';
import {includeWorkspaceAuthoringFindings,includeWorkspaceInteractionFindings,workspaceReviewContext} from '../../src/components/editor/utils/aiCodingAgentReview';
import {isInvestigationPrompt} from '../../src/components/editor/utils/aiCodingAgentInvestigation';
import {validateAiWorkspaceCandidate} from '../../src/components/editor/utils/validateAiWorkspaceCandidate';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
import {classifyAiCodingIssueScope} from '../../src/components/editor/utils/aiCodingAgentIssueScope';
const {bad,good}=require('../fixtures/ai/sandbox-form-repair.cjs');
const file=content=>({path:'/view.ts',content});

test('existing SDK-only forms surface deterministic findings even when the model reports no issues',()=>{
    const files=[file(bad)],report={status:'completed',summary:'Tests passed.',findings:[],limitations:[]};
    includeWorkspaceAuthoringFindings(report,files);includeWorkspaceInteractionFindings(report,files);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].evidence).toContain('defaults to submit');
    expect(report.findings[0].evidence).toContain('implicitly on Enter');
    expect(report.findings[0].repair).toContain('do not request or add it');
    expect(workspaceReviewContext(files)).toContain('allow-forms');
    expect(findWorkspaceInteractionIssues([file(good)])).toEqual([]);
});

test.each([
    "Blocked form submission to '' because the form's frame is sandboxed and the 'allow-forms' permission is not set.",
    'Please fix: Blocked form submission to about:blank.',
])('the sandbox console diagnostic routes to investigation without host permission changes: %s',prompt=>{
    expect(isSandboxedFormSubmissionError(prompt)).toBe(true);
    expect(isInvestigationPrompt(prompt)).toBe(true);
    expect(classifyAiCodingIssueScope({prompt}).kind).toBe('plugin');
});

test('an explicit interaction repair must remove existing hazards before candidate build',async()=>{
    const files=[file(bad)],build=jest.fn(),typecheck=jest.fn(async()=>({success:true}));
    expect(validateGeneratedInteractions(files,{baseline:files})).toEqual([]);
    const errors=await validateAiWorkspaceCandidate({files,workspaceFiles:files,readWorkspace:()=>files,requiredInteractionPaths:['/view.ts'],
        build,typecheck,assertActive:()=>{}});
    expect(errors).toContainEqual(expect.stringContaining('SDK_ACTION_BINDING_REQUIRED'));
    expect(build).not.toHaveBeenCalled();
    expect(validateGeneratedInteractions([file(good)],{baseline:files,requiredPaths:['/view.ts']})).toEqual([]);
});

test('review diagnostics enforce action repair during staged generation instead of grandfathering the old file',async()=>{
    const findings=findWorkspaceInteractionIssues([file(bad)]);
    const request=jest.fn().mockResolvedValueOnce(JSON.stringify(file(bad))).mockResolvedValueOnce(JSON.stringify(file(good)));
    const result=await generateStagedWorkspace({prompt:'Repair these findings.\n'+JSON.stringify(findings)+'\n'+interactionRepairDiagnostics(findings),
        workspaceFiles:[file(bad)],repairPaths:['/view.ts'],request});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].prompt).toContain('SDK ACTION REPAIR EXAMPLE');
    expect(result).toContain(good);
});

test('SDK builder defaults and imported button fragments are checked in form context',()=>{
    const files=[file(`import {DOMNested,DOMInput} from '@anikitenko/fdo-sdk';import {button} from './button';export const render=()=>new DOMNested().createForm([new DOMInput().createInput('text'),button]);`),
        {path:'/button.ts',content:`import {DOMButton} from '@anikitenko/fdo-sdk';export const button=new DOMButton().createStaticButton('Run');`}];
    expect(findWorkspaceInteractionIssues(files).map(finding=>finding.file)).toEqual(['/button.ts']);
    expect(validateGeneratedInteractions([{path:'/button.ts',content:files[1].content}])).toEqual([]);
    const local=file(`import {DOMNested,DOMInput,DOMButton} from '@anikitenko/fdo-sdk';export const render=()=>new DOMNested().createForm([new DOMInput().createInput('text'),new DOMButton().createStaticButton('Run',{},'run',{type:'button'})]);`);
    expect(findWorkspaceInteractionIssues([local])[0].evidence).toContain('implicitly on Enter');
});

test('plain-text values and JSON examples remain user data while typed native form calls are found',()=>{
    expect(findWorkspaceInteractionIssues([file(`output.textContent='<form><button>Example</button></form>';input.value='<input type="submit">';const seed='{"example":"<form><button>Data</button></form>"}';`)])).toEqual([]);
    for(const content of [
        `export function send(form:HTMLFormElement){form.requestSubmit();}`,
        `export function send(event:Event){(event.currentTarget as HTMLFormElement).submit();}`,
        `const form=document.createElement('form');form.submit();`,
    ])expect(findWorkspaceInteractionIssues([file(content)])[0].evidence).toMatch(/form\.(?:requestSubmit|submit)/);
});

test('a keydown binding without prevention does not establish an Enter guard',()=>{
    const unguarded=good.replace('event.preventDefault();','').replace("handler: 'enter', required: true","handler: 'enter', preventDefault: false, required: true");
    expect(findWorkspaceInteractionIssues([file(unguarded)])[0].evidence).toContain('implicitly on Enter');
});

test('constant spread attributes and named SDK keyboard handlers keep supported forms working',()=>{
    const spread=good.replace("type:'button'","...{type:'button'}");
    expect(findWorkspaceInteractionIssues([file(spread)])).toEqual([]);
    const named=`import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
function enter({event}){if(event.key==='Enter')event.preventDefault();}
export const html='<form><input><button type="button">Run</button></form>';
export const actions=()=>defineRenderOnLoadActions({handlers:{enter},bindings:[{selector:'input',event:'keydown',handler:'enter'}]});`;
    expect(findWorkspaceInteractionIssues([file(named)])).toEqual([]);
});
