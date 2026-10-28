const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {launchElectronApp,closeElectronApp}=require('./helpers/electronApp');

test('interpolated HTML can be selected in the frame, edited, undone and applied without rewriting bindings',async()=>{
    test.setTimeout(120000);
    const app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    try {
        const home=await app.firstWindow(),opening=app.waitForEvent('window');
        await home.evaluate(()=>window.electron.system.openEditorWindow({name:'Interpolation editor',template:'utility'}));
        const editor=await opening;
        await editor.waitForFunction(()=>window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        const renderSource=fs.readFileSync(path.join(__dirname,'../fixtures/live-ui-html-interpolation/render-editor.ts.txt'),'utf8');
        const before=await editor.evaluate(renderSource=>{
            window.__editorTestApi.deleteFile('/render.tsx');
            window.__editorTestApi.deleteFile('/starter.test.ts');
            window.__editorTestApi.createFile('/index.ts',`import {FDO_SDK} from '@anikitenko/fdo-sdk';import {render} from './render';
export default class Plugin extends FDO_SDK {
 get metadata(){return {name:'Interpolation editor',version:'1.0.0',author:'Tests',description:'Literal HTML editing',icon:'cog'};}
 init():void{} render():string{return render();}
} new Plugin();`);
            window.__editorTestApi.createFile('/render.ts',renderSource);
            window.__editorTestApi.createFile('/styles.css','shell { color: #ddd; padding: 8px; }','css');
            return {render:window.__editorTestApi.getFileContent('/render.ts'),css:window.__editorTestApi.getFileContent('/styles.css'),pkg:window.__editorTestApi.getFileContent('/package.json')};
        },renderSource);
        const previewOpening=app.waitForEvent('window');
        await editor.getByRole('button',{name:'Live UI editor',exact:true}).click();
        const visual=await previewOpening,frame=visual.frameLocator('iframe[title="Plugin UI preview"]');
        await frame.getByRole('heading',{name:'Costs',exact:true}).click();
        await expect(visual.getByLabel('Text',{exact:true})).toHaveValue('Costs');
        await visual.getByLabel('Text',{exact:true}).fill('Azure costs');
        await visual.getByRole('button',{name:'Preview change',exact:true}).click();
        await expect(frame.getByRole('heading',{name:'Azure costs',exact:true})).toBeVisible();
        await frame.getByRole('button',{name:'Refresh',exact:true}).click();
        await visual.getByLabel('Text',{exact:true}).fill('Reload Azure');
        await visual.getByRole('button',{name:'Preview change',exact:true}).click();
        await expect(frame.locator('#refresh')).toHaveText('Reload Azure');
        await expect(frame.locator('#save')).toHaveText('Save');
        expect(await editor.evaluate(()=>window.__editorTestApi.getFileContent('/render.ts'))).toBe(before.render);
        await visual.getByRole('button',{name:'Undo',exact:true}).click();
        await expect(frame.locator('#refresh')).toHaveText('Refresh');
        await visual.getByRole('button',{name:'Redo',exact:true}).click();
        await expect(frame.locator('#refresh')).toHaveText('Reload Azure');
        await frame.getByRole('button',{name:'Overview',exact:true}).click();
        await visual.getByLabel('Text',{exact:true}).fill('Overview costs');
        await visual.getByRole('button',{name:'Preview change',exact:true}).click();
        await expect(frame.locator('[data-page="overview"]')).toHaveText('Overview costs');
        await expect(frame.locator('[data-page="overview"] i')).toHaveCount(1);
        await expect(frame.locator('[data-page="overview"] span[hidden]')).toHaveCount(1);
        await visual.getByRole('button',{name:'Apply to workspace',exact:true}).click();
        await expect(visual.getByRole('status')).toContainText('Applied. Restore point:');
        await visual.getByRole('button',{name:'main',exact:true}).click();
        const picker=visual.getByRole('combobox',{name:'CSS property',exact:true});
        await picker.fill('padding');await picker.press('Enter');
        await visual.getByLabel('Inline CSS value',{exact:true}).fill('12px');
        await visual.getByRole('button',{name:'Preview style override',exact:true}).click();
        await expect(frame.locator('#app')).toHaveCSS('padding','12px');
        await visual.getByRole('button',{name:'Apply to workspace',exact:true}).click();
        await expect(visual.getByRole('status')).toContainText('Applied. Restore point:');
        const after=await editor.evaluate(()=>({render:window.__editorTestApi.getFileContent('/render.ts'),css:window.__editorTestApi.getFileContent('/styles.css'),pkg:window.__editorTestApi.getFileContent('/package.json')}));
        expect(after.render).toContain('<h1>Azure costs</h1>');
        expect(after.render).toContain("button('refresh','Reload Azure')");
        expect(after.render).toContain('class="${cls}" style="padding: 12px"');
        expect(after.css).toBe(before.css);expect(after.pkg).toBe(before.pkg);
        await visual.screenshot({path:test.info().outputPath('interpolated-html-editing.png'),animations:'disabled'});
    } finally {await closeElectronApp(app);}
});
