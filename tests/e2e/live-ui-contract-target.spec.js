const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Live UI exposes the host target and retains read-only diagnosis for an incompatible plugin', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const home = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await home.evaluate(() => window.electron.system.openEditorWindow({name: 'Contract utility', template: 'utility'}));
        const editor = await opening;
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/package.json'));
        const previewOpening = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        const visual = await previewOpening;
        const context = visual.getByRole('region', {name: 'Plugin target compatibility'});
        await expect(context.getByText(/Supported FDO:/)).toBeVisible();
        await context.getByText(/Supported FDO:/).click();
        await expect(context.getByText(/Installed FDO/)).toContainText('Host API 1.0.0');
        await expect(context.getByText(/Handshake/)).toContainText('Capability schema 1.0.0');
        await context.getByText(/Supported FDO:/).click();
        await editor.evaluate(() => {
            const pkg = JSON.parse(window.__editorTestApi.getFileContent('/package.json'));
            pkg.fdo.compatibility.fdo = '>=99.0.0';
            window.__editorTestApi.createFile('/package.json', JSON.stringify(pkg, null, 2));
        });
        await expect(context.getByText('Plugin target needs attention')).toBeVisible();
        const frame = visual.frameLocator('iframe[title="Plugin UI preview"]');
        await expect(frame.locator('h1')).toHaveText('Contract utility');
        await visual.getByRole('button', {name: 'button · Inspect JSON', exact: true}).click();
        await expect(visual.getByRole('button', {name: 'Preview change', exact: true})).toBeDisabled();
        await expect(visual.getByRole('button', {name: 'Show in code', exact: true})).toBeEnabled();
        await expect(visual.getByRole('button', {name: 'Edit with AI', exact: true})).toBeEnabled();
        const result = await visual.evaluate(async () => {
            const session = new URLSearchParams(location.hash.split('?')[1]).get('session');
            const state = await window.electron.liveUi.read(session);
            return window.electron.liveUi.propose(session, {revision: state.revision, kind: 'text'});
        });
        expect(result.status).toBe('incompatible');
        expect(result.message).toContain('Requires FDO');
        await visual.screenshot({path: '/tmp/fdo-live-ui-contracts.png'});
        expect(await editor.evaluate(() => JSON.parse(window.__editorTestApi.getFileContent('/package.json')).fdo.compatibility.fdo)).toBe('>=99.0.0');
    } finally {await closeElectronApp(app);}
});
