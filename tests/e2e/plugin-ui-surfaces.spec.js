const {test, expect, _electron: electron} = require('@playwright/test');
const path = require('node:path');
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require('./helpers/electronApp');
const {deploySdkExample} = require('./helpers/sdkExamples');

test('plugin quick, sidebar, and native tray actions invoke handlers; revocation and unload remove the tray', async () => {
    test.setTimeout(120000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const logs = [];
    app.process().stdout.on('data', data => logs.push(String(data)));
    app.process().stderr.on('data', data => logs.push(String(data)));
    try {
        const page = await app.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(() => localStorage.setItem('showRightSideBar', 'true'));
        await page.reload();
        await dismissBlueprintOverlays(page);
        await app.evaluate(({Tray}) => {
            const original = Tray.prototype.setContextMenu;
            Tray.prototype.setContextMenu = function(menu) {
                if (menu.items.some(item => item.label === 'Surface tray action')) {
                    global.__surfaceTray = this;
                    global.__surfaceMenu = menu;
                }
                return original.call(this, menu);
            };
        });
        await deploySdkExample(page, {absPath: path.resolve(__dirname, '../fixtures/plugin-ui-surfaces.ts'), relativePath: 'plugin-ui-surfaces.ts'},
            {pluginName: 'surface-fixture', capabilities: ['system.tray']});
        const invoke = handler => page.evaluate(handler => window.electron.plugin.uiMessage('surface-fixture', {handler, content: {}}), handler);
        const events = async () => JSON.stringify(await invoke('events'));
        await expect.poll(() => page.evaluate(() => window.__homeTestApi?.getSearchActionsSnapshot?.().map(action => action.name)), {timeout: 20000}).toContain('Surface quick action');
        // Real host command bar, not a synthetic handler call.
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
        await page.getByPlaceholder('Search commands...').fill('Surface quick action');
        await page.getByRole('menuitem', {name: /Surface quick action/}).click();
        await expect.poll(events).toContain('quick');
        await expect(page.frameLocator('iframe[data-plugin-id="surface-fixture"]').getByText('Last action: quick')).toBeVisible();
        await page.getByRole('button', {name: 'Surface sidebar', exact: true}).last().click();
        await page.getByText('Surface side action', {exact: true}).click();
        await expect.poll(events).toContain('side');
        await expect(page.frameLocator('iframe[data-plugin-id="surface-fixture"]').getByText('Last action: side')).toBeVisible();
        await page.reload();
        await expect.poll(() => page.evaluate(() => window.__homeTestApi?.getSearchActionsSnapshot?.().map(action => action.name)), {timeout: 20000}).toContain('Surface quick action');
        expect(await invoke('registerTray')).toMatchObject({ok: true});
        expect((await invoke('__sdk.getDiagnostics')).capabilities.permissions.granted).toContain('system.tray');
        await app.evaluate(() => global.__surfaceMenu.items.find(item => item.label === 'Surface tray action').click());
        await expect.poll(events).toContain('tray');
        await page.evaluate(() => window.electron.plugin.setCapabilities('surface-fixture', []));
        expect(await app.evaluate(() => global.__surfaceTray.isDestroyed())).toBe(true);
        expect(await invoke('registerTray')).toMatchObject({ok: false, code: 'CAPABILITY_DENIED'});
        await page.evaluate(() => window.electron.plugin.setCapabilities('surface-fixture', ['system.tray']));
        expect(await invoke('registerTray')).toMatchObject({ok: true});
        await page.evaluate(() => window.electron.plugin.deactivate('surface-fixture'));
        await expect.poll(() => app.evaluate(() => global.__surfaceTray.isDestroyed())).toBe(true);
        await page.evaluate(() => window.electron.plugin.activate('surface-fixture'));
        await expect.poll(async () => (await invoke('__sdk.getDiagnostics'))?.capabilities?.registeredHandlers, {timeout: 20000}).toContain('registerTray');
        expect(await invoke('registerTray')).toMatchObject({ok: true});
        await invoke('exitFixture');
        await expect.poll(() => app.evaluate(() => global.__surfaceTray.isDestroyed())).toBe(true);
    } catch (error) {
        const page = await app.firstWindow();
        console.log('Final fixture state', JSON.stringify(await page.evaluate(async () => ({
            status: await window.electron.plugin.getRuntimeStatus(['surface-fixture']),
            diagnostics: await window.electron.plugin.uiMessage('surface-fixture', {handler: '__sdk.getDiagnostics', content: {}}),
        }))));
        console.log(logs.join('').slice(-18000));
        throw error;
    } finally { await closeElectronApp(app); }
});
