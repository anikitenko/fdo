const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Cloudflare coding settings persist through native IPC, strict schema and app restart', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cloudflare-settings-'));
    let app;
    const launch = async () => {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
            FDO_E2E_USER_DATA_DIR: directory, FDO_E2E_LIVE_AI: '0',
        }});
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); }
            catch { return false; }
        }), {timeout: 15000}).toBe(true);
        return page;
    };
    try {
        let page = await launch();
        // Only remote metadata is simulated; use the built app's real settings
        // handlers and encrypted store. No network or model inference is allowed.
        await app.evaluate(() => {
            globalThis.__cloudflareMetadataRequests = [];
            globalThis.fetch = async (url, options) => {
                if (!String(url).startsWith(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/models/search?`)) {
                    throw new Error('Unexpected provider request in settings regression');
                }
                if (options.headers.Authorization !== 'Bearer test-only-token') throw new Error('Incorrect token');
                globalThis.__cloudflareMetadataRequests.push(String(url));
                return new Response(JSON.stringify({success: true, result: [{name: '@cf/test/model', task: {name: 'Text Generation'}}]}),
                    {headers: {'Content-Type': 'application/json'}});
            };
        });
        const models = await page.evaluate(() => window.electron.settings.ai.getAvailableModels('cloudflare', 'test-only-token', undefined, 'a'.repeat(32)));
        expect(models).toEqual([{label: '@cf/test/model', value: '@cf/test/model', provider: 'cloudflare'}]);
        const assistant = {name: 'Workers regression', provider: 'cloudflare', purpose: 'coding', model: '@cf/test/model',
            apiKey: ' test-only-token ', accountId: ` ${'a'.repeat(32)} `, baseUrl: 'http://localhost:11434', contextLength: 32768, firstResponseTimeoutMs: '420000'};
        await page.evaluate(data => window.electron.settings.ai.addAssistant(data), assistant);
        const stored = (await page.evaluate(() => window.electron.settings.ai.getAssistants())).find(item => item.name === assistant.name);
        expect(stored).toMatchObject({provider: 'cloudflare', purpose: 'coding', accountId: 'a'.repeat(32), apiKey: 'test-only-token', firstResponseTimeoutMs: 420000});
        expect(stored).not.toHaveProperty('baseUrl');
        expect(stored).not.toHaveProperty('contextLength');
        await expect(page.evaluate(data => window.electron.settings.ai.addAssistant(data), {...assistant, unexpectedSetting: true}))
            .rejects.toThrow('additional properties');
        await expect(page.evaluate(data => window.electron.settings.ai.addAssistant(data), {...assistant, purpose: 'chat'}))
            .rejects.toThrow('Coding Assistant purpose');
        await expect(page.evaluate(data => window.electron.settings.ai.addAssistant(data), {...assistant, firstResponseTimeoutMs: 0}))
            .rejects.toThrow('First response timeout');
        expect(await app.evaluate(() => globalThis.__cloudflareMetadataRequests.length)).toBe(3);
        await closeElectronApp(app);
        app = null;
        page = await launch();
        const reloaded = await page.evaluate(() => window.electron.settings.ai.getAssistants());
        expect(reloaded.filter(item => item.name === assistant.name)).toEqual([expect.objectContaining({id: stored.id,
            provider: 'cloudflare', accountId: 'a'.repeat(32), model: '@cf/test/model', apiKey: 'test-only-token', firstResponseTimeoutMs: 420000})]);
    } finally {
        if (app) await closeElectronApp(app);
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
