const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');

test('plugin bridge routes concurrent replies without per-request listeners and cancels replaced views', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const pluginName = 'e2e-request-bridge';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: 'request-bridge'}, {pluginName, compiledContent: `
            const {FDO_SDK, PluginRegistry} = require('@anikitenko/fdo-sdk');
            class BridgePlugin extends FDO_SDK {
                get metadata() {return {name: 'Request Bridge', version: '1.0.0', author: 'E2E', description: 'Bridge fixture', icon: 'cube'};}
                init() {PluginRegistry.registerHandler('echo', async data => {
                    if (data.slow) await new Promise(resolve => setTimeout(resolve, 1000));
                    return {value: data.value};
                });}
                render() {return '<main>Request bridge ready</main>';}
            }
            new BridgePlugin();
        `});
        await selectPluginOpen(home, pluginName);
        const frame = home.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
        await expect(frame.locator('main')).toHaveText('Request bridge ready');
        const result = await frame.locator('main').evaluate(async () => {
            const original = window.addEventListener;
            let messageListeners = 0;
            window.addEventListener = function(type, ...args) {
                if (type === 'message') messageListeners++;
                return original.call(this, type, ...args);
            };
            try {
                const replies = await Promise.all(Array.from({length: 50}, (_, value) =>
                    window.createBackendReq('UI_MESSAGE', {handler: 'echo', content: {value}})));
                return {messageListeners, replies};
            } finally {window.addEventListener = original;}
        });
        expect(result.messageListeners).toBe(0);
        expect(result.replies.map(reply => reply.result?.value ?? reply.value)).toEqual(Array.from({length: 50}, (_, i) => i));
        await frame.locator('main').evaluate(() => {
            window.__bridgeCancelled = null;
            window.createBackendReq('echo', {value: 'old', slow: true}).then(result => {window.__bridgeCancelled = result;});
        });
        await home.evaluate(id => {
            document.querySelector(`iframe[data-plugin-id="${id}"]`).contentWindow.postMessage({
                type: 'PLUGIN_RENDER', content: {code: JSON.stringify('<main>Replacement view ready</main>'), onLoad: 'null'},
            }, '*');
        }, pluginName);
        await expect(frame.locator('main')).toHaveText('Replacement view ready');
        await expect.poll(() => frame.locator('main').evaluate(() => window.__bridgeCancelled)).toEqual({
            success: false, error: 'The plugin view was disposed.',
        });
        const fresh = await frame.locator('main').evaluate(() => window.createBackendReq('echo', {value: 'fresh'}));
        expect(fresh.result?.value ?? fresh.value).toBe('fresh');
    } finally {
        if (home && !home.isClosed()) await removePlugin(home, pluginName).catch(() => {});
        await closeElectronApp(app);
    }
});
