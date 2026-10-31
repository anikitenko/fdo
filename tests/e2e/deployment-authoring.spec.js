const {test,expect,_electron:electron}=require('@playwright/test');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');

test('deployment tools are reviewed and applied in Live UI and handed to AI without executing login or cloud operations',async()=>{
    test.setTimeout(120000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    try {
        await app.evaluate(({ipcMain})=>{
            globalThis.__deploymentAiCalls=[];
            ipcMain.removeHandler('settings:ai_assistants:get');ipcMain.handle('settings:ai_assistants:get',()=>[{id:'deployment',name:'Deployment fixture',provider:'openai',model:'fixture',purpose:'coding',default:true,apiKey:'fixture'}]);
            for(const action of ['smart','generate','edit','fix','plan']){const channel=`ai-coding-agent:${action}-code`;ipcMain.removeHandler(channel);ipcMain.handle(channel,(_event,request)=>{globalThis.__deploymentAiCalls.push(request);return {success:false,error:'This test prepares review only.'};});}
        });
        const home=await app.firstWindow(),opening=app.waitForEvent('window');
        await home.evaluate(()=>window.electron.system.openEditorWindow({name:'Deployment authoring',template:'blank'}));
        const editor=await opening;
        await editor.waitForFunction(()=>window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        await editor.waitForFunction(()=>window.__editorTestApi.getState().nodeModulesLoading===false);
        const pkg=JSON.stringify({name:'cloud-authoring',version:'1.0.0',source:'index.ts',scripts:{build:'keep-this-script'}},null,2);
        const source=`import {FDO_SDK,DOM,createScopedProcessExecActionRequest} from '@anikitenko/fdo-sdk';
export function azureProbe(){return createScopedProcessExecActionRequest('cloud',{command:'/usr/bin/az',args:['account','show']});}
class Cloud extends FDO_SDK {get metadata(){return {name:'Cloud authoring',version:'1.0.0',author:'FDO',description:'Deployment fixture',icon:'cloud'};} init(){} render(){const dom=new DOM();return dom.renderHTML(dom.createElement('main',{},dom.createElement('h1',{},'Cloud fixture')));}}
new Cloud();`;
        await editor.evaluate(({pkg,source})=>{window.__editorTestApi.createFile('/package.json',pkg);window.__editorTestApi.createFile('/index.ts',source);},{pkg,source});
        const openingVisual=app.waitForEvent('window');await editor.getByRole('button',{name:'Live UI editor',exact:true}).click();const visual=await openingVisual;
        const deployment=visual.getByRole('region',{name:'Plugin deployment requirements',exact:true});
        await expect(deployment.getByText('Installation: not run here')).toBeVisible();await expect(deployment.getByText('Cloud sign-in / roles: not verified')).toBeVisible();
        await deployment.getByRole('button',{name:'Review detected tools',exact:true}).click();
        const dialog=visual.getByRole('dialog',{name:'Manage deployment requirements',exact:true});
        await dialog.getByLabel('Version constraint for azure-cli',{exact:true}).fill('^2.91.0');
        await dialog.getByRole('button',{name:'Preview deployment changes',exact:true}).click();await expect(dialog).toBeHidden();
        await expect(visual.getByRole('heading',{name:'Review deployment declaration',exact:true})).toBeVisible();
        expect(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/package.json'))).toBe(pkg);
        await visual.getByRole('button',{name:'Undo',exact:true}).click();await expect(visual.getByText('No unapplied changes',{exact:true})).toBeVisible();
        await visual.getByRole('button',{name:'Redo',exact:true}).click();await visual.getByRole('button',{name:'Apply to workspace',exact:true}).click();
        await expect(visual.getByRole('status')).toContainText('Deployment declaration applied');
        const updated=JSON.parse(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/package.json')));
        expect(updated.fdo.deployment).toEqual({schemaVersion:1,tools:[{id:'azure-cli',version:'^2.91.0'}]});expect(updated.scripts).toEqual({build:'keep-this-script'});
        expect(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(source);
        await deployment.locator('details').first().evaluate(node=>{node.open=true;});
        await deployment.getByRole('button',{name:'Prepare AI deployment review',exact:true}).click();
        await expect(editor.locator('#prompt-input')).toHaveValue(/Workspace quality review.*deployment requirements/);
        await expect(editor.locator('#action-select')).toHaveValue('smart');
        await expect(editor.getByText('Deployment review preview',{exact:true})).toBeVisible();
        await expect(editor.getByText('Review workspace deployment requirements',{exact:true})).toBeVisible();
        await expect(editor.getByText('Current selection will be treated as the edit target.',{exact:true})).toBeHidden();
        const aiDeployment=editor.getByRole('region',{name:'Plugin deployment requirements',exact:true});
        await aiDeployment.locator('details').first().evaluate(node=>{node.open=true;});
        await expect(aiDeployment.getByText('Cloud sign-in / roles: not verified')).toBeVisible();
        expect(await app.evaluate(()=>globalThis.__deploymentAiCalls)).toEqual([]);
        await aiDeployment.getByRole('button',{name:'Manage in Live UI',exact:true}).click();
        await expect(deployment.getByRole('button',{name:'Manage deployment requirements',exact:true})).toBeVisible();
        await expect(visual.getByRole('heading',{name:'Live UI · Cloud authoring',exact:true})).toBeInViewport();
        await visual.screenshot({path:test.info().outputPath('live-ui-deployment-requirements.png'),animations:'disabled'});
        await aiDeployment.scrollIntoViewIfNeeded();
        await editor.screenshot({path:test.info().outputPath('ai-deployment-requirements.png'),animations:'disabled'});
    }finally{await closeElectronApp(app);}
});
