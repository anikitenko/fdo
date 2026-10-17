const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openNotificationDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('View opens the exact notification deep in history and briefly highlights it, including with reduced motion', async ({}, testInfo) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-focus-'));
    const db = openNotificationDatabase(path.join(profile, 'notifications.sqlite'));
    const records = Array.from({length: 1000}, (_, index) => ({id: `notice-${index}`, title: `Operation ${index}`,
        message: `Outcome for plugin ${index}`, source: 'plugins', type: 'primary', read: false,
        createdAt: new Date(Date.UTC(2026, 9, 16, 10) - index * 1000).toISOString()}));
    records.forEach(record => db.execute('add', record, false)); db.close();
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
        const page = await app.firstWindow();
        await page.getByRole('button', {name: /^Open notifications/}).click();
        await page.getByRole('button', {name: 'Needs attention', exact: true}).click();
        await page.getByRole('button', {name: 'Close', exact: true}).click();
        const target = records[900];
        const emitAlert = () => app.evaluate(({BrowserWindow}, notification) => {
            BrowserWindow.getAllWindows()[0].webContents.send('notifications:on_off:alert', notification);
        }, target);
        await emitAlert();
        await page.locator('.bp6-toast').getByRole('button', {name: 'View', exact: true}).click();
        const row = page.locator(`[data-notification-id="${target.id}"]`);
        await expect(row).toBeInViewport();
        await expect(row).toHaveAttribute('data-notification-highlighted', 'true');
        await expect(row).toBeFocused();
        await expect(page.getByRole('button', {name: 'All', exact: true})).toHaveAttribute('aria-pressed', 'true');
        await page.screenshot({path: testInfo.outputPath('notification-target-highlight.png')});
        await expect(row).not.toHaveAttribute('data-notification-highlighted', 'true', {timeout: 6000});
        await page.getByRole('button', {name: 'Close', exact: true}).click();
        await page.emulateMedia({reducedMotion: 'reduce'});
        await emitAlert();
        await page.locator('.bp6-toast').getByRole('button', {name: 'View', exact: true}).click();
        await expect(row).toBeInViewport();
        await expect(row).toHaveAttribute('data-notification-highlighted', 'true');
        await expect(row).toHaveCSS('animation-name', 'none');
        await expect(row).toHaveCSS('outline-style', 'solid');
    } finally {await closeElectronApp(app); fs.rmSync(profile, {recursive: true, force: true});}
});
