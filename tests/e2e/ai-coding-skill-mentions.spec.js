const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

test('skill completions require explicit selection and preserve dollar variables in the native editor', async ({}, testInfo) => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_LIVE_AI: '0'}});
    try {
        await app.evaluate(({ipcMain}) => {
            ipcMain.removeHandler('settings:ai_assistants:get');
            ipcMain.handle('settings:ai_assistants:get', () => [{id: 'codex-test', name: 'Codex test', provider: 'codex-cli', model: 'test-model', purpose: 'coding', default: true,
                inputCapabilities: {provider: 'codex-cli', model: 'test-model', imageSupport: 'unsupported', source: 'integration', reason: 'Text only'}}]);
            ipcMain.removeHandler('settings:ai_assistants:get-ai-extensions');
            ipcMain.handle('settings:ai_assistants:get-ai-extensions', () => ({skills: [
                {name: 'fdo-skill-smoke-test', description: 'Keep $HOME literal.', enabled: true, assistantIds: ['codex-test']},
                {name: 'team-other', description: 'Other assistant', enabled: true, assistantIds: ['other']},
            ], assistants: []}));
        });
        const page = await openEditorWithMockedIPC(app, {__useRealAssistants: true});
        await page.getByRole('tab', {name: 'AI Coding Agent'}).click();
        const input = page.locator('#prompt-input');
        await expect(input).toBeVisible();
        await input.fill('Keep $HOME and ${NAME}; use $fd');
        const menu = page.getByRole('listbox', {name: 'Codex skill suggestions'});
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('option', {name: '$fdo-skill-smoke-test'})).toBeVisible();
        await expect(menu.getByText('Keep $HOME literal.')).toBeVisible();
        await expect(menu.getByRole('option', {name: '$team-other'})).toHaveCount(0);
        const suggestion = menu.getByRole('option', {name: '$fdo-skill-smoke-test'});
        const title = suggestion.locator('.bp6-fill');
        expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const menuBox = await menu.boundingBox();
        const changesBox = await page.getByText('Changes', {exact: true}).boundingBox();
        expect(changesBox.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height);
        await page.getByText('Changes', {exact: true}).scrollIntoViewIfNeeded();
        await menu.screenshot({path: testInfo.outputPath('skill-suggestions.png')});
        await input.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(input).toHaveValue('Keep $HOME and ${NAME}; use $fd');
        await input.fill('Keep $HOME and ${NAME}; use $fd');
        await input.press('End');
        await input.press('Enter');
        await expect(input).toHaveValue('Keep $HOME and ${NAME}; use $fd\n');
        await expect(menu).toHaveCount(0);
        await input.fill('Keep $HOME and ${NAME}; use $fdo');
        await expect(menu).toBeVisible();
        await input.press('Tab');
        await expect(input).toHaveValue('Keep $HOME and ${NAME}; use $fdo-skill-smoke-test ');
        await expect(menu).toHaveCount(0);
        await input.fill('Follow up: preserve $someVariable and `$fdo-skill-smoke-test`');
        await expect(menu).toHaveCount(0);
    } finally {await closeElectronApp(app);}
});
