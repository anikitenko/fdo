const {test,expect,_electron:electron}=require('@playwright/test');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');

test('native generation repairs manual frontend listeners into SDK actions before accepting the file',async()=>{
    test.setTimeout(120000);
    const bad=`export function makeActions(){return \`document.querySelector('#run').addEventListener('click',()=>{document.querySelector('#result').textContent='Saved';});\`;}`;
    const fixed=`import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
export function makeActions(){return defineRenderOnLoadActions({strict:true,lifecycleKey:'tools.main',handlers:{run:({document})=>{const result=document.querySelector('#result');if(result)result.textContent='Saved';}},bindings:[{selector:'#run',event:'click',handler:'run',required:true,preventDefault:true}]});}`;
    const workspaceFiles=[{path:'/index.ts',content:`import {makeActions} from './actions';export class P {renderOnLoad(){return makeActions();}}`},
        {path:'/actions.ts',content:'export function makeActions(){return "";}'},
        {path:'/render.ts',content:`export const markup='<button id="run" type="button">Run</button><output id="result"></output>';`}];
    const app=await launchElectronApp(electron,{reviewedWorkspaceFixture:true,isolatedUserDataDir:true,
        env:{FDO_E2E_LIVE_AI:'1',FDO_TEST_AI_MAX_REQUESTS:'2'}});
    try{
        const page=await app.firstWindow();
        await expect.poll(()=>page.evaluate(async()=>{try{return Array.isArray(await window.electron.settings.ai.getAssistants());}catch{return false;}})).toBe(true);
        await app.evaluate((_electron,{bad,fixed})=>{
            globalThis.__actionPolicyRequests=[];
            globalThis.fetch=async(url,init={})=>{
                const address=String(url);
                if(address==='http://127.0.0.1:11434/api/show')return Response.json({capabilities:['completion','vision']});
                if(address==='http://127.0.0.1:11434/api/tags')return Response.json({models:[{name:'test-model'}]});
                if(address!=='http://127.0.0.1:11434/api/chat')throw new Error('Unexpected request in SDK action regression');
                const body=JSON.parse(init.body);globalThis.__actionPolicyRequests.push(body);
                const content=JSON.stringify({path:'/actions.ts',lines:(globalThis.__actionPolicyRequests.length===1?bad:fixed).split('\n')});
                const result={message:{role:'assistant',content},done:true,done_reason:'stop',prompt_eval_count:1000,eval_count:100};
                return body.stream?new Response(JSON.stringify(result)+'\n',{headers:{'content-type':'application/x-ndjson'}}):Response.json(result);
            };
        },{bad,fixed});
        const result=await page.evaluate(async workspaceFiles=>{
            await window.electron.settings.ai.addAssistant({name:'SDK action repair',provider:'ollama',purpose:'coding',model:'test-model',apiKey:'',baseUrl:'http://127.0.0.1:11434',contextLength:32768});
            const assistant=(await window.electron.settings.ai.getAssistants()).find(item=>item.name==='SDK action repair');
            return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId:'sdk-action-repair',assistantId:assistant.id,
                prompt:'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\nImplement the Run command in /actions.ts using the installed SDK. Preserve other files.',workspaceFiles,repairPaths:['/actions.ts']}));
        },workspaceFiles);
        expect(result.success,result.error||'').toBe(true);
        expect(result.content).toContain(fixed);
        expect(result.content).not.toContain('addEventListener');
        expect([...result.content.matchAll(/^### File: (.+)$/gm)].map(match=>match[1])).toEqual(['/actions.ts']);
        const requests=await app.evaluate(()=>globalThis.__actionPolicyRequests);
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(requests[0])).toContain('PLUGIN ACTIONS AND MUTATIONS');
        expect(JSON.stringify(requests[1])).toContain('SDK_ACTION_BINDING_REQUIRED');
        expect(JSON.stringify(requests[1])).toContain('SDK ACTION REPAIR EXAMPLE');
    }finally{await closeElectronApp(app);}
});
