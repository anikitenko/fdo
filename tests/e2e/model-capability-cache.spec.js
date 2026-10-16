const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('capability lookups share one inspection and reuse the persisted cache after restart', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-capability-cache-'));
    const settings = new Conf({cwd: profile, configName: 'settings', encryptionKey: 'FDO-APPLICATION'});
    settings.set('ai.chat', [{id: 'cache-fixture', name: 'Cache fixture', provider: 'gemini', model: 'test-model', apiKey: 'test-only-secret', default: true}]);
    let app;
    try {
        for (const restarted of [false, true]) {
            app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
            await app.evaluate(() => {
                globalThis.__cacheInspections = 0;
                globalThis.fetch = async url => {
                    if (String(url) !== 'https://generativelanguage.googleapis.com/v1beta/models/test-model') {
                        throw new Error('Cache fixture must not submit inference or other requests');
                    }
                    globalThis.__cacheInspections++;
                    return Response.json({name: 'models/test-model', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000000, outputTokenLimit: 64000});
                };
            });
            const page = await app.firstWindow();
            const results = await page.evaluate(() => Promise.all(Array.from({length: 100}, () => window.electron.aiChat.getCapabilities('test-model', 'gemini', 'cache-fixture'))));
            expect(results[0]).toMatchObject({provider: 'gemini', maxTokens: 1000000, maxOutputTokens: 64000});
            expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
            await page.evaluate(async () => {
                for (let i = 0; i < 20; i++) await window.electron.aiChat.getCapabilities('test-model', 'gemini', 'cache-fixture');
            });
            expect(await app.evaluate(() => globalThis.__cacheInspections)).toBe(restarted ? 0 : 1);
            const persisted = fs.readFileSync(path.join(profile, 'ai_model_cache.json'), 'utf8');
            expect(persisted).not.toContain('test-only-secret');
            expect(JSON.parse(persisted).data['test-model']).toMatchObject({provider: 'gemini', maxTokens: 1000000});
            await closeElectronApp(app);app = null;
        }
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
