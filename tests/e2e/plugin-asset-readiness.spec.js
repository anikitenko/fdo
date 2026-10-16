const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('asset readiness releases listeners and timers on stylesheet failure and view replacement', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'e2e-asset-readiness';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class AssetsPlugin extends FDO_SDK {
                constructor(){super();this.revision=0;}
                get metadata(){return {name:'Asset readiness',version:'1.0.0',author:'E2E',description:'Asset wait lifecycle',icon:'cube'};}
                init(){}
                render(){return '<main><output>'+(++this.revision)+'</output></main>';}
                renderOnLoad(){return '() => {const output=document.querySelector("output");output.dataset.ready=output.textContent;}';}
            }
            new AssetsPlugin();
        `});
        await selectPluginOpen(home, id);
        const frame = home.frameLocator(`iframe[data-plugin-id="${id}"]`);
        const output = frame.locator('output');
        await expect.poll(() => output.getAttribute('data-ready')).toBeTruthy();
        await output.evaluate(() => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            // No href or network request: emulate a sheet that has not settled yet.
            const listeners = new Set(), timers = new Set();
            const add = link.addEventListener.bind(link), remove = link.removeEventListener.bind(link);
            link.addEventListener = (type, callback, options) => {listeners.add(type);add(type, callback, options);};
            link.removeEventListener = (type, callback, options) => {listeners.delete(type);remove(type, callback, options);};
            const schedule = window.setTimeout, cancel = window.clearTimeout;
            window.setTimeout = (callback, delay, ...args) => {
                const timer = Reflect.apply(schedule, window, [callback, delay, ...args]);
                if (delay === 1400) timers.add(timer);
                return timer;
            };
            window.clearTimeout = timer => {timers.delete(timer);Reflect.apply(cancel, window, [timer]);};
            document.head.appendChild(link);
            window.__assetProbe = {link, listeners, timers};
        });
        for (const settle of ['error', 'replace']) {
            const previous = Number(await output.textContent());
            await home.evaluate(id => window.electron.plugin.render(id), id);
            await expect.poll(() => output.evaluate(() => window.__assetProbe.listeners.size)).toBe(2);
            expect(await output.evaluate(() => window.__assetProbe.timers.size)).toBe(1);
            if (settle === 'error') {
                await output.evaluate(() => window.__assetProbe.link.dispatchEvent(new Event('error')));
            } else {
                // Remove the pending asset, then replace the view before its deadline.
                await output.evaluate(() => window.__assetProbe.link.remove());
                await home.evaluate(id => window.electron.plugin.render(id), id);
            }
            await expect.poll(() => output.evaluate(node => Number(node.dataset.ready || 0))).toBeGreaterThan(previous);
            expect(await output.evaluate(() => ({timers: window.__assetProbe.timers.size, listeners: window.__assetProbe.listeners.size})))
                .toEqual({timers: 0, listeners: 0});
        }
    } finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
    }
});
