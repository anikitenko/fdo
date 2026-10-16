const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('chat picker uses lightweight summaries and loads only the chosen conversation', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-chat-lazy-'));
    const settings = new Conf({cwd: profile, configName: 'settings', encryptionKey: 'FDO-APPLICATION'});
    const count = 30;
    settings.set('ai.sessions', Array.from({length: count}, (_, i) => ({
        id: `session-${i}`, name: `Conversation ${i}`, createdAt: new Date(Date.UTC(2026, 9, 16, 10, i)).toISOString(),
        messages: Array.from({length: 20}, (_, j) => ({id: `message-${j}`, role: 'user',
            content: `History for conversation ${i}, message ${j}.`, createdAt: '2026-10-16T10:00:00Z'})),
    })));
    settings.set('ai.options.chatDialog.uiLanguage', 'en');
    // A local-only assistant makes stored messages visible; no prompt is sent.
    settings.set('ai.chat', [{id: 'offline-fixture', name: 'Offline fixture', provider: 'ollama', model: 'offline-fixture', apiKey: null, default: true}]);
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
        const page = await app.firstWindow();
        const summaries = await page.evaluate(() => window.electron.aiChat.listSessions());
        expect(summaries).toHaveLength(count);
        expect(summaries[0]).toMatchObject({id: 'session-29', messageCount: 20});
        expect(summaries.every(item => !Object.hasOwn(item, 'messages'))).toBe(true);
        const selected = await page.evaluate(() => window.electron.aiChat.getSession('session-0'));
        expect(selected.messages).toHaveLength(20);
        expect(selected.messages[0].content).toBe('History for conversation 0, message 0.');
        expect(await page.evaluate(() => window.electron.aiChat.getSession('missing'))).toBeNull();
        await page.getByRole('button', {name: 'Show right sidebar', exact: true}).click();
        await page.getByRole('button', {name: 'Chat with AI Assistant', exact: true}).click();
        const dialog = page.getByRole('dialog', {name: /^Chat with AI Assistant/});
        await expect(dialog.getByText('History for conversation 29, message 19.', {exact: true})).toBeAttached();
        const composer = dialog.getByRole('textbox');
        await composer.fill('Draft while viewing cached history');
        await expect(composer).toHaveValue('Draft while viewing cached history');
        await expect(dialog.getByText('History for conversation 29, message 19.', {exact: true})).toBeAttached();
        await dialog.locator('button[title="Session History"]').click();
        await page.getByRole('menuitem', {name: 'Conversation 0', exact: true}).click();
        await expect(dialog.getByText('History for conversation 0, message 19.', {exact: true})).toBeAttached();
        await expect(dialog.getByText('History for conversation 29, message 0.', {exact: true})).toHaveCount(0);
        // Creating another chat reuses SQLite's one empty draft without reading
        // histories; repeated requests must retain the same draft identity.
        const drafts = await page.evaluate(async () => [
            await window.electron.aiChat.createSession('Empty draft'),
            await window.electron.aiChat.createSession('Reused draft'),
        ]);
        expect(drafts[1]).toMatchObject({id: drafts[0].id, name: 'Reused draft', messages: []});
        expect((await page.evaluate(() => window.electron.aiChat.listSessions())).find(item => item.id === drafts[0].id))
            .toMatchObject({name: 'Reused draft', messageCount: 0});
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
