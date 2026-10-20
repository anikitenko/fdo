const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('./helpers/sdkExamples');
const esbuild = require('esbuild');
const bundled = esbuild.buildSync({entryPoints: ['src/components/editor/utils/virtualTemplates.js'], bundle: true, platform: 'node', format: 'cjs', write: false}).outputFiles[0].text;
const factory = {exports: {}};
new Function('module', 'exports', bundled)(factory, factory.exports);
const {createPluginTemplateFiles} = factory.exports;

// All generated files are real files; deployed code and UI use the installed SDK.
test('every starter renders styled UI and its actions work without an AI provider', async () => {
    test.setTimeout(180000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-templates-'));
    const names = [];
    try {
        const page = await app.firstWindow();
        for (const template of ['blank', 'utility', 'service', 'dashboard', 'dialogs', 'horDivided', 'verDivided', 'splitGrid']) {
            const pluginName = `template-${template.toLowerCase()}`;
            names.push(pluginName);
            const folder = path.join(root, template);
            fs.mkdirSync(folder);
            const files = createPluginTemplateFiles({name: pluginName, displayName: `Template ${template}`, template});
            for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, file.slice(1)), content);
            // Build through the IDE's real IPC/CSS pipeline, not plain esbuild.
            const build = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
            expect(build.success, build.error).toBe(true);
            const compiledContent = build.files.outputFiles.find(file => !file.path.endsWith('.map')).text;
            await deploySdkExample(page, {absPath: path.join(folder, 'index.ts'), relativePath: `templates/${template}`}, {pluginName, compiledContent});
            await selectPluginOpen(page, pluginName);
            const frame = page.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
            await expect(frame.getByRole('heading', {name: `Template ${template}`, exact: true})).toBeVisible();
            await expect.poll(() => frame.locator('main').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(16, 24, 32)');
            if (template === 'blank') {
                await frame.getByRole('button', {name: 'Refresh status'}).click();
                await expect(frame.locator('[data-role="status"]')).toContainText('is running');
            } else if (template === 'utility') {
                await frame.getByLabel('JSON input').fill('{"service":"api","count":2}');
                await frame.getByRole('button', {name: 'Inspect JSON'}).click();
                await expect(frame.getByRole('status')).toContainText('Top-level items: 2');
                await frame.getByLabel('JSON input').fill('{');
                await frame.getByRole('button', {name: 'Inspect JSON'}).click();
                await expect(frame.getByRole('status')).toContainText('Invalid JSON');
                await expect(frame.getByRole('status')).toHaveAttribute('data-state', 'error');
            } else if (template === 'service') {
                await frame.getByLabel('Environment').selectOption('production');
                await frame.getByRole('button', {name: 'Load services'}).click();
                await expect(frame.getByRole('status')).toContainText('Demo · production');
                await expect(frame.getByRole('status')).toContainText('API: Healthy');
            } else if (template === 'dialogs') {
                const open = frame.getByRole('button', {name: 'Configure workspace', exact: true});
                const modal = frame.getByRole('dialog', {name: 'Workspace settings', exact: true});
                await open.click();
                await expect(modal).toBeVisible();
                await expect(frame.getByLabel('Workspace label', {exact: true})).toBeFocused();
                await expect.poll(() => modal.evaluate(node => getComputedStyle(node, '::backdrop').backgroundColor)).toBe('rgba(3, 10, 22, 0.72)');
                await frame.getByLabel('Workspace label', {exact: true}).fill(' ');
                await modal.getByRole('button', {name: 'Save settings', exact: true}).click();
                try {
                    await expect(modal.getByRole('alert')).toContainText('Enter a workspace label');
                } catch (error) {
                    await test.info().attach('Dialog failure DOM', {body: await frame.locator('body').innerHTML(), contentType: 'text/html'});
                    throw error;
                }
                await expect(modal).toBeVisible();
                await frame.getByLabel('Workspace label', {exact: true}).fill('Production team');
                await frame.getByLabel('Environment', {exact: true}).selectOption('production');
                await frame.getByLabel('Workspace label', {exact: true}).press('Enter');
                await expect(modal).toBeHidden();
                await expect(frame.getByRole('heading', {name: 'Production team · production'})).toBeVisible();
                await expect(frame.getByRole('status')).toContainText('Settings saved');
                await expect(open).toBeFocused();
                await open.click();
                await expect(frame.getByLabel('Workspace label', {exact: true})).toHaveValue('Production team');
                await frame.getByLabel('Workspace label', {exact: true}).fill('Unsaved edit');
                await frame.getByLabel('Workspace label', {exact: true}).press('Escape');
                await expect(modal).toBeHidden();
                await expect(open).toBeFocused();
                await open.click();
                await expect(frame.getByLabel('Workspace label', {exact: true})).toHaveValue('Production team');
                const iframe = page.locator(`iframe[data-plugin-id="${pluginName}"]`);
                await iframe.evaluate(node => { node.style.maxWidth = '400px'; });
                await expect.poll(() => modal.locator('footer').evaluate(node => getComputedStyle(node).flexDirection)).toBe('column');
                expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
                await test.info().attach('Styled settings dialog', {body: await page.screenshot(), contentType: 'image/png'});
                await modal.getByRole('button', {name: 'Cancel', exact: true}).click();
                await expect(modal).toBeHidden();
                await iframe.evaluate(node => { node.style.maxWidth = ''; });
            } else {
                const showSidebar = page.getByRole('button', {name: 'Show right sidebar', exact: true});
                if (await showSidebar.count()) await showSidebar.click();
                await page.getByRole('button', {name: `Template ${template}`, exact: true}).click();
                await page.getByRole('menuitem', {name: 'Activity', exact: true}).click();
                await expect(frame.getByRole('heading', {name: 'Latest deployment'})).toBeVisible();
                if (template === 'splitGrid') {
                    const separator = frame.getByRole('separator', {name: 'Resize dashboard panels'});
                    const pluginFrame = page.locator(`iframe[data-plugin-id="${pluginName}"]`);
                    await pluginFrame.evaluate(node => { node.style.minWidth = '720px'; node.style.width = '720px'; });
                    await expect(separator).toBeVisible();
                    await separator.evaluate(node => {
                        node.focus();
                        node.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
                    });
                    await expect(separator).toHaveAttribute('aria-valuenow', '55');
                    const before = await frame.locator('#split-controls').boundingBox();
                    const divider = await separator.boundingBox();
                    await page.mouse.move(divider.x + divider.width / 2, divider.y + 40);
                    await page.mouse.down();
                    await page.mouse.move(divider.x + divider.width / 2 + 80, divider.y + 40, {steps: 10});
                    await page.mouse.up();
                    await expect.poll(async () => (await frame.locator('#split-controls').boundingBox()).width).toBeGreaterThan(before.width + 40);
                    const ratio = await separator.getAttribute('aria-valuenow');
                    await pluginFrame.evaluate(node => { node.style.minWidth = ''; node.style.width = ''; node.style.maxWidth = '480px'; });
                    await expect(separator).toBeHidden();
                    await expect(frame.locator('[data-role="split-hint"]')).toContainText('stacked');
                    const narrowControls = await frame.locator('#split-controls').boundingBox();
                    const narrowMetrics = await frame.locator('#split-metrics').boundingBox();
                    expect(narrowMetrics.y).toBeGreaterThanOrEqual(narrowControls.y + narrowControls.height);
                    await pluginFrame.evaluate(node => { node.style.maxWidth = ''; });
                    await expect(separator).toBeVisible();
                    await expect(separator).toHaveAttribute('aria-valuenow', ratio);
                    // A new SDK render reinitializes Split without losing its ratio.
                    await page.getByRole('button', {name: `Template ${template}`, exact: true}).click();
                    await page.getByRole('menuitem', {name: 'Overview', exact: true}).click();
                    await expect(frame.getByRole('heading', {name: 'Overview', exact: true})).toBeVisible();
                    await expect(separator).toHaveAttribute('aria-valuenow', ratio);
                    await separator.evaluate(node => {
                        node.focus();
                        node.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true, cancelable: true}));
                    });
                    await expect(separator).toHaveAttribute('aria-valuenow', '20');
                }

                if (template === 'dashboard') {
                    await page.getByPlaceholder('Search...', {exact: true}).click();
                    await page.getByPlaceholder('Search commands...').fill('Refresh dashboard');
                    await page.getByRole('menuitem', {name: 'Refresh dashboard', exact: true}).click();
                    await expect(frame.getByRole('heading', {name: 'Activity', exact: true})).toBeVisible();
                }
                await frame.getByRole('button', {name: 'Refresh dashboard'}).click();
                await expect(frame.getByRole('status')).toContainText('Demo dashboard refreshed');
            }
        }
        await test.info().attach('Styled starter workspace', {body: await page.screenshot(), contentType: 'image/png'});
    } finally {
        const page = await app.firstWindow();
        for (const name of names) await removePlugin(page, name);
        await closeElectronApp(app);
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('template cards open a real editor containing the selected workspace and guide', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const page = await app.firstWindow();
        // Command search opens the same creation dialog as the Plugins menu.
        await page.getByPlaceholder('Search...', {exact: true}).click();
        await page.getByPlaceholder('Search commands...').fill('Create Plugin');
        await page.getByRole('menuitem', {name: /^Create Plugin/}).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Name', {exact: true}).fill('../tools');
        await expect(dialog.getByRole('status')).toContainText('Start with a letter or number');
        await expect(dialog.getByRole('button', {name: 'Open editor · Blank', exact: true})).toBeDisabled();
        await page.evaluate(() => localStorage.setItem('sandbox_template-editor-e2e', 'existing-work'));
        await dialog.getByLabel('Name', {exact: true}).fill('Template Editor E2E');
        await expect(dialog.getByRole('status')).toContainText('A saved workspace already uses this ID');
        await expect(dialog.getByRole('button', {name: 'Resume saved workspace', exact: true})).toBeEnabled();
        await expect(dialog.getByRole('button', {name: 'Open editor · Blank', exact: true})).toBeDisabled();
        await page.evaluate(() => {
            localStorage.removeItem('sandbox_template-editor-e2e');
            window.dispatchEvent(new StorageEvent('storage', {key: 'sandbox_template-editor-e2e'}));
        });
        await expect(dialog.getByRole('status')).toContainText('Name is available');
        await expect(dialog.getByRole('status')).toContainText('Plugin ID: template-editor-e2e');
        await dialog.getByRole('button', {name: 'Resizable workspace template', exact: true}).click();
        const pickerPreview = test.info().outputPath('template-picker.png');
        await page.screenshot({path: pickerPreview});
        await test.info().attach('Plugin template picker', {path: pickerPreview, contentType: 'image/png'});
        const opened = app.waitForEvent('window');
        await dialog.getByRole('button', {name: 'Open editor · Resizable workspace', exact: true}).click();
        const editor = await opened;
        await editor.waitForFunction(() => window.__editorTestApi?.getState?.().workspaceTreeIds?.includes('/SKILL.md'));
        const state = await editor.evaluate(() => window.__editorTestApi.getState());
        expect(state.workspaceTreeIds).toEqual(expect.arrayContaining(['/index.ts', '/render.tsx', '/logic.ts', '/styles.css', '/split-layout.ts', '/starter.test.ts', '/SKILL.md', '/README.md', '/package.json']));
        await expect(editor.locator('body')).toContainText('starter.test.ts');
    } finally { await closeElectronApp(app); }
});
