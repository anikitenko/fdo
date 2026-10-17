const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {DatabaseSync} = require('node:sqlite');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

async function installTransport(app, allowExport = false) {
    await app.evaluate((_electron, allowExport) => {
        globalThis.__observabilityAllowExport = allowExport;
        globalThis.__observabilityExports = [];
        globalThis.fetch = async (url, options = {}) => {
            const address = String(url);
            if (address === 'https://langfuse.example/api/public/projects') return Response.json({data: [{id: 'project', name: 'Fixture'}]});
            if (address === 'https://langfuse.example/api/public/otel/v1/traces') {
                globalThis.__observabilityExports.push({body: JSON.parse(options.body), header: options.headers['x-langfuse-ingestion-version']});
                return globalThis.__observabilityAllowExport ? Response.json({}) : new Response('', {status: 503});
            }
            if (address === 'https://api.openai.com/v1/models/test-model') return Response.json({id: 'test-model'});
            if (address === 'https://api.openai.com/v1/responses') return Response.json({id: 'response', status: 'completed',
                output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Rotations and color rules maintain balance.'}]}],
                usage: {input_tokens: 1000, output_tokens: 100, total_tokens: 1100}});
            throw new Error('Unexpected HTTP request in observability fixture');
        };
    }, allowExport);
}

