const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

for (const sourceRepair of [false, true]) test(`candidate tests run through real IPC after source repair: ${sourceRepair}`, async () => {
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
        await home.evaluate(() => window.electron.settings.ai.addAssistant({name: 'Candidate tests', provider: 'cloudflare', purpose: 'coding',
            model: '@cf/test/model', accountId: 'a'.repeat(32), apiKey: 'test-token'}));
        await app.evaluate(({ipcMain}, sourceRepair) => {
            globalThis.__candidateTestRequests = [];
            globalThis.__candidateTestResults = [];
            ipcMain.removeHandler('ai-coding-agent:plan-code');
            ipcMain.handle('ai-coding-agent:plan-code', async (_event, request) => {
                globalThis.__candidateTestRequests.push(request);
                const value = globalThis.__candidateTestRequests.length;
                const section = (path, code) => `### File: ${path}\n\`\`\`typescript\n${code}\n\`\`\``;
                const testSource = 'import {test} from "node:test"; import assert from "node:assert/strict"; import {value} from "./logic"; test("required value", () => assert.equal(value(' + (sourceRepair && value === 1 ? '1' : '') + '), 2));';
                const testSection = section('/logic.test.ts', testSource);
                const content = sourceRepair && value === 2 ? testSection
                    : section('/logic.ts', `export const value = () => ${Math.max(1, value - Number(sourceRepair))};`) + '\n' + testSection;
                return {success: true, requestId: request.requestId, content};
            });
            const runner = ipcMain._invokeHandlers.get('plugin:run-tests');
            if (!runner) throw new Error('Real test runner unavailable');
            ipcMain.removeHandler('plugin:run-tests');
            ipcMain.handle('plugin:run-tests', async (event, candidate) => {
                const result = await runner(event, candidate);
                globalThis.__candidateTestResults.push(result);
                return result;
            });
        }, sourceRepair);
        const page = await openEditorWithMockedIPC(app, {__useRealAssistants: true});
        await page.getByRole('tab', {name: 'AI Coding Agent'}).click();
        await page.getByLabel('Changes', {exact: true}).selectOption('apply');
        await page.locator('#prompt-input').fill('Create /logic.ts exporting value = 2 and /logic.test.ts verifying the value.');
        await page.locator('#action-select').selectOption('plan');
        await page.getByRole('button', {name: 'Submit', exact: true}).click();
        await expect.poll(() => app.evaluate(() => globalThis.__candidateTestResults.length), {timeout: 60000}).toBe(2);
        await expect(page.getByRole('button', {name: /Processing/})).toHaveCount(0, {timeout: 30000});
        const state = await app.evaluate(() => ({requests: globalThis.__candidateTestRequests, results: globalThis.__candidateTestResults}));
        expect(state.requests).toHaveLength(sourceRepair ? 3 : 2);
        expect(state.requests.at(-1).repairPaths.sort()).toEqual(['/logic.test.ts', '/logic.ts']);
        expect(state.results.map(result => result.success)).toEqual([false, true]);
        await expect(page.getByRole('tab', {name: /^Test/})).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText('Candidate tests passed.', {exact: true})).toBeVisible();
        expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/logic.ts'))).toContain('value = () => 2');
        await expect(page.getByTestId('ai-coding-error')).toHaveCount(0);
    } finally { await closeElectronApp(app); }
});

test('packaged compiler rejects type errors and runner returns acceptance evidence over real IPC', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const page = await app.firstWindow();
        const invalid = await page.evaluate(() => window.electron.plugin.typecheck({latestContent: {
            '/logic.ts': 'export const value: number = "not a number";',
        }}));
        expect(invalid.success).toBe(false);
        expect(invalid.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({path: '/logic.ts', code: 2322})]));
        const evidence = await page.evaluate(() => window.electron.plugin.runTests({latestContent: {
            '/proof.test.ts': 'import {test} from "node:test"; import assert from "node:assert/strict"; test("acceptance proof", () => assert.equal(2 + 2, 4));',
        }}));
        expect(evidence.success, evidence.output).toBe(true);
        expect(evidence.results).toEqual(expect.arrayContaining([expect.objectContaining({file: '/proof.test.ts', name: 'acceptance proof', passed: true, skipped: false})]));
    } finally { await closeElectronApp(app); }
});
