const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

async function openWorkspace(app, name) {
    const opening = app.waitForEvent('window');
    await (await app.firstWindow()).evaluate(name => window.electron.system.openEditorWindow({name, template: 'utility'}), name);
    const editor = await opening;
    await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/render.tsx'));
    return editor;
}
async function openVisual(app, editor) {
    const opening = app.waitForEvent('window');
    await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
    const visual = await opening;
    await expect(visual.getByRole('heading', {name: /Live UI ·/})).toBeVisible();
    return visual;
}
async function editButton(visual, label) {
    await visual.getByRole('button', {name: 'button · Inspect JSON', exact: true}).click();
    await visual.getByLabel('Text', {exact: true}).fill(label);
    await visual.getByRole('button', {name: 'Preview change', exact: true}).click();
    await expect(visual.getByText('Draft and Undo/Redo history saved locally.', {exact: false})).toBeVisible();
    await expect(visual.frameLocator('iframe').getByRole('button', {name: label, exact: true})).toBeVisible();
}

test('unapplied visual changes survive a window close and app restart; restored Apply clears recovery', async () => {
    test.setTimeout(120000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-draft-restart-'));
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
        let editor = await openWorkspace(app, 'Durable Visual Draft');
        let visual = await openVisual(app, editor);
        const original = await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'));
        await editButton(visual, 'Recovered Inspect');
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toBe(original);
        await visual.close();
        visual = await openVisual(app, editor);
        await expect(visual.getByText('Saved visual draft found', {exact: true})).toBeVisible();
        await expect(visual.frameLocator('iframe').getByRole('button', {name: 'Inspect JSON', exact: true})).toBeVisible();
        const screenshot = test.info().outputPath('saved-visual-draft.png');
        await visual.screenshot({path: screenshot});
        await test.info().attach('Draft recovery prompt', {path: screenshot, contentType: 'image/png'});
        await visual.getByRole('button', {name: 'Restore visual draft', exact: true}).click();
        await expect(visual.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
        await visual.reload();
        await expect(visual.getByText('Saved visual draft found', {exact: true})).toBeVisible();
        await visual.getByRole('button', {name: 'Restore visual draft', exact: true}).click();
        await visual.getByRole('button', {name: 'Undo', exact: true}).click();
        await expect(visual.getByText('No unapplied changes', {exact: true})).toBeVisible();
        await visual.getByRole('button', {name: 'Redo', exact: true}).click();
        await expect(visual.frameLocator('iframe').getByRole('button', {name: 'Recovered Inspect', exact: true})).toBeVisible();
        await closeElectronApp(app); app = null;

        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
        editor = await openWorkspace(app, 'Durable Visual Draft');
        visual = await openVisual(app, editor);
        await expect(visual.getByText('Saved visual draft found', {exact: true})).toBeVisible();
        await visual.getByRole('button', {name: 'Restore visual draft', exact: true}).click();
        try {
            await expect(visual.frameLocator('iframe').getByRole('button', {name: 'Recovered Inspect', exact: true})).toBeVisible();
        } catch (error) {
            const frames = await Promise.all(visual.frames().map(async frame => ({url: frame.url(), body: await frame.locator('body').innerText().catch(() => 'unavailable')})));
            const source = await visual.locator('iframe').getAttribute('srcdoc');
            throw new Error(`${error.message}\nRestored frame diagnostics: ${JSON.stringify(frames)}; srcdoc contains restored button: ${source?.includes('Recovered Inspect')}`);
        }
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toBe(original);
        await visual.getByRole('button', {name: 'Apply to workspace', exact: true}).click();
        await expect(visual.getByRole('status')).toContainText('Applied. Restore point:');
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toContain('Recovered Inspect');
        await visual.close();
        visual = await openVisual(app, editor);
        await expect(visual.frameLocator('iframe').getByRole('button', {name: 'Recovered Inspect', exact: true})).toBeVisible();
        await expect(visual.getByText('Saved visual draft found', {exact: true})).toHaveCount(0);
    } finally {if (app) await closeElectronApp(app); fs.rmSync(profile, {recursive: true, force: true});}
});

test('changed IDE source blocks saved draft restore and explicit discard retains the current source', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const editor = await openWorkspace(app, 'Conflicting Visual Draft');
        let visual = await openVisual(app, editor);
        await editButton(visual, 'Unapplied button');
        await visual.close();
        await editor.evaluate(() => window.__editorTestApi.createFile('/render.tsx', window.__editorTestApi.getFileContent('/render.tsx') + '\n// IDE follow-up\n'));
        const source = await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'));
        visual = await openVisual(app, editor);
        await expect(visual.getByText('Saved draft needs attention', {exact: true})).toBeVisible();
        await expect(visual.getByRole('button', {name: 'Restore visual draft', exact: true})).toBeDisabled();
        await visual.getByRole('button', {name: 'Discard saved draft', exact: true}).click();
        await expect(visual.getByText('Saved draft needs attention', {exact: true})).toHaveCount(0);
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toBe(source);
        await expect(visual.getByRole('button', {name: 'button · Inspect JSON', exact: true})).toBeEnabled();
    } finally {await closeElectronApp(app);}
});
