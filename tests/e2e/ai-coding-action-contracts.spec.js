const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

test('explicit modes preserve their target, reply contract and Changes preference in the editor', async ({}, testInfo) => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        await app.evaluate(({ipcMain}) => {
            globalThis.__actionCalls = [];
            ipcMain.removeHandler('settings:ai_assistants:get');
            ipcMain.handle('settings:ai_assistants:get', () => [{id: 'contracts', name: 'Action fixture', provider: 'openai', model: 'fixture', purpose: 'coding', default: true, apiKey: 'fixture'}]);
            for (const action of ['explain', 'edit', 'fix', 'generate', 'plan']) {
                const channel = `ai-coding-agent:${action}-code`;
                ipcMain.removeHandler(channel);
                ipcMain.handle(channel, (event, payload) => {
                    globalThis.__actionCalls.push({action, ...payload});
                    const content = action === 'explain' ? 'The supplied module exports a constant named value.'
                        : action === 'edit' ? 'No changes proposed: the value already matches the requested behavior.'
                            : '```ts\nexport const value = 2;\n```\nAlternative:\n```ts\nexport const value = 3;\n```';
                    // Deliberately return without stream-done: the completed IPC
                    // result must render even when that event was lost.
                    return {success: true, requestId: payload.requestId, content};
                });
            }
        });
        const page = await openEditorWithMockedIPC(app, {__useRealAssistants: true});
        await page.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        await page.waitForFunction(() => window.__editorTestApi.getState().nodeModulesLoading === false);
        await page.evaluate(() => {
            window.__editorTestApi.createFile('/index.ts', 'export const value = 1;');
            window.__editorTestApi.setEditorPosition(1, 1);
        });
        await page.getByRole('tab', {name: 'AI Coding Agent', exact: true}).click();
        const action = page.locator('#action-select'), input = page.locator('#prompt-input');
        const submit = page.getByRole('button', {name: 'Submit', exact: true});
        await action.selectOption('explain');
        await expect(page.locator('#ai-change-mode')).toBeDisabled();
        await input.fill('Explain how to create /README.md. Focus on the supplied export.');
        await submit.click();
        await expect(page.getByText('Explanation Ready', {exact: true})).toBeVisible();
        await expect(page.getByTestId('ai-coding-response')).toContainText('exports a constant');
        await expect(page.getByRole('button', {name: 'Apply proposed changes'})).toHaveCount(0);
        await action.selectOption('edit');
        await expect(page.locator('#ai-change-mode')).toHaveValue('apply');
        await expect(page.getByTestId('ai-action-contract')).toContainText('Open file /index.ts');
        await input.fill('Keep the exported value equal to one.');
        await submit.click();
        await expect(page.getByText('No Changes Proposed', {exact: true})).toBeVisible();
        await action.selectOption('generate');
        await input.fill('Generate an exported value.');
        await submit.click();
        await expect(page.getByText('Clarify the Proposal', {exact: true})).toBeVisible();
        await expect(page.getByRole('button', {name: 'Apply proposed changes'})).toHaveCount(0);
        expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/index.ts'))).toBe('export const value = 1;');
        const calls = await app.evaluate(() => globalThis.__actionCalls);
        expect(calls.map(call => call.action)).toEqual(['explain', 'edit', 'generate']);
        expect(calls[0]).toMatchObject({targetFilePath: '/index.ts', code: 'export const value = 1;'});
        expect(calls[0].prompt).toContain('Focus on the supplied export');
        expect(calls[1]).toMatchObject({targetFilePath: '/index.ts', code: 'export const value = 1;'});
        await page.getByTestId('ai-action-contract').scrollIntoViewIfNeeded();
        await page.screenshot({path: testInfo.outputPath('action-contracts.png')});
    } finally {await closeElectronApp(app);}
});
