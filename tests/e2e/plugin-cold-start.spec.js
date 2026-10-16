const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, activatePlugin, removePlugin} = require('./helpers/sdkExamples');

for (const mode of ['slow-runtime', 'slow-host-document']) {
    test(`initial plugin frame tolerates ${mode} without a refresh`, async () => {
        test.setTimeout(60000);
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
        const pluginName = `cold-start-${mode}`;
        let home;
        try {
            home = await app.firstWindow();
            await deploySdkExample(home, {relativePath: pluginName}, {pluginName, compiledContent: `
                const {FDO_SDK} = require('@anikitenko/fdo-sdk');
                class ColdPlugin extends FDO_SDK {
                    get metadata() {return {name: 'Cold Start', version: '1.0.0', author: 'E2E', description: 'Startup race fixture', icon: 'cube'};}
                    init() {}
                    render() {return '<main>Cold plugin loaded successfully</main>';}
                }
                new ColdPlugin();
            `});
            await home.evaluate(id => window.electron.plugin.deactivate(id), pluginName);
            await expect(home.locator(`iframe[data-plugin-id="${pluginName}"]`)).toHaveCount(0);
            await home.evaluate(({id, mode}) => {
                const originalFetch = window.fetch;
                window.__coldStart = {fetches: 0, helloAt: null, releaseAt: null, stages: [], iframe: null};
                const state = window.__coldStart;
                window.fetch = async function(input, options) {
                    if (input === 'static://host/plugin_host.html') {
                        state.fetches++;
                        if (mode === 'slow-host-document') await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    return originalFetch.call(window, input, options);
                };
                window.addEventListener('message', event => {
                    const iframe = document.querySelector(`iframe[data-plugin-id="${id}"]`);
                    if (!iframe || event.source !== iframe.contentWindow) return;
                    if (event.data?.type === 'PLUGIN_STAGE') state.stages.push(event.data.stage);
                    if (event.data?.type === 'PLUGIN_HELLO' && state.helloAt === null) {
                        state.iframe = iframe;
                        state.helloAt = performance.now();
                        state.releaseAt = state.helloAt + 6500;
                    }
                });
                window.__FDO_PLUGIN_METRICS__ = [];
            }, {id: pluginName, mode});
            if (mode === 'slow-runtime') {
                const deployed = await home.evaluate(id => window.electron.plugin.deployToMainFromEditor({
                    name: id, sandbox: `sdk_examples_${id}`, entrypoint: 'dist/index.cjs', rootCert: 'root', capabilities: [],
                    metadata: {name: 'Cold Start', version: '1.0.0', author: 'E2E', description: 'Delayed SDK bootstrap', icon: 'cube'},
                    content: `const {FDO_SDK} = require('@anikitenko/fdo-sdk');
                        class ColdPlugin extends FDO_SDK {
                            get metadata() {return {name:'Cold Start',version:'1.0.0',author:'E2E',description:'Delayed SDK bootstrap',icon:'cube'};}
                            init() {}
                            render() {return '<main>Cold plugin loaded successfully</main>';}
                        }
                        setTimeout(() => new ColdPlugin(), 6500);`,
                }), pluginName);
                expect(deployed.success, deployed.error).toBe(true);
            }
            expect((await activatePlugin(home, pluginName)).success).toBe(true);
            await selectPluginOpen(home, pluginName);
            const iframe = home.locator(`iframe[data-plugin-id="${pluginName}"]`);
            const frame = home.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
            await home.waitForFunction(() => window.__coldStart.helloAt !== null);
            if (mode === 'slow-runtime') {
                await home.waitForFunction(() => performance.now() - window.__coldStart.helloAt > 5500);
                await expect(frame.getByText('Plugin failed to load', {exact: true})).toHaveCount(0);
                await expect(home.getByText('Plugin UI failed to load', {exact: true})).toHaveCount(0);
                await expect(frame.locator('.plugin-page-loader')).toBeVisible();
            }
            await expect(frame.locator('main')).toHaveText('Cold plugin loaded successfully', {timeout: 15000});
            expect(await iframe.evaluate(node => node === window.__coldStart.iframe)).toBe(true);
            const recoveries = await home.evaluate(id => (window.__FDO_PLUGIN_METRICS__ || []).filter(event =>
                event.plugin === id && /recovery_attempt|terminal_failure/.test(event.metric)), pluginName);
            expect(recoveries.length).toBe(0);
            expect(await home.evaluate(() => window.__coldStart.fetches)).toBe(1);
            expect(await home.evaluate(() => window.__coldStart.stages)).not.toContain('iframe-load-timeout');
        } finally {
            if (home && !home.isClosed()) await removePlugin(home, pluginName).catch(() => {});
            await closeElectronApp(app);
        }
    });
}
