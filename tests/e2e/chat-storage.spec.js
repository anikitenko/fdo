const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('chat migration preserves history, backs up JSON, and persists edits across restarts', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-chat-migration-'));
    const options = {cwd: profile, encryptionKey: 'FDO-APPLICATION'};
    const legacyStore = new Conf({...options, configName: 'settings'});
    const legacy = {id: 'existing-chat', name: 'Existing conversation', createdAt: '2026-10-16T10:00:00Z', messages: [
        {id: 'original-message', role: 'user', content: 'Preserved private chat content', createdAt: '2026-10-16T10:00:00Z'},
    ]};
    legacyStore.set('ai.sessions', [legacy]);
    legacyStore.set('ai.options.chatDialog.uiLanguage', 'uk');
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
    let app;
    try {
        app = await launch();
        let page = await app.firstWindow();
        let sessions = await page.evaluate(() => window.electron.aiChat.getSessions());
        expect(sessions).toEqual(expect.arrayContaining([expect.objectContaining({id: legacy.id, messages: expect.arrayContaining([
            expect.objectContaining({id: 'original-message', content: 'Preserved private chat content'}),
        ])})]));
        expect(new Conf({...options, configName: 'settings'}).get('ai.sessions', [])).toEqual([]);
        const backup = new Conf({...options, configName: 'settings-before-chat-sqlite'});
        expect(backup.get('ai.sessions')[0]).toMatchObject(legacy);
        expect(backup.get('ai.options.chatDialog.uiLanguage')).toBe('uk');
        await page.evaluate(() => window.electron.aiChat.renameSession('existing-chat', 'Renamed conversation'));
        // No assistant is configured: the turn must commit its user message
        // before returning the provider-selection error, without any API call.
        const send = page.evaluate(() => window.electron.aiChat.sendMessage({sessionId: 'existing-chat', content: 'Follow-up stored before provider selection'}));
        await expect(send).rejects.toThrow();
        const drafts = await page.evaluate(() => Promise.all([
            window.electron.aiChat.createSession('First draft'), window.electron.aiChat.createSession('Second draft'),
        ]));
        expect(drafts[0].id).toBe(drafts[1].id);
        await app.evaluate(({app, BrowserWindow}) => {
            globalThis.__cancelChatTestCloseObserved = false;
            globalThis.__cancelChatTestClose = event => {
                event.preventDefault();
                globalThis.__cancelChatTestCloseObserved = true;
            };
            BrowserWindow.getAllWindows()[0].on('close', globalThis.__cancelChatTestClose);
            app.quit();
        });
        await expect.poll(() => app.evaluate(() => globalThis.__cancelChatTestCloseObserved)).toBe(true);
        await page.evaluate(() => window.electron.aiChat.renameSession('existing-chat', 'Renamed after cancelled quit'));
        await app.evaluate(({BrowserWindow}) => {
            BrowserWindow.getAllWindows()[0].removeListener('close', globalThis.__cancelChatTestClose);
        });
        await closeElectronApp(app); app = null;
        app = await launch();
        page = await app.firstWindow();
        sessions = await page.evaluate(() => window.electron.aiChat.getSessions());
        const persisted = sessions.find(session => session.id === 'existing-chat');
        expect(persisted.name).toBe('Renamed after cancelled quit');
        expect(persisted.messages).toEqual(expect.arrayContaining([expect.objectContaining({content: 'Follow-up stored before provider selection'})]));
        expect(sessions.filter(session => session.messages.length === 0)).toHaveLength(1);
        expect(await page.evaluate(() => window.electron.aiChat.getPreferences())).toMatchObject({uiLanguage: 'uk'});
    } finally {
        if (app) await app.evaluate(({BrowserWindow}) => {
            if (globalThis.__cancelChatTestClose) for (const window of BrowserWindow.getAllWindows()) window.removeListener('close', globalThis.__cancelChatTestClose);
        }).catch(() => {});
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
