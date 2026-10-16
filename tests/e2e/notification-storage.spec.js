const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('notification JSON migration and SQLite updates survive application restarts', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-migration-'));
    fs.mkdirSync(path.resolve('node_modules/.cache'), {recursive: true});
    const cache = fs.mkdtempSync(path.resolve('node_modules/.cache/fdo-notification-migration-'));
    const storeModule = path.join(cache, 'store.cjs');
    require('esbuild').buildSync({entryPoints: ['src/utils/persistence/store.js'], outfile: storeModule,
        bundle: true, platform: 'node', format: 'cjs', packages: 'external'});
    const legacy = {id: 'legacy-notice', title: 'Existing notification', message: 'Preserve me', type: 'warning',
        read: false, createdAt: '2026-10-16T10:00:00Z'};
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
    try {
        // Prepare the real encrypted JSON format using Electron's store module.
        app = await launch();
        await app.evaluate((_, {storeModule, legacy}) => {
            const {settings} = process.mainModule.require(storeModule);
            settings.set('notifications', [legacy]);
            settings.set('ai.options.chatStreamingDefault', true);
        }, {storeModule, legacy});
        await closeElectronApp(app);
        app = null;
        // Recreate a pre-migration profile after its owning process has exited.
        for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(profile, 'notifications.sqlite' + suffix), {force: true});
        app = await launch();
        let page = await app.firstWindow();
        await expect.poll(() => page.evaluate(() => window.electron.notifications.get())).toContainEqual(legacy);
        await page.evaluate(() => window.electron.notifications.markAsRead('legacy-notice'));
        const added = await page.evaluate(() => window.electron.notifications.add('New SQLite notification', 'After migration', 'success'));
        await page.evaluate(() => window.electron.notifications.remove('legacy-notice'));
        await closeElectronApp(app);
        app = null;
        app = await launch();
        page = await app.firstWindow();
        const persisted = await page.evaluate(() => window.electron.notifications.get());
        expect(persisted).toContainEqual(added);
        expect(persisted.some(item => item.id === 'legacy-notice')).toBe(false);
        const backup = await app.evaluate((_, storeModule) => {
            const {settings} = process.mainModule.require(storeModule);
            return {notifications: settings.get('notifications'), preference: settings.get('ai.options.chatStreamingDefault')};
        }, storeModule);
        expect(backup).toEqual({notifications: [legacy], preference: true});
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
        fs.rmSync(cache, {recursive: true, force: true});
    }
});
