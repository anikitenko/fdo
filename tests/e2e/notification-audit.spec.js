const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, clickOpenNotifications, dismissBlueprintOverlays} = require('./helpers/electronApp');

test('real plugin failures use display names, actionable saved notices, and recovery without startup noise', async ({}, testInfo) => {
    test.setTimeout(90000);
    let app;
    const id = 'gitops_ebc22207-edaf-49d1-9ff5-5dbac1384f29_cute-calculator';
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_MULTI_INSTANCE: '0'}});
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => (await window.electron.settings.certificates.getRoot()).some(item => item.label === 'root' && item.hasPrivateKey)), {timeout: 30000}).toBe(true);
        await page.evaluate(() => window.electron.notifications.savePreferences({successToasts: false, failureToasts: true, infoToasts: false}));
        const deployed = await page.evaluate(id => window.electron.plugin.deployToMainFromEditor({name: id, sandbox: 'audit', entrypoint: 'dist/index.cjs', rootCert: 'root',
            metadata: {name: 'Rose Calculator', author: 'Fixture', version: '1.0.0', description: 'Notifications fixture', icon: 'calculator'},
            content: `const {FDO_SDK} = require('@anikitenko/fdo-sdk');
                class Calculator extends FDO_SDK {
                    get metadata() {return {name: 'Rose Calculator', author: 'Fixture', version: '1.0.0', description: 'Notifications fixture', icon: 'calculator'};}
                    init() {} render() {return '<div>Calculator interface</div>';}
                } new Calculator();`}), id);
        expect(deployed.success).toBe(true);
        await expect.poll(() => page.evaluate(id => window.__homeTestApi?.getActivePluginIds().includes(id), id)).toBe(true);
        await page.evaluate(id => window.__homeTestApi.deselectPluginById(id), id);
        await expect.poll(async () => {
            const status = await page.evaluate(id => window.electron.plugin.getRuntimeStatus([id]), id);
            return !!(status.statuses?.[0]?.loaded || status.statuses?.[0]?.loading);
        }).toBe(false);
        const record = (await page.evaluate(id => window.electron.plugin.get(id), id)).plugin;
        const original = await app.evaluate((_electron, home) => {
            const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path');
            const filename = path.join(home, 'dist/index.cjs'), original = fs.readFileSync(filename, 'utf8');
            fs.appendFileSync(filename, '\n// changed after signing'); return original;
        }, record.home);
        const blocked = await page.evaluate(id => window.electron.plugin.activate(id), id);
        expect(blocked).toMatchObject({success: false, notified: true});
        const get = () => page.evaluate(() => window.electron.notifications.get());
        await expect.poll(async () => (await get()).some(item => item.title === 'Rose Calculator was blocked by signature verification')).toBe(true);
        const notices = await get();
        expect(notices.some(item => /Checking \.fdoignore|FDO Root Certificate| is ready$/.test(item.title))).toBe(false);
        expect(notices.find(item => item.title === 'Rose Calculator: deployment completed').message).toContain('signed and installed');
        const failure = notices.find(item => item.title === 'Rose Calculator was blocked by signature verification');
        expect(failure).toMatchObject({source: 'security', actions: [{kind: 'manage-plugin', pluginId: id}, {kind: 'open-plugin-logs', pluginId: id}]});
        expect(failure.message).toContain('not started'); expect(failure.details).toContain('Signature is invalid');
        await clickOpenNotifications(page);
        const row = page.locator(`[data-notification-id="${failure.id}"]`);
        await row.getByRole('button', {name: 'Manage plugin', exact: true}).click();
        await expect(page.getByRole('heading', {name: 'Manage Plugins', exact: true})).toBeVisible();
        await page.keyboard.press('Escape');
        await dismissBlueprintOverlays(page, {timeout: 5000});
        await app.evaluate((_electron, {home, original}) => {
            process.getBuiltinModule('node:fs').writeFileSync(process.getBuiltinModule('node:path').join(home, 'dist/index.cjs'), original);
        }, {home: record.home, original});
        expect((await page.evaluate(id => window.electron.plugin.activate(id), id)).success).toBe(true);
        await expect.poll(async () => (await get()).find(item => item.id === failure.id)?.status).toBe('resolved');
        await page.evaluate(id => window.__homeTestApi?.selectPluginById(id, {open: true}), id);
        const iframe = page.locator(`iframe[data-plugin-id="${id}"]`);
        await expect(iframe).toBeVisible();
        const frame = await (await iframe.elementHandle()).contentFrame();
        await expect(frame.getByText('Calculator interface', {exact: true})).toBeVisible();
        await frame.evaluate(() => window.parent.postMessage({type: 'PLUGIN_STAGE', stage: 'iframe-render-crashed', message: 'Notification audit UI crash'}, '*'));
        await expect.poll(async () => (await get()).some(item => item.title === 'Rose Calculator: interface could not open')).toBe(true);
        const uiFailure = (await get()).find(item => item.title === 'Rose Calculator: interface could not open');
        expect(uiFailure.details).toContain('Notification audit UI crash');
        expect((await get()).some(item => item.title.includes('gitops_'))).toBe(false);
        await clickOpenNotifications(page);
        await page.locator(`[data-notification-id="${uiFailure.id}"]`).getByRole('button', {name: 'Show details'}).click();
        await page.screenshot({path: testInfo.outputPath('actionable-plugin-notifications.png')});
        const certificateNotice = (await get()).find(item => item.title === 'Signing certificate “root” created');
        await page.locator(`[data-notification-id="${certificateNotice.id}"]`).getByRole('button', {name: 'Open settings', exact: true}).click();
        await expect(page.getByRole('heading', {name: 'Root certificates', exact: true})).toBeVisible();
    } finally {await closeElectronApp(app);}
});
