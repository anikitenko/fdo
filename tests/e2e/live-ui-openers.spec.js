const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');
const {deploySdkExample,selectPluginOpen,removePlugin}=require('./helpers/sdkExamples');
test('visual dialog/popover openers deploy with native controllers and preserve existing plugin actions',async()=>{
    test.setTimeout(150000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-visual-openers-')),pluginName='opener-builder';
    let visual;
    try {
        const home=await app.firstWindow(),opening=app.waitForEvent('window');
        await home.evaluate(()=>window.electron.system.openEditorWindow({name:'opener-builder',template:'blank'}));
        const editor=await opening;
        await editor.waitForFunction(()=>window.__editorTestApi?.getState().currentVersion);
        const originalMain=await editor.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'));
        const previewOpening=app.waitForEvent('window');
        await editor.getByRole('button',{name:'Live UI editor',exact:true}).click();
        visual=await previewOpening; const preview=visual.frameLocator('iframe[title="Plugin UI preview"]');
        await visual.getByText('SDK catalog',{exact:true}).click();
        for(const name of ['Dialog','Popover','Confirmation Dialog']) {
            await visual.getByRole('button',{name:'main',exact:true}).click();
            await visual.getByRole('button',{name:'Add '+name,exact:true}).click();
            await expect(visual.getByRole('button',{name:'Inspect '+name+' · New '+name,exact:true})).toBeVisible();
        }
        await visual.getByRole('button',{name:'main',exact:true}).click();
        await visual.getByLabel('Add component',{exact:true}).selectOption('result');
        await visual.getByRole('button',{name:'Preview addition',exact:true}).click();
        for(const [id,label] of [['fdo-dialog','Open settings'],['fdo-popover','Open details'],['fdo-confirmation-dialog','Confirm settings']]) {
            await visual.getByRole('button',{name:'main',exact:true}).click();
            await visual.getByLabel('Add component',{exact:true}).selectOption('button');
            await visual.getByRole('button',{name:'Preview addition',exact:true}).click();
            await visual.getByRole('button',{name:'button · New button',exact:true}).click();
            await visual.getByLabel('Overlay to open',{exact:true}).selectOption(id);
            if(id==='fdo-confirmation-dialog') {
                await visual.getByLabel('Confirmation result element',{exact:true}).selectOption({label:'pre · Results appear here'});
                await visual.getByLabel('Confirmed result text',{exact:true}).fill('Saved <safe>');
                await visual.getByRole('button',{name:'Preview confirmation flow',exact:true}).click();
            }
            await expect(visual.getByRole('button',{name:'Disconnect overlay opener',exact:true})).toBeEnabled();
            await visual.getByRole('button',{name:'Disconnect overlay opener',exact:true}).click();
            await expect(visual.getByLabel('Overlay to open',{exact:true})).toHaveValue('');
            await visual.getByRole('button',{name:'Undo',exact:true}).click();
            await expect(visual.getByLabel('Overlay to open',{exact:true})).toHaveValue(id);
            await visual.getByLabel('Text',{exact:true}).fill(label);
            await visual.getByRole('button',{name:'Preview change',exact:true}).click();
            // The static surface selects; it does not execute the authored opener.
            await preview.getByRole('button',{name:label,exact:true}).click();
            await expect(preview.locator('#'+id)).toBeHidden();
        }
        await visual.getByLabel('Overlay to open',{exact:true}).scrollIntoViewIfNeeded();
        expect(await visual.getByLabel('Confirmed result text',{exact:true}).evaluate(node=>{
            const field=node.getBoundingClientRect(),group=node.closest('.bp6-form-group').getBoundingClientRect();
            return field.left>=group.left && field.right<=group.right;
        })).toBe(true);
        const screenshot=test.info().outputPath('sdk-overlay-opener.png');
        await visual.screenshot({path:screenshot,animations:'disabled'});
        await test.info().attach('SDK overlay opener',{path:screenshot,contentType:'image/png'});
        await visual.getByRole('button',{name:'Apply to workspace',exact:true}).click();
        await expect(visual.getByRole('status')).toContainText('Applied. Restore point:');
        expect(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toBe(originalMain);
        const files=await editor.evaluate(()=>Object.fromEntries(window.__editorTestApi.getState().workspaceTreeIds.filter(id=>!id.startsWith('/node_modules/')&&!id.startsWith('/dist/')).map(id=>[id,window.__editorTestApi.getFileContent(id)]).filter(([,content])=>typeof content==='string')));
        const build=await home.evaluate(latestContent=>window.electron.plugin.build({latestContent}),files);
        expect(build.success,build.error).toBe(true);
        fs.writeFileSync(path.join(folder,'index.ts'),files['/index.ts']);
        const compiledContent=build.files.outputFiles.find(file=>!file.path.endsWith('.map')).text;
        await home.evaluate(()=>{window.__E2E__=false;});
        await deploySdkExample(home,{absPath:path.join(folder,'index.ts'),relativePath:'visual-openers'},{pluginName,compiledContent});
        await selectPluginOpen(home,pluginName);
        const frame=home.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
        await frame.getByRole('button',{name:'Open settings',exact:true}).click();
        await expect(frame.getByRole('dialog',{name:'New Dialog',exact:true})).toBeVisible();
        await frame.getByRole('button',{name:'Cancel',exact:true}).click();
        await expect(frame.locator('#fdo-dialog')).toBeHidden();
        await expect(frame.getByRole('button',{name:'Open settings',exact:true})).toBeFocused();
        await frame.getByRole('button',{name:'Open details',exact:true}).click();
        await expect(frame.getByRole('region',{name:'New Popover',exact:true})).toBeVisible();
        await expect(frame.getByRole('button',{name:'Open details',exact:true})).toHaveAttribute('aria-expanded','true');
        await frame.getByRole('region',{name:'New Popover',exact:true}).press('Escape');
        await expect(frame.locator('#fdo-popover')).toBeHidden();
        const confirmation=frame.getByRole('alertdialog',{name:'New Confirmation Dialog',exact:true});
        const result=frame.locator('[data-fdo-result="visual-result-1"]');
        await frame.getByRole('button',{name:'Confirm settings',exact:true}).click();
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
        await expect(confirmation).toBeHidden();
        await expect(result).toHaveText('Results appear here');
        await expect(frame.getByRole('button',{name:'Confirm settings',exact:true})).toBeFocused();
        await frame.getByRole('button',{name:'Confirm settings',exact:true}).click();
        await confirmation.press('Escape');
        await expect(confirmation).toBeHidden();
        await expect(result).toHaveText('Results appear here');
        await frame.getByRole('button',{name:'Confirm settings',exact:true}).click();
        await confirmation.getByRole('button',{name:'Confirm',exact:true}).click();
        await expect(confirmation).toBeHidden();
        await expect(result).toHaveText('Saved <safe>');
        await expect(result.locator('*')).toHaveCount(0);
        await frame.getByRole('button',{name:'Refresh status',exact:true}).click();
        await expect(frame.locator('[data-role="status"]')).toContainText('is running');
        await home.evaluate(id=>window.electron.plugin.render(id),pluginName);
        await expect(frame.locator('[data-role="status"]')).toContainText('Click the button');
        await frame.getByRole('button',{name:'Open settings',exact:true}).click();
        await expect(frame.getByRole('dialog',{name:'New Dialog',exact:true})).toBeVisible();
    } catch (error) {
        if (visual && !visual.isClosed()) {
            const screenshot=test.info().outputPath('opener-failure.png');
            await visual.screenshot({path:screenshot});
            await test.info().attach('Visual opener failure',{path:screenshot,contentType:'image/png'});
            throw new Error(`${error.message}\nInspector: ${await visual.getByRole('complementary',{name:'Element inspector'}).innerText()}`);
        }
        throw error;
    } finally {
        const home=await app.firstWindow().catch(()=>null);
        if(home) await removePlugin(home,pluginName).catch(()=>{});
        await closeElectronApp(app);fs.rmSync(folder,{recursive:true,force:true});
    }
});
