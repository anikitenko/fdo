const {test, expect, _electron: electron} = require('@playwright/test');
const {createServer} = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Ollama assistant settings survive native IPC persistence and an app restart', async () => {
    // Only model metadata is simulated. IPC, schema validation, encryption and
    // disk persistence use the built application. No model generation occurs.
    const requests = [];
    const server = createServer((request, response) => {
        requests.push(request.url);
        request.resume();
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/api/show') response.end(JSON.stringify({capabilities: ['completion', 'vision']}));
        else { response.statusCode = 404; response.end('{}'); }
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-ollama-settings-'));
    let app;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const launch = async () => {
            app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
                FDO_E2E_USER_DATA_DIR: directory, FDO_E2E_LIVE_AI: '0',
            }});
            const page = await app.firstWindow();
            // The first window can load before main-process handlers register.
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); }
                catch { return false; }
            }), {timeout: 15000}).toBe(true);
        };
        await launch();
        let page = await app.firstWindow();
        const assistant = {name: 'Local regression', provider: 'ollama', purpose: 'coding', model: 'qwen3-vl:8b',
            apiKey: '', baseUrl: `${baseUrl}/`, contextLength: '16384', defaultThinkingMode: 'auto'};
        await page.evaluate(data => window.electron.settings.ai.addAssistant(data), assistant);
        const initial = await page.evaluate(() => window.electron.settings.ai.getAssistants());
        const stored = initial.find(item => item.name === 'Local regression');
        expect(stored).toMatchObject({provider: 'ollama', purpose: 'coding', apiKey: '', baseUrl, contextLength: 16384});
        // Updating the existing assistant should also preserve normalized fields.
        await page.evaluate(data => window.electron.settings.ai.addAssistant(data), {...assistant, contextLength: '32768'});
        // Keep the strict schema: arbitrary properties must still be rejected.
        await expect(page.evaluate(data => window.electron.settings.ai.addAssistant(data), {...assistant, unexpectedSetting: true}))
            .rejects.toThrow('additional properties');
        await closeElectronApp(app);
        app = null;
        await launch();
        page = await app.firstWindow();
        const reloaded = await page.evaluate(() => window.electron.settings.ai.getAssistants());
        expect(reloaded.filter(item => item.name === 'Local regression')).toEqual([
            expect.objectContaining({id: stored.id, provider: 'ollama', baseUrl, contextLength: 32768, apiKey: ''}),
        ]);
        expect(requests).toEqual(['/api/show', '/api/show', '/api/show']);
    } finally {
        if (app) await closeElectronApp(app);
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
