const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

test('OS activity reaches the main-window editor used by live AI tests', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const editor = await openEditorWithMockedIPC(app);
        await editor.getByRole('tab', {name: 'AI Coding Agent', exact: true}).click();
        await expect(editor.getByRole('heading', {name: 'No Coding Assistants Available', exact: true})).toBeVisible();
        const nativeTitle = () => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()
            .find(window => window.webContents.getURL().includes('#/editor'))?.getTitle());
        const before = await nativeTitle();
        // Capture the actual native tray without exposing a production test API.
        await app.evaluate(({Tray}) => {
            const original = Tray.prototype.setToolTip;
            Tray.prototype.setToolTip = function (...args) {
                global.__activityTray = this;
                return original.apply(this, args);
            };
            const originalMenu = Tray.prototype.setContextMenu;
            Tray.prototype.setContextMenu = function (menu) {
                global.__activityTrayMenu = menu;
                return originalMenu.call(this, menu);
            };
        });
        await editor.evaluate(() => window.electron.aiCodingAgent.setActivity(true));
        await expect.poll(nativeTitle).toBe(before + ' — AI working');
        await expect.poll(() => app.evaluate(() => Boolean(global.__activityTray && !global.__activityTray.isDestroyed()))).toBe(true);
        if (process.platform === 'darwin') {
            // Native menu-bar layout can settle after the Tray is created.
            await expect.poll(() => app.evaluate(() => {
                const bounds = global.__activityTray.getBounds();
                return bounds.width > 0 && bounds.height > 0;
            })).toBe(true);
        }
        await editor.getByRole('tab', {name: /^Problems/}).click();
        await app.evaluate(() => global.__activityTrayMenu.items.find(item => item.label === 'Open coding agent').click());
        await expect(editor.getByRole('tab', {name: /AI Coding Agent/})).toHaveAttribute('aria-selected', 'true');
        await expect(editor.getByRole('dialog', {name: 'AI Coding Agent status'})).toBeVisible();
        await editor.evaluate(() => window.electron.aiCodingAgent.setActivity(false));
        await expect.poll(nativeTitle).toBe(before);
        await expect.poll(() => app.evaluate(() => global.__activityTray.isDestroyed())).toBe(true);
    } finally {
        await closeElectronApp(app);
    }
});
