const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('plugin element waits use DOM observation and are cancelled when their view is replaced', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'e2e-element-waits';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class WaitPlugin extends FDO_SDK {
                constructor(){super();this.revision=0;}
                get metadata(){return {name:'Element waits',version:'1.0.0',author:'E2E',description:'Element wait lifecycle',icon:'cube'};}
                init(){}
                render(){return '<main><output>'+(++this.revision)+'</output><div id="present">Present</div><div id="ground"></div></main>';}
                renderOnLoad(){return '() => {window.waitForElement("#present", node => {node.dataset.found="true";});}';}
            }
            new WaitPlugin();
        `});
        await selectPluginOpen(home, id);
        const frame = home.frameLocator(`iframe[data-plugin-id="${id}"]`);
        await expect(frame.locator('#present')).toHaveAttribute('data-found', 'true');
        const intervals = await frame.locator('main').evaluate(async () => {
            const original = window.setInterval;
            let intervals = 0;
            window.setInterval = (handler, delay, ...args) => {intervals++;return original(handler, delay, ...args);};
            try {
                window.__foundElements = 0;
                for (let i = 0; i < 50; i++) window.waitForElement(`#later-${i}`, () => window.__foundElements++);
                window.waitForElement('#present.ready', () => {window.__attributeWait = true;});
                await Promise.resolve();
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < 50; i++) {
                    const node = document.createElement('div');node.id = `later-${i}`;fragment.append(node);
                }
                document.getElementById('ground').append(fragment);
                document.getElementById('present').classList.add('ready');
                return intervals;
            } finally {window.setInterval = original;}
        });
        expect(intervals).toBe(0);
        await expect.poll(() => frame.locator('main').evaluate(() => window.__foundElements)).toBe(50);
        await expect.poll(() => frame.locator('main').evaluate(() => window.__attributeWait)).toBe(true);
        const previous = Number(await frame.locator('output').textContent());
        await frame.locator('main').evaluate(() => {
            window.__staleWaitFired = 0;
            window.waitForElement('#stale-target', () => window.__staleWaitFired++, 3000);
        });
        await home.evaluate(id => window.electron.plugin.render(id), id);
        await expect.poll(async () => Number(await frame.locator('output').textContent())).toBeGreaterThan(previous);
        await expect(frame.locator('#present')).toHaveAttribute('data-found', 'true');
        const stale = await frame.locator('main').evaluate(async () => {
            const node = document.createElement('div');node.id = 'stale-target';document.getElementById('ground').append(node);
            await new Promise(resolve => setTimeout(resolve, 220));
            return window.__staleWaitFired;
        });
        expect(stale).toBe(0);
        await expect(frame.getByText('Plugin failed to load', {exact: true})).toHaveCount(0);
    } finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
    }
});
