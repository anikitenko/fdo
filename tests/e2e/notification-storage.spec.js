const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('SQLite notifications survive restart and the store drops obsolete JSON history', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-migration-'));
    const options = {cwd: profile, encryptionKey: 'FDO-APPLICATION'};
    const legacy = {id: 'legacy-notice', title: 'Existing notification', message: 'Preserve me', type: 'warning',
        read: false, createdAt: '2026-10-16T10:00:00Z'};
    // SQLite is authoritative; obsolete JSON copies must not be imported.
    const legacyStore = new Conf({...options, configName: 'settings'});
    const {openNotificationDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');
    const database = openNotificationDatabase(path.join(profile, 'notifications.sqlite'));
    database.execute('add', legacy); database.close();
    legacyStore.set('notifications', [{...legacy, id: 'obsolete-json-copy'}]);
    legacyStore.set('ai.options.chatStreamingDefault', true);
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
    try {
        app = await launch();
        let page = await app.firstWindow();
        await expect.poll(() => page.evaluate(() => window.electron.notifications.get())).toContainEqual(legacy);
        expect(new Conf({...options, configName: 'settings'}).has('notifications')).toBe(false);
        expect((await page.evaluate(() => window.electron.notifications.get())).some(item => item.id === 'obsolete-json-copy')).toBe(false);
        expect(fs.existsSync(path.join(profile, 'settings-before-notifications-sqlite.json'))).toBe(false);
        await page.evaluate(() => window.electron.notifications.markAsRead('legacy-notice'));
        const added = await page.evaluate(() => window.electron.notifications.add('New SQLite notification', 'After migration', 'success'));
        await page.evaluate(() => window.electron.notifications.remove('legacy-notice'));
        await closeElectronApp(app); app = null;
        app = await launch(); page = await app.firstWindow();
        const persisted = await page.evaluate(() => window.electron.notifications.get());
        expect(persisted).toContainEqual(added);
        expect(persisted.some(item => item.id === 'legacy-notice')).toBe(false);
        const configuration = new Conf({...options, configName: 'settings'});
        expect(configuration.has('notifications')).toBe(false);
        expect(configuration.get('ai.options.chatStreamingDefault')).toBe(true);
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
