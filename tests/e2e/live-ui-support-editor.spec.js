const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('support fields use host defaults and reviewed policy edits can pause and restore visual editing', async () => {
    test.setTimeout(120000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const home = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await home.evaluate(() => window.electron.system.openEditorWindow({name: 'Support policy utility', template: 'utility'}));
        const editor = await opening;
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/package.json'));
        const original = await editor.evaluate(() => {
            const pkg = JSON.parse(window.__editorTestApi.getFileContent('/package.json'));
            delete pkg.fdo.compatibility;
            pkg.scripts = {example: 'preserve-this'};
            window.__editorTestApi.createFile('/package.json', JSON.stringify(pkg, null, 2));
            return {package: window.__editorTestApi.getFileContent('/package.json'), render: window.__editorTestApi.getFileContent('/render.tsx')};
        });
        const previewOpening = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        const visual = await previewOpening;
        const context = visual.getByRole('region', {name: 'Plugin target compatibility'});
        await context.getByText(/Build target FDO:/).click();
        const host = await visual.evaluate(async () => {
            const session = new URLSearchParams(location.hash.split('?')[1]).get('session');
            return (await window.electron.liveUi.read(session)).authoringContract;
        });
        await context.getByRole('button', {name: 'Add missing support fields'}).click();
        const review = visual.getByRole('region', {name: 'Draft changes'});
        await expect(review).toContainText('Only the support declaration will change');
        await expect(context.getByRole('button', {name: 'Add missing support fields'})).toHaveCount(0);
        await context.getByRole('button', {name: 'Adjust supported versions'}).click();
        await expect(visual.getByRole('dialog').getByRole('button', {name: 'Preview support changes'})).toBeDisabled();
        await visual.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/package.json'))).toBe(original.package);
        await review.getByRole('button', {name: 'Undo', exact: true}).click();
        await expect(review).toContainText('No unapplied changes');
        await review.getByRole('button', {name: 'Redo', exact: true}).click();
        await expect(review.getByRole('button', {name: 'Apply to workspace'})).toBeDisabled();
        await review.getByText(/I have reviewed these support claims/).click();
        await review.getByRole('button', {name: 'Apply to workspace'}).click();
        await expect(visual.getByRole('status')).toContainText('Support declaration applied');
        const added = await editor.evaluate(() => JSON.parse(window.__editorTestApi.getFileContent('/package.json')));
        expect(added.fdo.compatibility).toEqual(host.defaultRequirements);
        expect(added.scripts).toEqual({example: 'preserve-this'});

        await context.getByRole('button', {name: 'Adjust supported versions'}).click();
        const dialog = visual.getByRole('dialog', {name: 'Adjust plugin support'});
        await expect(dialog.getByLabel('Supported SDK range')).toHaveValue(host.defaultRequirements.sdk);
        await expect(dialog.getByLabel('Supported host API range')).toHaveValue(host.defaultRequirements.api);
        await dialog.getByLabel('Supported FDO range').fill('latest');
        await expect(dialog.getByRole('button', {name: 'Preview support changes'})).toBeDisabled();
        await dialog.getByLabel('Supported FDO range').fill('>=99.0.0');
        await visual.screenshot({path: '/tmp/fdo-support-editor-form.png', animations: 'disabled'});
        await dialog.getByRole('button', {name: 'Preview support changes'}).click();
        await expect(dialog).toBeHidden();
        await expect(review).toContainText('this host cannot build or run');
        await review.getByText(/I have reviewed these support claims/).click();
        await review.getByRole('button', {name: 'Apply to workspace'}).click();
        await expect(context.getByText('Plugin target needs attention')).toBeVisible();
        expect(await editor.evaluate(() => JSON.parse(window.__editorTestApi.getFileContent('/package.json')).fdo.compatibility.fdo)).toBe('>=99.0.0');
        const frame = visual.frameLocator('iframe[title="Plugin UI preview"]');
        await expect(frame.locator('h1')).toHaveText('Support policy utility');
        await visual.getByRole('button', {name: 'button · Inspect JSON', exact: true}).click();
        await expect(visual.getByRole('button', {name: 'Preview change', exact: true})).toBeDisabled();

        await context.getByRole('button', {name: 'Adjust supported versions'}).click();
        await dialog.getByRole('button', {name: 'Use current host defaults'}).click();
        await expect(dialog.getByLabel('Supported FDO range')).toHaveValue(host.defaultRequirements.fdo);
        await dialog.getByRole('button', {name: 'Preview support changes'}).click();
        await review.getByText(/I have reviewed these support claims/).click();
        await review.getByRole('button', {name: 'Apply to workspace'}).click();
        await expect(context.getByText('Plugin target needs attention')).toBeHidden();
        await expect(dialog).toHaveCount(0);
        await expect(frame.locator('h1')).toHaveText('Support policy utility');
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toBe(original.render);
        await visual.screenshot({path: '/tmp/fdo-support-editor-applied.png', animations: 'disabled'});
    } finally {await closeElectronApp(app);}
});
