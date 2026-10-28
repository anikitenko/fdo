const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Live UI names a GitOps workspace from metadata and previews guarded SDK helper composition', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir:true});
    try {
        const home = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await home.evaluate(() => window.electron.system.openEditorWindow({name:'gitops_collection_azure-finops',template:'utility'}));
        const editor = await opening;
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        await editor.evaluate(() => {
            window.__editorTestApi.createFile('/index.ts', `import {render} from './render';
export default class Plugin {
 get metadata(){return {name:'Azure FinOps & Resource Manager',version:'1.0.0',author:'Team',description:'FinOps',icon:'cloud'};}
 render(){return render();}
}`);
            window.__editorTestApi.createFile('/render.ts', `import {DOM,DOMText,DOMInput,DOMSemantic} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
const tabs = [['overview','Overview'],['resources','Resources']];
export function render(){
 const text = new DOMText(), sem = new DOMSemantic(), input = new DOMInput('tenant');
 const dom = new DOM().collectStylesFrom(text,sem,input);
 if (!styles.shell) return dom.renderHTML(text.createText('Styles unavailable'));
 const button = (id,label,extra='') => '<button type="button" id="'+id+'" class="pure-button '+(extra.includes('af-primary')?'af-primary':'')+'" '+extra.replace(/class="[^"]*"/g,'')+'>'+label+'</button>';
 const nav = sem.createNav(tabs.map(([id,label])=>button(id,label,['overview'].includes(id)?'class="af-primary" aria-pressed="true"':'')));
 return dom.renderHTML(sem.createMain([text.createHText(1,'Azure FinOps'),nav,input.createSelect([new DOMInput().createOption('Tenant One','one')])],{classes:[dom.createClassFromStyle(styles.shell)]}));
}`);
            window.__editorTestApi.createFile('/styles.css','shell { color: #eee; padding: 12px; }','css');
        });
        const previewOpening = app.waitForEvent('window');
        await editor.getByRole('button',{name:'Live UI editor',exact:true}).click();
        const visual = await previewOpening;
        await expect(visual.getByRole('heading',{name:'Live UI · Azure FinOps & Resource Manager',exact:true})).toBeVisible();
        const frame = visual.frameLocator('iframe[title="Plugin UI preview"]');
        await expect(frame.getByRole('heading',{name:'Azure FinOps',exact:true})).toBeVisible();
        await expect(frame.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
        await expect(frame.getByRole('button',{name:'Overview',exact:true})).toHaveClass('pure-button af-primary');
        await expect(frame.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-pressed','true');
        await expect(frame.getByRole('combobox')).toContainText('Tenant One');
        await expect(visual.getByText('This render path needs a preview adapter',{exact:true})).toHaveCount(0);
        expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('#/live-ui'))?.getTitle()))
            .toBe('Live UI · Azure FinOps & Resource Manager');
        await visual.screenshot({path:test.info().outputPath('guarded-finops-preview.png'),animations:'disabled'});
    } finally {await closeElectronApp(app);}
});