test('observability settings, encrypted history migration, AI accounting and durable Langfuse retries work across restart', async ({}, testInfo) => {
    test.setTimeout(120000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-observability-e2e-'));
    const store = new Conf({cwd: profile, configName: 'settings', encryptionKey: 'FDO-APPLICATION', projectVersion: '1.0.0', migrations: {}});
    store.set('ai.metrics', {tokens: {requests: 11}, retrieval: {totalQueries: 7, recentMisses: [{ts: new Date().toISOString(), tool: 'search', query: 'private retrieval fixture', scope: 'general', reason: 'no_results'}]}});
    store.set('ai.usageLedger', [{id: 'existing-usage', provider: 'openai', model: 'test-model', surface: 'chat', startedAt: new Date().toISOString(), status: 'pending', usage: {}, cost: {status: 'unknown'}}]);
    store.set('ai.observability.langfuse', {enabled: false, host: 'https://langfuse.example', publicKey: 'pk-lf-fixture', secretKey: 'private-langfuse-secret', environment: 'test'});
    fs.mkdirSync(path.join(profile, 'logs'));
    fs.writeFileSync(path.join(profile, 'logs/startup.log'), JSON.stringify({event: 'imported-start', session: 'previous-launch', elapsed: '25ms', error: {message: 'private startup fixture'}}) + '\n');
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile, FDO_E2E_LIVE_AI: '0'}});
    const openSettings = async page => {
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText: 'Configure FDO'}).click();
        await page.getByRole('tab', {name: 'Observability', exact: true}).click();
        await expect(page.getByRole('heading', {name: 'Observability', exact: true})).toBeVisible();
    };
    try {
        app = await launch(); let page = await app.firstWindow(); await installTransport(app);
        const get = () => page.evaluate(() => window.electron.settings.observability.get());
        const initial = await get();
        expect(initial.metrics.tokens.requests).toBe(11);
        expect(initial.langfuse.hasSecretKey).toBe(true);
        expect(JSON.stringify(initial)).not.toContain('private-langfuse-secret');
        expect(store.has('ai.metrics')).toBe(false); expect(store.has('ai.usageLedger')).toBe(false);
        expect(store.has('ai.observability.langfuse.secretKey')).toBe(false); expect(store.has('observabilityMigration')).toBe(false);
        await expect.poll(() => fs.existsSync(path.join(profile, 'logs/startup.log'))).toBe(false);
        const importedUsage = await page.evaluate(() => window.electron.aiUsage.get());
        expect(importedUsage.entries.find(item => item.id === 'existing-usage').status).toBe('interrupted');
        await openSettings(page);
        await expect(page.getByLabel('Secret key', {exact: true})).toHaveValue('');
        await expect(page.getByLabel('Include prompts, responses, and tool content')).not.toBeChecked();
        await page.getByRole('heading', {name: 'Observability', exact: true}).scrollIntoViewIfNeeded();
        await page.screenshot({path: testInfo.outputPath('langfuse-configuration.png')});
        await page.getByRole('button', {name: 'Test connection', exact: true}).click();
        await expect(page.getByText('Connection verified. Your keys can access a Langfuse project.')).toBeVisible();
        await page.getByText('Record AI traces locally', {exact: true}).click();
        await page.getByText('Include prompts, responses, and tool content', {exact: true}).click();
        await page.getByText('Export traces to Langfuse', {exact: true}).click();
        await page.getByRole('button', {name: 'Save observability settings'}).click();
        await expect(page.getByText('Observability settings saved.')).toBeVisible();
        await page.screenshot({path: testInfo.outputPath('observability-settings.png')});
        const chat = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Observability fixture', provider: 'openai', purpose: 'chat', model: 'test-model', apiKey: 'test-only-token'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Observability fixture');
            const session = await window.electron.aiChat.createSession('Trace fixture');
            const result = await window.electron.aiChat.sendMessage({sessionId: session.id, assistantId: assistant.id,
                content: 'Explain how a red-black tree maintains balance. Private trace fixture.', stream: false, think: false});
            return {result, usage: await window.electron.aiUsage.get({surface: 'chat', sessionId: session.id})};
        });
        expect(chat.result.messages.at(-1).content).not.toMatch(/^Error:/);
        expect(chat.usage.requests).toBeGreaterThan(0); expect(chat.usage.persistenceError).toBe(false);
        const recorded = await get(); expect(recorded.traces).toHaveLength(1);
        const traceId = recorded.traces[0].id;
        const detail = await page.evaluate(id => window.electron.settings.observability.trace(id), traceId);
        expect(JSON.stringify(detail)).toContain('Private trace fixture.');
        await page.evaluate(() => window.electron.settings.observability.retry());
        const failedAttempt = (await get()).traces[0]; expect(failedAttempt).toMatchObject({exportState: 'pending', attempts: 1});
        await expect.poll(async () => (await get()).counts.runtime_samples).toBeGreaterThan(0);
        await closeElectronApp(app); app = null;
        app = await launch(); page = await app.firstWindow(); await installTransport(app, true);
        expect((await get()).traces[0].id).toBe(traceId);
        expect((await page.evaluate(() => window.electron.aiUsage.get())).entries.some(item => item.id === 'existing-usage')).toBe(true);
        await openSettings(page);
        await expect(page.getByLabel('Record AI traces locally')).toBeChecked();
        await page.getByRole('button', {name: 'Retry pending exports'}).click();
        await expect.poll(async () => (await get()).traces[0].exportState).toBe('sent');
        const exported = await app.evaluate(() => globalThis.__observabilityExports);
        expect(exported.at(-1).header).toBe('4'); expect(exported.at(-1).body.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0);
        await page.getByRole('button', {name: 'View trace', exact: true}).click();
        await expect(page.getByRole('dialog', {name: 'AI trace details'})).toContainText('Private trace fixture.');
        const inspection = new DatabaseSync(path.join(profile, 'observability.sqlite'));
        expect(inspection.prepare(/* language=SQLite */ 'SELECT count(*) AS n FROM usage_entries').get().n).toBeGreaterThan(1);
        inspection.close();
        for (const file of fs.readdirSync(profile).filter(name => name.startsWith('observability.sqlite'))) {
            const bytes = fs.readFileSync(path.join(profile, file));
            for (const secret of ['private retrieval fixture', 'private startup fixture', 'Private trace fixture.', 'private-langfuse-secret']) expect(bytes.includes(Buffer.from(secret))).toBe(false);
        }
    } finally {await closeElectronApp(app); fs.rmSync(profile, {recursive: true, force: true});}
});
