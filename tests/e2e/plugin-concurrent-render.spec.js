const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('two plugin frames retain their own render subscriptions through refreshes and sibling removal', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const names = ['concurrent-render-first', 'concurrent-render-second'];
    let home;
    try {
        home = await app.firstWindow();
        await home.evaluate(() => {
            const fetch = window.fetch;
            window.__pluginHostFetches = 0;
            window.fetch = (...args) => {
                if (args[0] === 'static://host/plugin_host.html') window.__pluginHostFetches++;
                return fetch(...args);
            };
        });
        for (const pluginName of names) {
            await deploySdkExample(home, {relativePath: pluginName}, {pluginName, compiledContent: `
                const {FDO_SDK} = require('@anikitenko/fdo-sdk');
                class ConcurrentPlugin extends FDO_SDK {
                    constructor() {super();this.revision = 0;}
                    get metadata() {return {name: '${pluginName}', version:'1.0.0', author:'E2E', description:'Concurrent rendering', icon:'cube'};}
                    init() {}
                    render() {return '<main><output>' + (++this.revision) + '</output></main>';}
                }
                new ConcurrentPlugin();
            `});
            await selectPluginOpen(home, pluginName);
            await expect(home.frameLocator(`iframe[data-plugin-id="${pluginName}"]`).locator('output')).toHaveText(/^\d+$/);
        }
        const first = home.frameLocator(`iframe[data-plugin-id="${names[0]}"]`).locator('output');
        const second = home.frameLocator(`iframe[data-plugin-id="${names[1]}"]`).locator('output');
        const before = [Number(await first.textContent()), Number(await second.textContent())];
        // Unknown callbacks can have a different contextBridge proxy identity;
        // removing one must never clear all consumers of a shared IPC channel.
        await home.evaluate(async ids => {
            window.electron.plugin.off.render(() => {});
            await Promise.all(ids.map(id => window.electron.plugin.render(id)));
        }, names);
        await expect.poll(async () => Number(await first.textContent())).toBeGreaterThan(before[0]);
        await expect.poll(async () => Number(await second.textContent())).toBeGreaterThan(before[1]);
        const previous = Number(await first.textContent());
        await removePlugin(home, names[1]);
        await home.evaluate(id => window.electron.plugin.render(id), names[0]);
        await expect.poll(async () => Number(await first.textContent())).toBeGreaterThan(previous);
        expect(await home.evaluate(() => window.__pluginHostFetches)).toBe(1);
        await expect(home.getByText('Plugin UI failed to load', {exact: true})).toHaveCount(0);
    } finally {
        if (home && !home.isClosed()) for (const name of names) await removePlugin(home, name).catch(() => {});
        await closeElectronApp(app);
    }
});
