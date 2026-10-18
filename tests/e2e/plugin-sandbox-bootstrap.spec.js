const {test, expect, _electron:electron} = require('@playwright/test');
const {launchElectronApp,closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample,selectPluginOpen} = require('./helpers/sdkExamples');

for (const stale of [false,true]) {
test(`newly activated plugins bootstrap in the production opaque iframe sandbox${stale ? ' after refreshing stale host assets' : ''}`, async () => {
    test.setTimeout(60000); let app;
    try {
        app = await launchElectronApp(electron,{isolatedUserDataDir:true}); const page = await app.firstWindow();
        if (stale) await page.evaluate(() => {
            const fetcher = window.fetch.bind(window); window.__useFreshPluginHost = false;
            window.fetch = async (url, options) => {
                if (url === 'static://host/plugin_host.html' && !window.__useFreshPluginHost) return new Response('<html lang="en"><body><div id="plugin-root"></div><script src="static://host/stale-plugin-host.js"></script></body></html>',{status:200});
                return fetcher(url, options);
            };
        });
        await page.waitForFunction(() => !!window.electron?.plugin?.activate);
        const id = 'gitops_00000000-0000-4000-8000-000000000001_sandbox-fixture';
        await deploySdkExample(page,{slug:'sandbox-fixture',relativePath:'sandbox-fixture'}, {pluginName:id,compiledContent:`
const {FDO_SDK,PluginRegistry} = require('@anikitenko/fdo-sdk');
class Fixture extends FDO_SDK {get metadata(){return {name:'Sandbox Fixture',version:'1.0.0',author:'FDO',description:'Sandbox regression',icon:'application'};} init(){} render(){return '<main><h1>Sandbox fixture ready</h1></main>';}}
PluginRegistry.registerPlugin(new Fixture());`});
        // Existing E2E frames use allow-same-origin for DOM inspection. Exercise
        // the shipped opaque sandbox instead; Playwright can inspect it directly.
        await page.evaluate(() => {window.__E2E__ = false;});
        await selectPluginOpen(page,id);
        if (stale) {
            await expect(page.getByRole('button',{name:'Reload plugin frame',exact:true})).toBeVisible({timeout:20000});
            await page.evaluate(() => {window.__useFreshPluginHost = true;});
            await page.getByRole('button',{name:'Reload plugin frame',exact:true}).click();
        }
        const frame = page.frameLocator(`iframe[data-plugin-id="${id}"]`);
        await expect(frame.getByRole('heading',{name:'Sandbox fixture ready'})).toBeVisible({timeout:20000});
        expect(await page.locator(`iframe[data-plugin-id="${id}"]`).getAttribute('sandbox')).toBe('allow-scripts');
    } finally {if(app) await closeElectronApp(app);}
});

}
