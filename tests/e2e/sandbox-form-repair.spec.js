const {test,expect,_electron:electron}=require('@playwright/test');
const {transformSync}=require('esbuild');
const sdk=require('@anikitenko/fdo-sdk');
const {bad,good,index}=require('../fixtures/ai/sandbox-form-repair.cjs');
const {launchElectronApp,closeElectronApp,openEditorWithMockedIPC}=require('./helpers/electronApp');

function frontend(source){
    const loaded={exports:{}};
    new Function('require','module','exports',transformSync(source,{loader:'ts',format:'cjs'}).code)(name=>{
        if(name!=='@anikitenko/fdo-sdk')throw new Error('Unexpected fixture dependency');
        return sdk;
    },loaded,loaded.exports);
    return {html:loaded.exports.render(),script:sdk.resolveRenderOnLoadSource(loaded.exports.createViewActions())};
}

test('SDK repair handles clicks and Enter in a real sandbox without allow-forms',async()=>{
    test.setTimeout(90000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    try{
        const opening=app.waitForEvent('window');
        await app.evaluate(async({BrowserWindow})=>{
            const win=new BrowserWindow({show:false,width:700,height:400,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
            await win.loadURL('data:text/html,<iframe title="Commands" sandbox="allow-scripts"></iframe>');
        });
        const page=await opening,errors=[];
        page.on('console',message=>{if(/Blocked form submission/.test(message.text()))errors.push(message.text());});
        const mount=async(source,phase)=>page.evaluate(({html,script,phase})=>{
            document.querySelector('iframe').srcdoc=html.replace('<form',`<form action="https://${phase}.invalid/"`)+`<script>
window.__mutations=0;
window.createBackendReq=async(type,data)=>{if(type!=='UI_MESSAGE'||data.handler!=='run')throw new Error('Unexpected action');window.__mutations++;return {result:{message:'Saved '+data.content.value}};};
window.__cleanup=${script};
</script>`;
        },{...frontend(source),phase});
        const frame=page.frameLocator('iframe[title="Commands"]');
        await mount(bad,'unsafe-fixture');
        await frame.getByRole('button',{name:'Run',exact:true}).click();
        await expect.poll(()=>errors.filter(message=>message.includes('unsafe-fixture.invalid')).length).toBeGreaterThan(0);
        await mount(good,'repaired-fixture');
        await expect(frame.locator('output')).toHaveText('Ready');
        await frame.getByRole('button',{name:'Run',exact:true}).click();
        await expect(frame.locator('output')).toHaveText('Saved Azure');
        await frame.getByRole('textbox',{name:'Value'}).fill('Keyboard');
        await frame.getByRole('textbox',{name:'Value'}).press('Enter');
        await expect(frame.locator('output')).toHaveText('Saved Keyboard');
        await frame.getByRole('textbox',{name:'Notes'}).fill('Line');
        await frame.getByRole('textbox',{name:'Notes'}).press('Enter');
        await expect(frame.getByRole('textbox',{name:'Notes'})).toHaveValue('Line\n');
        expect(await frame.locator('body').evaluate(body=>body.ownerDocument.defaultView.__mutations)).toBe(2);
        await frame.getByRole('textbox',{name:'Value'}).focus();
        await frame.getByRole('textbox',{name:'Value'}).press('Tab');
        await expect(frame.getByRole('button',{name:'Run',exact:true})).toBeFocused();
        expect(errors.filter(message=>message.includes('repaired-fixture.invalid'))).toEqual([]);
        await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts');
    }finally{await closeElectronApp(app);}
});

test('Review & repair discovers old SDK form hazards and rejects an unchanged repair',async()=>{
    test.setTimeout(90000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    try{
        await app.evaluate(({ipcMain},{bad,good})=>{
            globalThis.__formRepair={analyses:0,requests:[]};
            ipcMain.removeHandler('settings:ai_assistants:get');
            ipcMain.handle('settings:ai_assistants:get',()=>[{id:'forms',name:'Form fixture',provider:'openai',model:'fixture',purpose:'coding',default:true,apiKey:'fixture'}]);
            ipcMain.removeHandler('plugin:run-tests');
            ipcMain.handle('plugin:run-tests',()=>({success:true,skipped:false,output:'Fixture tests passed.'}));
            ipcMain.removeHandler('ai-coding-agent:smart-mode');
            ipcMain.handle('ai-coding-agent:smart-mode',(_event,payload)=>{
                globalThis.__formRepair.analyses++;
                return {success:true,requestId:payload.requestId,content:JSON.stringify({status:'completed',summary:'Tests passed.',findings:[],limitations:[]})};
            });
            ipcMain.removeHandler('ai-coding-agent:plan-code');
            ipcMain.handle('ai-coding-agent:plan-code',(_event,payload)=>{
                globalThis.__formRepair.requests.push({paths:payload.repairPaths,prompt:payload.prompt});
                return {success:true,requestId:payload.requestId,content:'### File: /view.ts\n```typescript\n'+(globalThis.__formRepair.requests.length===1?bad:good)+'\n```'};
            });
        },{bad,good});
        const page=await openEditorWithMockedIPC(app,{__useRealAssistants:true});
        await page.waitForFunction(()=>window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        await page.waitForFunction(()=>window.__editorTestApi.getState().nodeModulesLoading===false);
        await page.evaluate(({bad,index})=>{
            const api=window.__editorTestApi;
            for(const id of api.getState().workspaceTreeIds)if(!['/package.json','/tsconfig.json'].includes(id))api.deleteFile(id);
            api.createFile('/package.json',JSON.stringify({name:'form-fixture',version:'1.0.0',main:'index.ts'}),'json');
            api.createFile('/index.ts',index);api.createFile('/view.ts',bad);
        },{bad,index});
        await page.getByRole('tab',{name:'AI Coding Agent',exact:true}).click();
        await page.getByRole('button',{name:'Review & repair',exact:true}).click();
        await expect.poll(()=>page.evaluate(()=>({source:window.__editorTestApi.getFileContent('/view.ts'),
            error:document.querySelector('[data-testid="ai-coding-error"]')?.textContent||''})),{timeout:15000}).toEqual({source:good,error:''});
        try{await expect(page.getByTestId('ai-coding-response')).toContainText('Workspace changes were applied.');}
        catch(failure){throw new Error(failure.message+'\nRepair scopes:\n'+JSON.stringify(await app.evaluate(()=>globalThis.__formRepair.requests.map(request=>({paths:request.paths,diagnostics:request.prompt.slice(request.prompt.indexOf('Problems panel diagnostics:'),request.prompt.indexOf('Problems panel diagnostics:')+1500)}))))+'\nEntry markers:\n'+JSON.stringify(await page.evaluate(()=>window.__editorTestApi.getModelMarkers('/index.ts'))));}
        const state=await app.evaluate(()=>globalThis.__formRepair);
        expect(state.analyses).toBe(1);expect(state.requests).toHaveLength(2);
        expect(state.requests.every(request=>JSON.stringify(request.paths)==='["/view.ts"]')).toBe(true);
        expect(state.requests[0].prompt).toContain('/view.ts:1: SDK_ACTION_BINDING_REQUIRED');
        expect(state.requests[1].prompt).toContain('SDK_ACTION_BINDING_REQUIRED');
        expect(await page.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(index);
    }finally{await closeElectronApp(app);}
});
