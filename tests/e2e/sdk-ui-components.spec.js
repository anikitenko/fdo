const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

const motionBundle=require('esbuild').buildSync({entryPoints:['src/utils/plugins/authoring/liveUi/sdkComponentMotion.js'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const motionModule={exports:{}};
new Function('module','exports',motionBundle)(motionModule,motionModule.exports);
const {sdkMotionStyle}=motionModule.exports;

const source = `import {FDO_SDK, defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
import {DOM, createDialog, createConfirmationDialog, createPopover, createProgressBar, createToast, createInlineAlert, createToastRegion, createAsyncActionButton, createTabs, createDisclosure, createAccordion} from '@anikitenko/fdo-sdk/ui';
class ComponentPlugin extends FDO_SDK {
    private revision = "";
    get metadata(){return {name:'sdk-ui-components',version:'1.0.0',author:'FDO',description:'SDK UI integration',icon:'application'};}
    init(){}
    render(){
        this.revision += "x";
        const dom = new DOM().collectStylesFrom();
        const buttons = dom.createElement('button',{id:'open-dialog',type:'button'},'Open dialog') + dom.createElement('button',{id:'open-confirm',type:'button'},'Open confirmation') + dom.createElement('button',{id:'open-popover',type:'button'},'Open popover') + dom.createElement('input',{id:'autofocus-probe',autofocus:true,'aria-label':'Autofocus probe'});
        const additions=createProgressBar(dom,{id:'progress',label:'Upload progress',value:20}) + createToast(dom,{id:'toast-feedback',message:'Saved',progress:{label:'Saved progress',value:20}}) + createInlineAlert(dom,{id:'inline-feedback',message:'Ready'}) + createToastRegion(dom,{id:'notifications',label:'Notifications',body:createToast(dom,{id:'queued-notice',message:'Queued notification'})}) + createAsyncActionButton(dom,{id:'async-work',label:'Do work',pendingLabel:'Working',successLabel:'Done'}) + createTabs(dom,{id:'settings-tabs',label:'Settings panels',items:[{key:'one',label:'General',body:dom.createElement('p',{},'General panel')},{key:'two',label:'Advanced',body:dom.createElement('p',{},'Advanced panel')}]}) + createDisclosure(dom,{id:'native-details',title:'More details',body:dom.createElement('p',{},'Disclosure content')}) + createAccordion(dom,{id:'sections',label:'More sections',items:[{key:'first',title:'First section',body:'First'},{key:'second',title:'Second section',body:'Second'}]});
        return dom.renderHTML(dom.createElement('main',{},additions + dom.createElement('output',{id:'revision'},this.revision) + buttons + createDialog(dom,{id:'dialog',title:'SDK settings',options:{style:{'&':${JSON.stringify(sdkMotionStyle('fdo.dialog','scale',800,'ease-out'))}}},body:dom.createElement('input',{'aria-label':'Setting',autofocus:true})}) + createConfirmationDialog(dom,{id:'confirmation',title:'Confirm operation',options:{style:{'&':${JSON.stringify(sdkMotionStyle('fdo.confirmation-dialog','fade',800,'ease-out'))}}}}) + createPopover(dom,{id:'popover',title:'SDK details',body:'Popover body',options:{style:{'&':${JSON.stringify(sdkMotionStyle('fdo.popover','slide',800,'ease-out'))}}}})));
    }
    renderOnLoad(){return defineRenderOnLoadActions({lifecycleKey:'sdk-ui-test',language:'typescript',handlers:{dialog:({element})=>{window.__sdkUiTest.clicked=true;window.__sdkUiTest.controllers[0].open(element);}},bindings:[{selector:'#open-dialog',event:'click',handler:'dialog'}],setup:async()=>{
        const ui = await window.loadFdoUi();
        const state = window.__sdkUiTest || (window.__sdkUiTest = {setups:0, cleanups:[], calls:0});
        state.setups++;
        try {
        const dialog = document.querySelector('#dialog');
        const confirmation = document.querySelector('#confirmation');
        const popover = document.querySelector('#popover');
        const anchor = document.querySelector('#open-popover');
        const controllers = [ui.mountDialog(dialog),ui.mountConfirmationDialog(confirmation,{onConfirm:({signal})=>{state.calls++;state.signal=signal;return new Promise(resolve=>{state.resolve=resolve;});}}),ui.mountPopover(popover,{anchor})];
        state.controllers=controllers;
        const extra=[ui.mountProgressBar(document.querySelector('#progress')),ui.mountToast(document.querySelector('#toast-feedback')),ui.mountInlineAlert(document.querySelector('#inline-feedback')),ui.mountToastRegion(document.querySelector('#notifications'),{maxVisible:1,maxQueued:1}),ui.mountAsyncActionButton(document.querySelector('#async-work'),{onAction:({signal})=>{state.actionCalls=(state.actionCalls || 0)+1;state.actionSignal=signal;return new Promise(resolve=>{state.actionResolve=resolve;});}}),ui.mountTabs(document.querySelector('#settings-tabs')),ui.mountDisclosure(document.querySelector('#native-details')),ui.mountAccordion(document.querySelector('#sections'))];
        state.extra=extra;extra[1].show();extra[3].enqueue(document.querySelector('#queued-notice'));
        // Omit explicit extra.destroy(): FDO's view owner must release these too.

        const listeners = ['open-confirm','open-popover'].map((id,index)=>{const button=document.getElementById(id);const click=()=>controllers[index+1].open(button);button.addEventListener('click',click);return ()=>button.removeEventListener('click',click);});
        return ()=>{state.cleanups.push({connected:dialog.isConnected});listeners.forEach(dispose=>dispose());controllers.forEach(controller=>controller.destroy());};
        } catch(error) {state.error=String(error);throw error;}
    }});}
}
new ComponentPlugin();`;

test('bundled frontend UI mounts under plugin CSP, restores focus and disposes pending controllers before rerender', async () => {
    test.setTimeout(120000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sdk-ui-'));
    const pluginName = 'sdk-ui-components';
    try {
        const page = await app.firstWindow();
        const autofocusWarnings = [];
        page.on('console',message=>{if (/Blocked autofocusing/i.test(message.text())) autofocusWarnings.push(message.text());});
        const errors = [];
        page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
        const build = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), {'/index.ts': source, '/package.json': JSON.stringify({name:'sdk-ui-components',version:'1.0.0',author:'FDO',description:'SDK components',main:'index.ts'})});
        expect(build.success, build.error).toBe(true);
        fs.writeFileSync(path.join(root, 'index.ts'), source);
        const compiledContent = build.files.outputFiles.find(file => !file.path.endsWith('.map')).text;
        // Set before activation creates the iframe: changing sandbox flags on
        // an already-loaded document does not change that document's origin.
        await page.evaluate(()=>{window.__E2E__ = false;});
        await deploySdkExample(page, {absPath:path.join(root,'index.ts'),relativePath:'sdk-ui-components'}, {pluginName,compiledContent});
        await selectPluginOpen(page, pluginName);
        await expect(page.locator(`iframe[data-plugin-id="${pluginName}"]`)).toHaveAttribute('sandbox','allow-scripts');
        const frame = page.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
        try {await expect.poll(()=>frame.locator('main').evaluate(()=>window.__sdkUiTest?.setups)).toBeGreaterThanOrEqual(1);}
        catch(error) {throw new Error(error.message + '\nConsole: ' + errors.join(' | '));}
        await expect(frame.locator('[autofocus]')).toHaveCount(0);
        await frame.getByRole('textbox',{name:'Autofocus probe',exact:true}).evaluate(node=>node.focus());
        await expect(frame.getByRole('textbox',{name:'Autofocus probe',exact:true})).toBeFocused();
        expect(autofocusWarnings).toEqual([]);
        const initialSetups = await frame.locator('main').evaluate(()=>window.__sdkUiTest.setups);
        const initialCleanups = await frame.locator('main').evaluate(()=>window.__sdkUiTest.cleanups.length);
        const diagnostics = await frame.locator('main').evaluate(()=>({error:window.__sdkUiTest.error,controllers:window.__sdkUiTest.controllers?.length,states:window.__sdkUiTest.controllers?.map(c=>c.getState())}));
        expect(diagnostics, JSON.stringify(diagnostics)).toMatchObject({controllers:3});
        const dialog = frame.getByRole('dialog', {name:'SDK settings'});
        await frame.getByRole('button',{name:'Open dialog',exact:true}).click();
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(node=>node.getAnimations().some(animation=>animation.transitionProperty==='opacity'))).toBe(true);
        expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
        await dialog.press('Escape'); await expect(dialog).toBeHidden();
        await expect(frame.getByRole('button',{name:'Open dialog',exact:true})).toBeFocused();
        await frame.getByRole('button',{name:'Open popover',exact:true}).click();
        await expect(frame.getByRole('region',{name:'SDK details'})).toBeVisible();
        expect(await frame.getByRole('region',{name:'SDK details'}).evaluate(node=>node.getAnimations().some(animation=>animation.transitionProperty==='opacity'))).toBe(true);
        await frame.getByRole('region',{name:'SDK details'}).press('Escape');
        await expect(frame.getByRole('region',{name:'SDK details'})).toBeHidden();
        await expect(frame.locator('#toast-feedback')).toBeVisible();
        await expect(frame.locator('#queued-notice')).toBeVisible();
        await frame.locator('main').evaluate(()=>window.__sdkUiTest.extra[1].setProgress(4,10));
        await expect(frame.getByRole('progressbar',{name:'Saved progress',exact:true})).toHaveAttribute('value','4');
        await expect(frame.getByRole('progressbar',{name:'Saved progress',exact:true})).toHaveAttribute('max','10');
        expect(await frame.locator('main').evaluate(()=>window.__sdkUiTest.extra.length)).toBe(8);
        await frame.getByRole('tab',{name:'General',exact:true}).focus();
        await frame.getByRole('tab',{name:'General',exact:true}).press('ArrowRight');
        await expect(frame.getByRole('tab',{name:'Advanced',exact:true})).toHaveAttribute('aria-selected','true');
        await expect(frame.getByText('Advanced panel',{exact:true})).toBeVisible();
        await frame.getByText('More details',{exact:true}).click();
        await expect(frame.getByText('Disclosure content',{exact:true})).toBeVisible();
        await frame.getByRole('button',{name:'Do work',exact:true}).click();
        expect(await frame.locator('main').evaluate(()=>{const state=window.__sdkUiTest;state.extra[4].run();return state.actionCalls;})).toBe(1);
        await expect(frame.locator('#async-work')).toHaveAttribute('aria-busy','true');
        await frame.getByRole('button',{name:'Open confirmation',exact:true}).click();
        await frame.getByRole('button',{name:'Confirm',exact:true}).click();
        await expect.poll(()=>frame.locator('main').evaluate(()=>window.__sdkUiTest.calls)).toBe(1);
        await expect(frame.getByRole('alertdialog')).toHaveAttribute('aria-busy','true');
        const ownership = await frame.locator('main').evaluate(async()=>{
            const ui=await window.loadFdoUi();
            try {ui.mountDialog(document.body);return false;} catch(error){return error.message.includes('current plugin view');}
        });
        expect(ownership).toBe(true);
        expect(await frame.locator('main').evaluate(()=>{try {return !!window.parent.document.body;} catch(error) {return error.name;}})).toBe('SecurityError');
        await frame.locator('main').evaluate(async()=>{window.__sdkUiTest.previous=window.__sdkUiTest.controllers;window.__sdkUiTest.previousExtra=window.__sdkUiTest.extra;window.__sdkUiTest.previousActionSignal=window.__sdkUiTest.actionSignal;window.__sdkUiTest.previousUi=await window.loadFdoUi();});
        // Changed markup passes through real render IPC without replacing the iframe.
        await page.evaluate(id=>window.electron.plugin.render(id),pluginName);
        await expect.poll(()=>frame.locator('main').evaluate(()=>window.__sdkUiTest.setups)).toBe(initialSetups + 1);
        const state = await frame.locator('main').evaluate(()=>({cleanups:window.__sdkUiTest.cleanups,aborted:window.__sdkUiTest.signal.aborted,registry:window[Symbol.for('fdo.renderOnLoad.cleanup')].size}));
        expect(state.cleanups).toHaveLength(initialCleanups + 1);
        expect(state.cleanups.every(cleanup=>cleanup.connected)).toBe(true);
        expect(await frame.locator('main').evaluate(()=>window.__sdkUiTest.previousExtra.every(controller=>controller.getState().destroyed) && window.__sdkUiTest.previousExtra[1].getState().progress.destroyed && window.__sdkUiTest.previousActionSignal.aborted)).toBe(true);
        expect(state.aborted).toBe(true); expect(state.registry).toBe(1);
        expect(await frame.locator('main').evaluate(()=>window.__sdkUiTest.previous.every(controller=>controller.getState().destroyed))).toBe(true);
        expect(await frame.locator('main').evaluate(()=>{try {window.__sdkUiTest.previousUi.mountDialog(document.querySelector('#dialog'));return false;} catch(error){return error.message.includes('disposed');}})).toBe(true);
        await frame.locator('main').evaluate(()=>window.__sdkUiTest.resolve());
        await frame.getByRole('button',{name:'Open dialog',exact:true}).click();
        await expect(frame.getByRole('dialog',{name:'SDK settings'})).toBeVisible();
        await frame.getByRole('dialog',{name:'SDK settings'}).press('Escape');
        await page.emulateMedia({reducedMotion:'reduce'});
        await frame.getByRole('button',{name:'Open dialog',exact:true}).click();
        await expect(frame.getByRole('dialog',{name:'SDK settings'})).toHaveCSS('transition-duration','0s');
        expect(await frame.getByRole('dialog',{name:'SDK settings'}).evaluate(node=>node.getAnimations().length)).toBe(0);
        expect(errors.filter(error=>/Content Security Policy|onLoad.*failed|frontend cleanup failed/i.test(error))).toEqual([]);
    } finally {
        const page = await app.firstWindow().catch(()=>null);
        if(page) await removePlugin(page,pluginName).catch(()=>{});
        await closeElectronApp(app); fs.rmSync(root,{recursive:true,force:true});
    }
});
