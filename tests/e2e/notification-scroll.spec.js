const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openNotificationDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('notification scrolling reaches all history with bounded rows, stable anchors and full search', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-scroll-'));
    const database = openNotificationDatabase(path.join(profile, 'notifications.sqlite'));
    Array.from({length: 1000}, (_, i) => ({id: `scroll-${i}`, title: `Notice ${i}`,
        message: `Message ${i}. ` + 'Variable height notification content. '.repeat(i % 9 === 0 ? 90 : i % 3 + 1),
        type: '', read: false, createdAt: new Date(Date.UTC(2026, 9, 16, 10, 0, 0) - i * 1000).toISOString()}))
        .forEach(record => database.execute('add', record, false));
    database.close();
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
        const page = await app.firstWindow();
        await page.getByRole('button', {name: /^Open notifications/}).click();
        const list = page.getByRole('list', {name: 'Notifications'});
        await expect(list.locator('[data-notification-id="scroll-0"]')).toBeVisible();
        const mountedRowCounts = [await list.getByRole('listitem').count()];
        expect(mountedRowCounts[0]).toBeLessThan(50);
        await expect(page.getByRole('button', {name: 'Next', exact: true})).toHaveCount(0);
        // Small wheel-sized steps exercise real measured heights, not just a jump.
        for (let i = 0; i < 12; i++) {
            await list.evaluate(async node => {
                node.scrollTop += 500;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            mountedRowCounts.push(await list.getByRole('listitem').count());
            expect(mountedRowCounts.at(-1)).toBeLessThan(50);
            const covered = await list.evaluate(node => {
                const bounds = node.getBoundingClientRect();
                const rows = [...node.querySelectorAll('[data-notification-id]')].map(row => row.getBoundingClientRect())
                    .filter(rect => rect.bottom > bounds.top + 16 && rect.top < bounds.bottom - 16);
                return rows.length > 0 && rows[0].top <= bounds.top + 29
                    && rows.at(-1).bottom >= bounds.bottom - 29
                    && rows.every((rect, index) => index === 0 || rect.top - rows[index - 1].bottom <= 13);
            });
            expect(covered).toBe(true);
        }
        await expect(list.locator('[data-notification-id="scroll-0"]')).toHaveCount(0);
        const anchor = await list.evaluate(node => {
            const top = node.getBoundingClientRect().top;
            const row = [...node.querySelectorAll('[data-notification-id]')].find(row => {
                const rect = row.getBoundingClientRect();
                return rect.bottom > top + 50 && rect.top < top + node.clientHeight;
            });
            return {id: row.dataset.notificationId, top: row.getBoundingClientRect().top};
        });
        await page.evaluate(() => window.electron.notifications.add('Arrived during scroll', 'Keep my place', 'success'));
        await expect.poll(async () => list.locator(`[data-notification-id="${anchor.id}"]`).evaluate(row => row.getBoundingClientRect().top)).toBeCloseTo(anchor.top, 0);
        // End jumps may need another frame after previously unseen rows are measured.
        await expect.poll(async () => {
            return list.evaluate(async node => {
                node.scrollTop = node.scrollHeight;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const row = node.querySelector('[data-notification-id="scroll-999"]');
                return !!row && row.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom;
            });
        }).toBe(true);
        await list.evaluate(node => {node.scrollTop = 0;});
        await expect(list.locator('[data-notification-id="scroll-0"]')).toBeVisible();
        await expect(list.locator('[data-notification-id="scroll-999"]')).toHaveCount(0);
        await page.screenshot({path: test.info().outputPath('notification-scroll-top.png')});
        const metrics = test.info().outputPath('notification-scroll-metrics.json');
        fs.writeFileSync(metrics, JSON.stringify({totalNotifications: 1000, mountedRowCounts}, null, 2));
        await test.info().attach('Notification DOM window', {path: metrics, contentType: 'application/json'});
        const search = page.getByPlaceholder('Filter notifications...');
        await search.fill('Message 999.');
        await expect(list.getByRole('listitem')).toHaveCount(1);
        await expect(list.locator('[data-notification-id="scroll-999"]')).toBeVisible();
        await page.getByRole('button', {name: 'Dismiss Notice 999', exact: true}).click();
        await expect(page.getByText('No matching notifications', {exact: true})).toBeVisible();
        await search.fill('');
        await expect(list.locator('[data-notification-id="scroll-0"]')).toBeVisible();
        await page.getByRole('button', {name: 'Mark all as read', exact: true}).click();
        await expect.poll(() => page.evaluate(async () => (await window.electron.notifications.get()).every(item => item.read))).toBe(true);
        // Narrowing the panel changes line wrapping and must not leave holes.
        await app.evaluate(({BrowserWindow}) => {
            const [mainWindow] = BrowserWindow.getAllWindows();
            mainWindow.setSize(900, 650, false);
        });
        await expect(list.getByRole('listitem').first()).toBeVisible();
        expect(await list.getByRole('listitem').count()).toBeLessThan(50);
        await page.getByRole('button', {name: 'Dismiss all', exact: true}).click();
        await expect(page.getByText("You're all caught up!", {exact: true})).toBeVisible();
    } finally {
        await closeElectronApp(app);
        fs.rmSync(profile, {recursive: true, force: true});
    }
});
