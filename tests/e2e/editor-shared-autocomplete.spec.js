const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');
let app, page;
const service={providerId:'website-provider',name:'website-availability',version:1,description:'Checks a website',available:true,methods:['check'],contract:{
    check:{input:{type:'object',properties:{url:{type:'string'}},required:['url']},output:{type:'object',properties:{available:{type:'boolean'},status:{type:'integer'}},required:['available','status']}}
}};
test.beforeAll(async()=>{
    app=await launchElectronApp(electron,{isolatedUserDataDir:true});
    page=await openEditorWithMockedIPC(app,{__useRealAssistants:true});
    await page.waitForFunction(()=>window.__editorTestApi?.getState().filesKeys.includes('/index.ts'));
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await app.evaluate(({ipcMain}, services)=>{
        ipcMain.removeHandler('plugin:plugin-shared-logic-catalog');
        globalThis.__sharedAutocompleteReads=0;
        ipcMain.handle('plugin:plugin-shared-logic-catalog',()=>{globalThis.__sharedAutocompleteReads++;return {success:true,services};});
    },[service]);
    await expect.poll(()=>app.evaluate(()=>globalThis.__sharedAutocompleteReads),{timeout:15000}).toBeGreaterThan(0);
},120000);
test.afterAll(async()=>closeElectronApp(app),60000);
test.afterEach(async ({},info)=>{
    if(info.status===info.expectedStatus)return;
    await page.screenshot({animations:'disabled',path:info.outputPath('autocomplete-failure.png')});
    console.log(await page.evaluate(async()=>({catalog:await window.electron.plugin.listSharedLogic(),location:window.__editorTestApi.getEditorLocation(),content:window.__editorTestApi.getFileContent('/index.ts'),suggestions:[...document.querySelectorAll('.suggest-widget .label-name')].map(item=>item.textContent)})));
});

async function source(text) {
    await page.evaluate(text=>{
        window.__editorTestApi.createFile('/index.ts',text);
        window.__editorTestApi.openTabs([{id:'/index.ts',active:true}]);
    },text);
}
async function cursor(line,column) {
    await page.evaluate(({line,column})=>window.__editorTestApi.setEditorPosition(line,column),{line,column});
}
const prefix="import {FDO_SDK} from '@anikitenko/fdo-sdk';\ndeclare const sdk: FDO_SDK;\n";
const target=JSON.stringify({providerId:service.providerId,name:service.name,version:service.version});

test('available shared methods insert real calls and expose typed method, input and result completions',async()=>{
    await source(prefix+'async function example() {\n  return sdk.shared\n}');
    await cursor(4,'  return sdk.shared'.length+1);
    await page.keyboard.type('.');
    await page.keyboard.press('Control+Space');
    const handler=page.locator('.suggest-widget .monaco-list-row').filter({hasText:'check — website-availability v1'});
    await expect(handler).toBeVisible({timeout:15000});
    await handler.click();
    await expect.poll(()=>page.evaluate(()=>window.__editorTestApi.getFileContent('/index.ts'))).toContain('.call("check", {"url": ""})');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await source(prefix+`const checks = sdk.shared.client(${target});\nchecks.call('');`);
    await cursor(4,"checks.call('".length+1);
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget .label-name').getByText('check',{exact:true})).toBeVisible({timeout:15000});
    await page.keyboard.press('Escape');

    await source(prefix+`const checks = sdk.shared.client(${target});\nchecks.call('check', {});`);
    await cursor(4,"checks.call('check', {".length+1);
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget .label-name').getByText('url',{exact:true})).toBeVisible({timeout:15000});
    await page.keyboard.press('Escape');

    await source(prefix+`const checks = sdk.shared.client(${target});\nasync function example() {\n  const result = await checks.call('check', {url:'https://example.com'});\n  return result\n}`);
    await cursor(6,'  return result'.length+1);
    await page.keyboard.type('.');
    await expect(page.locator('.suggest-widget .label-name').getByText('status',{exact:true})).toBeVisible({timeout:15000});
    await expect(page.locator('.suggest-widget .label-name').getByText('available',{exact:true})).toBeVisible();
    await page.screenshot({animations:'disabled',path:test.info().outputPath('shared-result-autocomplete.png')});
});
