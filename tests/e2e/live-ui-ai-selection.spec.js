const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Live UI hands committed source to AI without replacing the prompt or losing a visual draft', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const home = await app.firstWindow();
        // Configure a local fixture assistant. Any inference request fails the
        // test; the handoff only prepares context and never submits a prompt.
        await app.evaluate(() => {
            globalThis.__liveUiInferenceRequests = 0;
            globalThis.fetch = async url => {
                if (String(url).includes('/models/search')) return Response.json({success: true,
                    result: [{name: '@cf/test/selection', task: {name: 'Text Generation'}}]});
                if (String(url).includes('/models/schema')) return Response.json({success: true, result: {input: {properties: {}}}});
                globalThis.__liveUiInferenceRequests++;
                throw new Error('AI handoff must not submit an inference request.');
            };
        });
        await home.evaluate(() => window.electron.settings.ai.addAssistant({name: 'Selection fixture', provider: 'cloudflare', purpose: 'coding',
            model: '@cf/test/selection', accountId: 'a'.repeat(32), apiKey: 'test-only-token', defaultThinkingMode: 'off'}));
        const opening = app.waitForEvent('window');
        await home.evaluate(() => window.electron.system.openEditorWindow({name: 'AI selection utility', template: 'utility'}));
        const editor = await opening;
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/render.tsx'));
        await editor.getByRole('tab', {name: 'AI Coding Agent'}).click();
        const target = editor.getByRole('region', {name: 'Plugin target compatibility'});
        await expect(target.getByText(/Supported FDO:/)).toBeVisible();
        await target.getByText(/Supported FDO:/).click();
        await expect(target.getByText(/Installed FDO/)).toContainText('Host API 1.0.0');
        await target.getByText(/Supported FDO:/).click();
        await editor.locator('#prompt-input').fill('Make this label clearer while keeping the existing behavior.');
        await editor.locator('#action-select').selectOption('edit');
        const original = await editor.evaluate(() => ({source: window.__editorTestApi.getFileContent('/render.tsx'), version: window.__editorTestApi.getState().currentVersion}));
        const previewOpening = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        const visual = await previewOpening;
        await visual.getByRole('button', {name: 'button · Inspect JSON', exact: true}).click();
        await visual.getByRole('button', {name: 'Edit with AI', exact: true}).click();
        await expect(editor.getByRole('tab', {name: 'AI Coding Agent'})).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => editor.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/render.tsx');
        await expect(editor.getByText('Selection ready', {exact: true})).toBeVisible();
        await expect(editor.locator('#prompt-input')).toHaveValue('Make this label clearer while keeping the existing behavior.');
        await expect(editor.locator('#prompt-input')).toBeFocused();
        await expect(editor.locator('#action-select')).toHaveValue('edit');
        expect(await editor.evaluate(() => ({source: window.__editorTestApi.getFileContent('/render.tsx'), version: window.__editorTestApi.getState().currentVersion}))).toEqual(original);
        await visual.getByLabel('Text', {exact: true}).fill('Draft label for later');
        await visual.getByRole('button', {name: 'Preview change', exact: true}).click();
        await expect(visual.getByRole('button', {name: 'Edit with AI', exact: true})).toBeDisabled();
        await expect(visual.getByLabel('Source diff')).toContainText('Draft label for later');
        expect(await editor.evaluate(() => window.__editorTestApi.getFileContent('/render.tsx'))).toBe(original.source);
        expect(await app.evaluate(() => globalThis.__liveUiInferenceRequests)).toBe(0);
    } finally {await closeElectronApp(app);}
});
