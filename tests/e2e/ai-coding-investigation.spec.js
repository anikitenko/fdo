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
