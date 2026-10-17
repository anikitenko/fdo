const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

// Exercise a real signed plugin and its iframe, including state held inside its UI.
test('the right sidebar preserves plugin iframe geometry and state and has no duplicate notification bell', async ({}, testInfo) => {
    test.setTimeout(90000);
    let app;
    const id = 'gitops_ebc22207-edaf-49d1-9ff5-5dbac1384f29_cute-calculator';
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_MULTI_INSTANCE: '0'}});
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => (await window.electron.settings.certificates.getRoot())
            .some(certificate => certificate.label === 'root' && certificate.hasPrivateKey)), {timeout: 30000}).toBe(true);
        await page.evaluate(() => window.electron.notifications.savePreferences({successToasts: false, failureToasts: false, infoToasts: false}));
        const deployed = await page.evaluate(async id => window.electron.plugin.deployToMainFromEditor({
            name: id, sandbox: 'sidebar-layout-fixture', entrypoint: 'dist/index.cjs', rootCert: 'root',
            metadata: {name: 'Rose Calculator', version: '1.0.0', author: 'Fixture', description: 'Sidebar layout fixture', icon: 'calculator'},
            content: `const {FDO_SDK} = require('@anikitenko/fdo-sdk');
                class LayoutPlugin extends FDO_SDK {
                    get metadata() {return {name: 'Rose Calculator', version: '1.0.0', author: 'Fixture', description: 'Sidebar layout fixture', icon: 'calculator'};}
                    init() {}
                    render() {return '<label>Formula<input aria-label="Formula" /></label>';}
                }
                new LayoutPlugin();`,
        }), id);
        expect(deployed.success, deployed.error).toBe(true);
        await page.waitForFunction(id => window.__homeTestApi?.selectPluginById(id, {open: true}), id);
        const iframe = page.locator(`iframe[data-plugin-id="${id}"]`);
        const input = page.frameLocator(`iframe[data-plugin-id="${id}"]`).getByRole('textbox', {name: 'Formula'});
        await input.fill('2 + 2');
        const initial = await iframe.boundingBox();
        expect(initial.width).toBeGreaterThan(100);
        // Hiding the rail must leave no permanently reserved gutter.
        expect(initial.x + initial.width).toBe(await page.evaluate(() => window.innerWidth));
        await iframe.evaluate(node => {window.__layoutFrame = node;});
        for (let i = 0; i < 3; i++) {
            await page.getByRole('button', {name: 'Show right sidebar', exact: true}).click();
            await expect(page.locator('[data-plugin-sidebar-item="system-notifications"]')).toHaveCount(0);
            expect(await iframe.boundingBox()).toEqual(initial);
            const settings = page.locator('[data-plugin-sidebar-item="system-settings"]');
            await expect(settings).toBeVisible();
            // Verify the overlay is above the iframe and accepts pointer input.
            await settings.getByRole('button', {name: 'Settings', exact: true}).click({trial: true});
            await page.getByRole('button', {name: 'Hide right sidebar', exact: true}).click();
            expect(await iframe.boundingBox()).toEqual(initial);
            expect(await iframe.evaluate(node => window.__layoutFrame === node)).toBe(true);
            await expect(input).toHaveValue('2 + 2');
        }
        const notices = await page.evaluate(() => window.electron.notifications.get());
        expect(notices.some(notice => notice.title.endsWith(' is ready'))).toBe(false);
        await expect(page.getByRole('button', {name: /^Open notifications/})).toHaveCount(1);
        await page.evaluate(async () => {
            await window.electron.notifications.removeAll();
            for (let i = 0; i < 100; i++) {
                await window.electron.notifications.add(`Update ${i}`, 'Layout fixture', 'info', {source: 'system'});
            }
        });
        const bell = page.getByRole('button', {name: 'Open notifications (100 unread)', exact: true});
        await expect(bell).toBeVisible();
        await expect(bell.locator('[aria-hidden="true"]').filter({hasText: '99+'})).toBeVisible();
        expect((await bell.boundingBox()).width).toBe(36);
        await page.screenshot({path: testInfo.outputPath('compact-bell-full-width-workspace.png')});
    } finally {await closeElectronApp(app);}
});
