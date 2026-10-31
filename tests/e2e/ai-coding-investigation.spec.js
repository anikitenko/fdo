const {test,expect,_electron:electron}=require('@playwright/test');
const {launchElectronApp,closeElectronApp,openEditorWithMockedIPC}=require('./helpers/electronApp');

for(const stop of [false,true])test(stop?'Stop prevents another analysis after a pending investigation check':'investigation performs source/check actions and analyzes results after a prose-only acknowledgement',async()=>{
    test.setTimeout(90000);let app;
    try {
        app=await launchElectronApp(electron,{isolatedUserDataDir:true});
        await app.evaluate(({ipcMain})=>{
            ipcMain.removeHandler('settings:ai_assistants:get');
            ipcMain.handle('settings:ai_assistants:get',()=>[{id:'investigation-fixture',name:'Investigation fixture',provider:'openai',model:'fixture',purpose:'coding',default:true,apiKey:'fixture'}]);
        });
        const page=await openEditorWithMockedIPC(app,{__useRealAssistants:true});
        await page.waitForFunction(()=>!!window.__editorTestApi?.getFileContent);
        const baseline=await page.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'));
        await app.evaluate(({ipcMain},{stop})=>{
            globalThis.__investigation={calls:[],checks:0,mutations:0};
            ipcMain.removeHandler('plugin:plugin-typecheck');
            ipcMain.handle('plugin:plugin-typecheck',async()=>{
                globalThis.__investigation.checks++;
                if(stop)return new Promise(resolve=>{globalThis.__finishInvestigationCheck=resolve;});
                return {success:false,diagnostics:[{path:'/index.ts',message:'Missing render registration fixture'}]};
            });
            ipcMain.removeHandler('ai-coding-agent:plan-code');
            ipcMain.handle('ai-coding-agent:plan-code',async()=>{globalThis.__investigation.mutations++;throw new Error('Investigation must stay read-only.');});
            ipcMain.removeHandler('ai-coding-agent:smart-mode');
            ipcMain.handle('ai-coding-agent:smart-mode',async (_event,payload)=>{
                globalThis.__investigation.calls.push(payload);
                const count=globalThis.__investigation.calls.length;
                let content;
                if(count===1&&!stop)content='I will investigate.';
                else if(count===(stop?1:2))content=JSON.stringify({status:'continue',summary:'Read the entry point; check the runtime contract.',actions:[{tool:'readFiles',paths:['/index.ts'],startLine:1,endLine:10},{tool:'typecheck'}],findings:[],limitations:[]});
                else content=JSON.stringify({status:'partial',summary:'The host check confirmed a missing render registration.',actions:[],findings:[{severity:'error',file:'/index.ts',issue:'Render registration is missing.',evidence:'Host typecheck: Missing render registration fixture',repair:'Register the plugin render handler.'}],limitations:['Live UI was not inspected.']});
                return {success:true,requestId:payload.requestId,content};
            });
        },{stop});
        await page.getByRole('tab',{name:'AI Coding Agent',exact:true}).click();
        await page.locator('#prompt-input').fill('Investigate why my plugin UI is not starting');
        await page.getByRole('button',{name:'Submit',exact:true}).click();
        if(stop) {
            await expect.poll(()=>app.evaluate(()=>globalThis.__investigation.checks)).toBe(1);
            await page.getByRole('button',{name:'Stop',exact:true}).click();
            await app.evaluate(()=>globalThis.__finishInvestigationCheck({success:true}));
            await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeEnabled();
            expect(await app.evaluate(()=>globalThis.__investigation.calls.length)).toBe(1);
        }else {
            await expect(page.getByTestId('ai-coding-response').getByText('The host check confirmed a missing render registration.',{exact:true})).toBeVisible();
            const state=await app.evaluate(()=>globalThis.__investigation);
            expect(state.calls).toHaveLength(3);expect(state.checks).toBe(1);expect(state.mutations).toBe(0);
            expect(state.calls[2].context).toContain('Missing render registration fixture');
            expect(state.calls.every(call=>call.investigation===true)).toBe(true);
            await expect(page.getByText(/Investigation actions:/)).toContainText('typecheck');
        }
        expect(await page.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(baseline);
    }finally{if(app)await closeElectronApp(app);}
});

for(const stale of [false,true])test(stale?'saved review refuses a repair after source changes':'budget-exhausted review repairs saved findings without another investigation',async()=>{
    test.setTimeout(90000);let app;
    const candidate=`import {DOM} from '@anikitenko/fdo-sdk';export function render(){const dom=new DOM();return dom.renderHTML(dom.createElement('p',{id:'summary'},'Ready'));}`;
    try{
        app=await launchElectronApp(electron,{isolatedUserDataDir:true});
        await app.evaluate(({ipcMain},{candidate})=>{
            globalThis.__reviewRecoveryCalls={analysis:0,repair:[]};
            ipcMain.removeHandler('settings:ai_assistants:get');
            ipcMain.handle('settings:ai_assistants:get',()=>[{id:'review-fixture',name:'Review fixture',provider:'openai',model:'fixture',purpose:'coding',default:true,apiKey:'fixture'}]);
            ipcMain.removeHandler('plugin:run-tests');
            ipcMain.handle('plugin:run-tests',()=>({success:true,skipped:false,output:'Fixture suite passed.'}));
            ipcMain.removeHandler('ai-coding-agent:smart-mode');
            ipcMain.handle('ai-coding-agent:smart-mode',(_event,payload)=>{
                globalThis.__reviewRecoveryCalls.analysis++;
                return {success:true,requestId:payload.requestId,usage:{input_tokens:200000,output_tokens:100},
                    content:JSON.stringify({status:'partial',summary:'The investigation reached its budget.',findings:[],limitations:['Runtime not inspected.']})};
            });
            ipcMain.removeHandler('ai-coding-agent:plan-code');
            ipcMain.handle('ai-coding-agent:plan-code',(_event,payload)=>{
                globalThis.__reviewRecoveryCalls.repair.push(payload.repairPaths);
                return {success:true,requestId:payload.requestId,content:'### File: /view.ts\n```typescript\n'+candidate+'\n```'};
            });
        },{candidate});
        const page=await openEditorWithMockedIPC(app,{__useRealAssistants:true});
        await page.waitForFunction(()=>window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        const baseline=await page.evaluate(()=>{
            const api=window.__editorTestApi;
            for(const id of api.getState().workspaceTreeIds)if(!['/package.json','/tsconfig.json'].includes(id))api.deleteFile(id);
            api.createFile('/package.json',JSON.stringify({name:'review-fixture',version:'1.0.0',main:'index.ts'}),'json');
            api.createFile('/index.ts',`import {FDO_SDK} from '@anikitenko/fdo-sdk';import {render} from './view';
export default class Plugin extends FDO_SDK {get metadata(){return {name:'Review fixture',version:'1.0.0',author:'Tests',description:'Review recovery',icon:'cog'};}init():void{}render():string{return render();}}new Plugin();`);
            api.createFile('/view.ts',`export const render = () => '<p id="summary">Ready</p>';`);
            return api.getFileContent('/index.ts');
        });
        await page.getByRole('tab',{name:'AI Coding Agent',exact:true}).click();
        await page.getByRole('button',{name:'Review & repair',exact:true}).click();
        const recover=page.getByRole('button',{name:'Repair confirmed findings',exact:true});
        await expect(recover).toBeEnabled();
        await expect(page.getByTestId('ai-coding-response')).toContainText('1 confirmed finding(s) are saved');
        await expect(page.getByTestId('ai-coding-response')).not.toContainText('No confirmed issues were identified');
        if(stale)await page.evaluate(()=>window.__editorTestApi.createFile('/view.ts','export const newer=true;'));
        await recover.click();
        if(stale){
            await expect(page.getByTestId('ai-coding-error')).toContainText('workspace changed since this review');
            expect(await app.evaluate(()=>globalThis.__reviewRecoveryCalls.repair)).toEqual([]);
        }else{
            try{
                await expect.poll(()=>page.evaluate(()=>({source:window.__editorTestApi.getFileContent('/view.ts'),
                    error:document.querySelector('[data-testid="ai-coding-error"]')?.textContent||''}))).toEqual({source:candidate,error:''});
            }catch(failure){
                throw new Error(failure.message+'\nEditor state:\n'+await page.locator('body').innerText());
            }
            expect(await app.evaluate(()=>globalThis.__reviewRecoveryCalls.repair)).toEqual([['/view.ts']]);
            await expect(page.getByRole('button',{name:'Continue review',exact:true})).toBeVisible();
        }
        expect(await app.evaluate(()=>globalThis.__reviewRecoveryCalls.analysis)).toBe(1);
        expect(await page.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(baseline);
    }finally{if(app)await closeElectronApp(app);}
});
