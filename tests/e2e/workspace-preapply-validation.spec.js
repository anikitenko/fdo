const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

for (const outcome of ['success', 'stop', 'edit', 'failure']) {
    test(`workspace candidate validation: ${outcome}`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
        try {
            await app.evaluate(() => {
                globalThis.fetch = async url => {
                    if (String(url).includes('/models/search')) return Response.json({success: true,
                        result: [{name: '@cf/test/model', task: {name: 'Text Generation'}}]});
                    throw new Error(`Unexpected network request: ${url}`);
                };
            });
            const home = await app.firstWindow();
            await home.evaluate(async () => {
                await window.electron.settings.ai.addAssistant({name: 'Candidate validation', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/test/model', accountId: 'a'.repeat(32), apiKey: 'test-token'});
            });
            await app.evaluate(({ipcMain}) => {
                globalThis.__candidateCalls = 0;
                ipcMain.removeHandler('ai-coding-agent:plan-code');
                ipcMain.handle('ai-coding-agent:plan-code', async (_event, {requestId}) => {
                    globalThis.__candidateCalls++;
                    return {success: true, requestId, content: '### File: /logic.ts\n```typescript\nexport const value = 2;\n```'};
                });
                // Pause at the first compiler step so Stop and Edit act on a
                // pending validation before the real typechecker completes.
                const typecheck = ipcMain._invokeHandlers.get('plugin:plugin-typecheck');
                if (!typecheck) throw new Error('Real typecheck handler is unavailable');
                ipcMain.removeHandler('plugin:plugin-typecheck');
                ipcMain.handle('plugin:plugin-typecheck', async (event, candidate) => {
                    if (candidate.latestContent?.['/logic.ts']?.trim() === 'export const value = 2;' && !globalThis.__candidateReleased) {
                        await new Promise(resolve => { globalThis.__releaseCandidate = resolve; });
                    }
                    return typecheck(event, candidate);
                });
                const build = ipcMain._invokeHandlers.get('plugin:build');
                if (!build) throw new Error('Real compiler handler is unavailable');
                ipcMain.removeHandler('plugin:build');
                ipcMain.handle('plugin:build', async (event, candidate) => {
                    return globalThis.__rejectCandidate ? {success: false, error: 'controlled compiler rejection\n/logic.ts:1:1: controlled compiler rejection'} : build(event, candidate);
                });
            });
            const page = await openEditorWithMockedIPC(app, {__useRealAssistants: true, pluginDisplayName: 'Candidate validation', pluginDir: 'sandbox'});
            await page.waitForFunction(() => {
                const state = window.__editorTestApi?.getState();
                return state?.currentVersion && !state.nodeModulesLoading && state.workspaceTreeIds.includes('/index.ts');
            });
            await page.getByRole('tab', {name: 'AI Coding Agent'}).click();
            await expect(page.locator('#action-select')).toBeVisible();
            await page.evaluate(() => window.__editorTestApi.createFile('/logic.ts', 'export const value = 1;', 'typescript'));
            await page.getByLabel('Changes', {exact: true}).selectOption('apply');
            await page.locator('#prompt-input').fill('Update /logic.ts to export value = 2. Apply the complete workspace file.');
            await page.locator('#action-select').selectOption('plan');
            await page.getByRole('button', {name: 'Submit', exact: true}).click();
            await expect.poll(() => app.evaluate(() => globalThis.__candidateCalls), {timeout: 15000}).toBe(1);
            await expect.poll(async () => ({
                paused: await app.evaluate(() => typeof globalThis.__releaseCandidate === 'function'),
                editorError: await page.getByTestId('ai-coding-error').allTextContents(),
            }), {timeout: 30000}).toEqual({paused: true, editorError: []});
            expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/logic.ts'))).toBe('export const value = 1;');
            await expect(page.getByRole('button', {name: /Processing/})).toBeDisabled();
            if (outcome === 'stop') await page.getByRole('button', {name: 'Stop', exact: true}).click();
            if (outcome === 'edit') await page.evaluate(() => window.__editorTestApi.createFile('/logic.ts', 'export const value = 99;', 'typescript'));
            await app.evaluate((_electron, outcome) => {
                globalThis.__rejectCandidate = outcome === 'failure';
                globalThis.__candidateReleased = true;
                globalThis.__releaseCandidate();
                globalThis.__releaseCandidate = null;
            }, outcome);
            if (outcome !== 'success') {
                const message = outcome === 'failure' ? 'controlled compiler rejection' : outcome === 'stop' ? 'stopped' : 'Workspace changed';
                await expect(page.getByTestId('ai-coding-error')).toContainText(message, {timeout: 30000});
            }
            const expectedValue = outcome === 'success' ? 2 : outcome === 'edit' ? 99 : 1;
            await expect.poll(() => page.evaluate(() => window.__editorTestApi.getFileContent('/logic.ts').trim()),
                {timeout: 30000}).toBe(`export const value = ${expectedValue};`);
            expect(await app.evaluate(() => globalThis.__candidateCalls)).toBe(outcome === 'failure' ? 2 : 1);
        } finally { await closeElectronApp(app); }
    });
}
