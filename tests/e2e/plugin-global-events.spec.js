const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('global event helpers release old view callbacks across repeated plugin renders', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'e2e-global-events';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class EventsPlugin extends FDO_SDK {
                constructor(){super();this.revision=0;}
                get metadata(){return {name:'Global event lifecycle',version:'1.0.0',author:'E2E',description:'View event ownership',icon:'cube'};}
                init(){}
                render(){return '<main><output>'+(++this.revision)+'</output></main>';}
                renderOnLoad(){return '() => {const output=document.querySelector("output"); window.addGlobalEventListener("fdo-test-event", () => {window.__delivered.push(output.textContent);}); output.dataset.ready=output.textContent; return () => {document.documentElement.dataset.cleanupHelpers=String(typeof window.removeGlobalEventListener === "function");};}';}
            }
            new EventsPlugin();
        `});
        await selectPluginOpen(home, id);
        const frame = home.frameLocator(`iframe[data-plugin-id="${id}"]`);
        const root = frame.locator('main');
        let previous = 0;
        for (let i = 0; i < 12; i++) {
            if (i) await home.evaluate(id => window.electron.plugin.render(id), id);
            await expect.poll(() => root.evaluate(node => Number(node.querySelector('output').dataset.ready || 0))).toBeGreaterThan(previous);
            const result = await root.evaluate(() => {
                window.__delivered = [];
                for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('fdo-test-event'));
                return {revision: Number(document.querySelector('output').dataset.ready), delivered: window.__delivered};
            });
            previous = result.revision;
            expect(result.delivered).toEqual(Array(100).fill(String(previous)));
        }
        const manual = await root.evaluate(() => {
            let calls = 0;
            const callback = () => calls++;
            window.addGlobalEventListener('resize', callback);window.addGlobalEventListener('resize', callback);
            window.dispatchEvent(new Event('resize'));
            window.removeGlobalEventListener('resize', callback);
            window.dispatchEvent(new Event('resize'));
            window.__staleAdd = window.addGlobalEventListener;
            return calls;
        });
        expect(manual).toBe(1);
        await home.evaluate(id => window.electron.plugin.render(id), id);
        await expect.poll(() => root.evaluate(node => Number(node.querySelector('output').dataset.ready || 0))).toBeGreaterThan(previous);
        const stale = await root.evaluate(() => {
            let calls = 0;
            window.__staleAdd('stale-owner', () => calls++);
            window.dispatchEvent(new Event('stale-owner'));
            return calls;
        });
        expect(stale).toBe(0);
        expect(await root.evaluate(() => document.documentElement.dataset.cleanupHelpers)).toBe('true');
        await expect(frame.getByText('Plugin failed to load', {exact: true})).toHaveCount(0);
    } finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
    }
});
