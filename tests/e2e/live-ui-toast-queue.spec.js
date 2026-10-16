const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');
const {deploySdkExample,selectPluginOpen,removePlugin}=require('./helpers/sdkExamples');
test('authored toast buttons share bounded queues, drain on dismiss and survive rerender',async()=>{
    test.setTimeout(150000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-toast-queues-')),pluginName='toast-queue-builder';
    try {
        const home=await app.firstWindow(),opening=app.waitForEvent('window');
        await home.evaluate(name=>window.electron.system.openEditorWindow({name,template:'blank'}),pluginName);
        const editor=await opening;await editor.waitForFunction(()=>window.__editorTestApi?.getState().currentVersion);
        const original=await editor.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'));
        const previewOpening=app.waitForEvent('window');await editor.getByRole('button',{name:'Live UI editor',exact:true}).click();
        const visual=await previewOpening;await visual.getByText('SDK catalog',{exact:true}).click();
        await visual.getByRole('button',{name:'main',exact:true}).click();await visual.getByRole('button',{name:'Add Toast Region',exact:true}).click();
        for(let n=1;n<=4;n++) {
            await visual.getByRole('button',{name:'Inspect Toast Region',exact:true}).click();
            await visual.getByRole('button',{name:'Add toast to region',exact:true}).click();
        }
        for(let n=1;n<=4;n++) {
            await visual.getByRole('button',{name:'main',exact:true}).click();
            await visual.getByLabel('Add component',{exact:true}).selectOption('button');
            await visual.getByRole('button',{name:'Preview addition',exact:true}).click();
            await visual.getByRole('button',{name:'button · New button',exact:true}).click();
            const section=visual.locator('details').filter({has:visual.getByText('Enqueue SDK toast',{exact:true})});
            if(!await section.evaluate(node=>node.open)) await section.locator('summary').click();
            const toastId='fdo-toast'+(n===1 ? '' : '-'+n);
            await visual.getByLabel('Toast to enqueue',{exact:true}).selectOption('fdo-toast-region/'+toastId);
            if(n===1) {await visual.getByLabel('Visible toast limit',{exact:true}).fill('1');await visual.getByLabel('Queued toast limit',{exact:true}).fill('1');}
            else {await expect(visual.getByLabel('Visible toast limit',{exact:true})).toBeDisabled();await expect(visual.getByLabel('Queued toast limit',{exact:true})).toHaveValue('1');}
            if(n===4) await visual.getByLabel('Toast auto-dismiss (ms)',{exact:true}).fill('1000');
            await visual.getByRole('button',{name:'Preview toast connection',exact:true}).click();
            await expect(visual.getByRole('button',{name:'Disconnect toast action',exact:true})).toBeEnabled();
            if(n===1) {
                await visual.getByRole('button',{name:'Disconnect toast action',exact:true}).click();
                await expect(visual.getByLabel('Toast to enqueue',{exact:true})).toHaveValue('');
                await visual.getByRole('button',{name:'Undo',exact:true}).click();
                await expect(visual.getByRole('button',{name:'Disconnect toast action',exact:true})).toBeEnabled();
            }
            await visual.getByLabel('Text',{exact:true}).fill('Notify '+n);await visual.getByRole('button',{name:'Preview change',exact:true}).click();
        }
        await visual.getByLabel('Toast to enqueue',{exact:true}).scrollIntoViewIfNeeded();
        const screenshot=test.info().outputPath('toast-queue-authoring.png');await visual.screenshot({path:screenshot,animations:'disabled'});await test.info().attach('Toast queue authoring',{path:screenshot,contentType:'image/png'});
        expect(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(original);
        await visual.getByRole('button',{name:'Apply to workspace',exact:true}).click();await expect(visual.getByRole('status')).toContainText('Applied. Restore point:');
        const files=await editor.evaluate(()=>Object.fromEntries(window.__editorTestApi.getState().workspaceTreeIds.filter(id=>!id.startsWith('/node_modules/')&&!id.startsWith('/dist/')).map(id=>[id,window.__editorTestApi.getFileContent(id)]).filter(([,content])=>typeof content==='string')));
        const build=await home.evaluate(latestContent=>window.electron.plugin.build({latestContent}),files);expect(build.success,build.error).toBe(true);
        fs.writeFileSync(path.join(folder,'index.ts'),files['/index.ts']);await home.evaluate(()=>{window.__E2E__=false;});
        await deploySdkExample(home,{absPath:path.join(folder,'index.ts'),relativePath:'visual-toast-queues'},{pluginName,compiledContent:build.files.outputFiles.find(file=>!file.path.endsWith('.map')).text});await selectPluginOpen(home,pluginName);await visual.close();await editor.close();
        const mainWindow=await app.browserWindow(home);await mainWindow.evaluate(window=>{window.show();window.focus();});await home.bringToFront();
        const frame=home.frameLocator(`iframe[data-plugin-id="${pluginName}"]`),region=frame.locator('#fdo-toast-region');
        const first=frame.getByRole('button',{name:'Notify 1',exact:true}),second=frame.getByRole('button',{name:'Notify 2',exact:true}),third=frame.getByRole('button',{name:'Notify 3',exact:true});
        await first.click();await expect(region.locator('#fdo-toast')).toBeVisible();await expect(first).toBeDisabled();
        await second.click();await expect(second).toBeDisabled();await expect(region.locator('#fdo-toast-2')).toBeHidden();
        await third.click();await expect(third).toBeEnabled();await expect(frame.locator('button[data-fdo-ui-toast-id="fdo-toast-3"] + span')).toHaveText('Notification queue is full.');
        await region.locator('#fdo-toast').getByRole('button',{name:'Dismiss',exact:true}).click();await expect(region.locator('#fdo-toast-2')).toBeVisible();await expect(first).toBeEnabled();
        await third.click();await expect(third).toBeDisabled();await region.locator('#fdo-toast-2').getByRole('button',{name:'Dismiss',exact:true}).click();await expect(region.locator('#fdo-toast-3')).toBeVisible();
        await region.locator('#fdo-toast-3').getByRole('button',{name:'Dismiss',exact:true}).click();await first.click();await expect(region.locator('#fdo-toast')).toBeVisible();
        await home.evaluate(id=>window.electron.plugin.render(id),pluginName);await expect(region.locator('#fdo-toast')).toBeHidden();await expect(first).toBeEnabled();await first.click();await expect(region.locator('#fdo-toast')).toBeVisible();
        await region.locator('#fdo-toast').getByRole('button',{name:'Dismiss',exact:true}).click();
        const automatic=frame.getByRole('button',{name:'Notify 4',exact:true});await expect(automatic).toHaveAttribute('data-fdo-ui-toast-duration','1000');await expect.poll(()=>frame.locator('main').evaluate(()=>document.hidden)).toBe(false);await automatic.click();await expect(region.locator('#fdo-toast-4')).toBeVisible();await region.locator('#fdo-toast-4').hover();await frame.getByRole('heading',{name:pluginName,exact:true}).hover();
        await expect.poll(()=>region.locator('#fdo-toast-4').evaluate(node=>node.matches(':hover'))).toBe(false);
        await expect(region.locator('#fdo-toast-4')).toBeHidden();await expect(automatic).toBeEnabled();
    } finally {const home=await app.firstWindow().catch(()=>null);if(home) await removePlugin(home,pluginName).catch(()=>{});await closeElectronApp(app);fs.rmSync(folder,{recursive:true,force:true});}
});
