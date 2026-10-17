const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('notification bell, filters, incidents, read state, undo, actions and preferences work across restart', async ({}, testInfo) => {
    test.setTimeout(90000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-ux-'));
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
    try {
        app = await launch();
        let page = await app.firstWindow();
        await page.evaluate(async () => {
            await window.electron.notifications.removeAll();
            await window.electron.notifications.savePreferences({successToasts: false, failureToasts: true, infoToasts: false, retentionDays: 0, mutedSources: []});
            window.__notificationAlerts = [];
            window.electron.notifications.onAlert(item => window.__notificationAlerts.push(item));
        });
        const notice = await page.evaluate(async () => {
            const metadata = {source: 'gitops', groupKey: 'gitops:fixture', details: 'Full commit: abc123456789. Repository access was denied.',
                actions: [{kind: 'view-gitops', repositoryId: 'deleted-repository'}, {kind: 'retry-gitops', repositoryId: 'deleted-repository'}]};
            await window.electron.notifications.add('Repository unavailable', 'Check repository access before retrying.', 'danger', metadata);
            const second = await window.electron.notifications.add('Repository unavailable', 'Check repository access before retrying.', 'danger', metadata);
            await window.electron.notifications.add('Build complete', 'Compilation completed. The output is available in the editor.', 'success', {source: 'builds'});
            return second;
        });
        await expect.poll(() => page.evaluate(() => window.__notificationAlerts.length)).toBe(1);
        expect(notice.occurrences).toBe(2);
        await page.getByRole('button', {name: 'Open notifications (2 unread)', exact: true}).click();
        const list = page.getByRole('list', {name: 'Notifications'});
        const row = list.locator(`[data-notification-id="${notice.id}"]`);
        await expect(list.getByRole('listitem')).toHaveCount(2);
        await expect(row.getByText('2 occurrences')).toBeVisible();
        await row.getByRole('button', {name: 'Show details'}).click();
        await expect(row.locator('pre')).toContainText('abc123456789');
        await row.getByRole('button', {name: 'View GitOps repository'}).click();
        await expect(page.getByRole('alert')).toContainText('no longer exists');
        await row.getByRole('button', {name: /^Mark read:/}).click();
        await expect(row.getByRole('button', {name: /^Mark unread:/})).toBeVisible();
        await page.getByRole('button', {name: 'Unread', exact: true}).click();
        await expect(list.getByRole('listitem')).toHaveCount(1);
        await page.getByRole('button', {name: 'Needs attention', exact: true}).click();
        await expect(list.getByRole('listitem')).toHaveCount(1);
        await page.getByRole('combobox', {name: 'Notification source'}).selectOption('builds');
        await expect(page.getByText('No matching notifications')).toBeVisible();
        await page.getByRole('button', {name: 'Clear filters'}).click();
        await row.getByRole('button', {name: 'Dismiss Repository unavailable', exact: true}).click();
        await expect(row).toHaveCount(0);
        await page.getByRole('button', {name: 'Undo', exact: true}).click();
        await expect(row).toBeVisible();
        await page.getByRole('button', {name: 'Dismiss all', exact: true}).click();
        await expect(page.getByText("You're all caught up!", {exact: true})).toBeVisible();
        await page.getByRole('button', {name: 'Undo', exact: true}).click();
        await expect(list.getByRole('listitem')).toHaveCount(2);
        await page.evaluate(() => window.electron.notifications.add('Repository synchronization recovered', 'Repository access is working again.', 'success',
            {source: 'gitops', groupKey: 'gitops:fixture', status: 'resolved'}));
        await expect(row.getByText('Resolved', {exact: true})).toBeVisible();
        await expect(row.getByRole('button', {name: 'Retry', exact: true})).toHaveCount(0);
        await page.getByRole('button', {name: 'Needs attention', exact: true}).click();
        await expect(page.getByText('No matching notifications')).toBeVisible();
        await page.getByRole('button', {name: 'Clear filters'}).click();
        await page.getByRole('button', {name: 'Notification preferences', exact: true}).click();
        await expect(page.getByRole('button', {name: 'Mark all as read', exact: true})).toHaveCount(0);
        await expect(page.getByRole('button', {name: 'Dismiss all', exact: true})).toHaveCount(0);
        await page.getByRole('region', {name: 'Notification preferences'}).locator('label').filter({hasText: /^GitOps$/}).click();
        await expect(page.getByRole('checkbox', {name: 'GitOps', exact: true})).not.toBeChecked();
        await page.getByRole('button', {name: 'Save notification preferences', exact: true}).click();
        await expect(page.getByText('Notification preferences saved.')).toBeVisible();
        await page.getByRole('button', {name: 'Notification preferences', exact: true}).click();
        await page.getByRole('button', {name: 'Mark all as read', exact: true}).click();
        await expect.poll(() => page.evaluate(async () => (await window.electron.notifications.get()).every(item => item.read))).toBe(true);
        await page.screenshot({path: testInfo.outputPath('notification-history.png')});
        await closeElectronApp(app); app = null;
        app = await launch(); page = await app.firstWindow();
        expect(await page.evaluate(() => window.electron.notifications.getPreferences())).toMatchObject({successToasts: false, mutedSources: ['gitops']});
        const history = await page.evaluate(() => window.electron.notifications.get());
        expect(history.find(item => item.id === notice.id)).toMatchObject({status: 'resolved', occurrences: 2, read: true, source: 'gitops'});
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
