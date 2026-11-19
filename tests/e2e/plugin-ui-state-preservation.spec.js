const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('background rendering and duplicate greetings preserve temporary UI state until an explicit replacement', async () => {
    test.setTimeout(120000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'e2e-ui-state-preservation';
    let home;
    try {
        home = await app.firstWindow();
        await home.evaluate(() => {
            window.__pluginDocumentIds = {};
            window.addEventListener('message', event => {
                if (event.data?.type !== 'PLUGIN_HELLO') return;
                const iframe = [...document.querySelectorAll('iframe[data-plugin-id]')].find(frame => frame.contentWindow === event.source);
                if (iframe) window.__pluginDocumentIds[iframe.dataset.pluginId] = event.data.documentId;
            });
        });
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class StatePlugin extends FDO_SDK {
                constructor(){super();this.revision=0;}
                get metadata(){return {name:'Temporary UI state',version:'1.0.0',author:'E2E',description:'UI lifecycle regression',icon:'cube'};}
                init(){}
                render(){return '<main><label>Temporary setting<input aria-label="Temporary setting" value="default"/></label><output>'+(++this.revision)+'</output></main>';}
                renderOnLoad(){return '() => {window.__uiMounts=(window.__uiMounts||0)+1;document.querySelector("output").dataset.ready="true";}';}
            }
            new StatePlugin();
        `});
        await selectPluginOpen(home, id);
        const frame = home.frameLocator(`iframe[data-plugin-id="${id}"]`);
        const output = frame.locator('output');
        await expect(output).toHaveAttribute('data-ready', 'true');
        const input = frame.getByRole('textbox', {name: 'Temporary setting'});
        await input.fill('intentionally temporary');
        const initial = await output.evaluate(() => window.__uiMounts);
        const documentId = await home.evaluate(id => window.__pluginDocumentIds[id], id);
        expect(documentId).toBeTruthy();
        await output.evaluate((_node, documentId) => {
            window.parent.postMessage({type: 'PLUGIN_HELLO', documentId}, '*');
        }, documentId);
        // A background render must be offered without reimporting the view.
        await home.evaluate(id => window.electron.plugin.render(id), id);
        await expect(home.getByRole('button', {name: 'Open updated view'})).toBeVisible();
        await expect(input).toHaveValue('intentionally temporary');
        expect(await output.evaluate(() => window.__uiMounts)).toBe(initial);
        await home.getByRole('button', {name: 'Keep current view'}).click();
        await expect(input).toHaveValue('intentionally temporary');
        await home.evaluate(id => window.electron.plugin.render(id), id);
        await home.getByRole('button', {name: 'Open updated view'}).click();
        await expect(input).toHaveValue('default');
        await expect.poll(() => output.evaluate(() => window.__uiMounts)).toBe(initial + 1);
        const logs = await home.evaluate(id => window.electron.plugin.getLogTail(id), id);
        expect(logs.combined).toContain('ui.render-deferred');
        expect(logs.combined).toContain('user_opened_update');
        // Explicit host navigation remains one action with no extra prompt.
        await input.fill('temporary again');
        await home.evaluate(id => window.electron.plugin.render(id, {replace: true}), id);
        await expect(input).toHaveValue('default');
        await expect(home.getByRole('button', {name: 'Open updated view'})).toHaveCount(0);
    } finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
    }
});
