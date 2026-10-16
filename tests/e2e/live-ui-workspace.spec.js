const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('Live UI previews current IDE source and CSS, refreshes edits, reports unsupported code and reconnects', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const home = await app.firstWindow();
        const opening = app.waitForEvent('window');
        await home.evaluate(() => window.electron.system.openEditorWindow({name: 'Live Preview Utility', template: 'utility'}));
        const editor = await opening;
        await editor.addInitScript(() => {window.__E2E__ = true; window.__TEST__ = true;});
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/styles.css'));
        const previewOpening = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        const visual = await previewOpening;
        await expect(visual.getByRole('heading', {name: /Live UI ·/})).toBeVisible();
        await visual.getByText('SDK catalog', {exact: true}).click();
        await expect(visual.getByRole('complementary', {name: 'UI structure', exact: true})).toContainText('Installed SDK');
        const frame = visual.frameLocator('iframe[title="Plugin UI preview"]');
        await expect(frame.locator('h1')).toHaveText('Live Preview Utility');
        await expect(frame.locator('main')).toHaveCSS('background-color', 'rgb(16, 24, 32)');
        const before = await editor.evaluate(() => ({render: window.__editorTestApi.getFileContent('/render.tsx'), css: window.__editorTestApi.getFileContent('/styles.css')}));
        await editor.evaluate(({render, css}) => {
            window.__editorTestApi.createFile('/render.tsx', render.replace('Paste a config or API response. Inspection stays local.', 'Updated from the IDE.'));
            window.__editorTestApi.createFile('/styles.css', css.replace('background: #101820;', 'background: #132c45;'), 'css');
        }, before);
        await expect(frame.locator('body')).toContainText('Updated from the IDE.');
        await expect(frame.locator('main')).toHaveCSS('background-color', 'rgb(19, 44, 69)');
        await expect(visual.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
        await expect(visual.getByLabel('Preview width')).toHaveCount(0);
        await expect(visual.getByText('Legacy graph', {exact: true})).toHaveCount(0);
        await visual.getByLabel('Search SDK catalog').fill('createElement');
        await visual.getByText('DOM', {exact: true}).click();
        await expect(visual.getByText('Create element', {exact: true})).toBeVisible();
        await visual.getByRole('button', {name: 'Show IDE', exact: true}).click();
        await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('#/editor'))).toBe(true);
        const source = await editor.evaluate(() => window.__editorTestApi.getFileContent('/index.ts'));
        await editor.evaluate(source => window.__editorTestApi.createFile('/index.ts', source.replace('return Render(', 'return fetch(')), source);
        await expect(visual.getByText('This render path needs a preview adapter', {exact: true})).toBeVisible();
        await expect(visual.getByText(/Dynamic value 'fetch'/)).toBeVisible();
        await editor.evaluate(source => window.__editorTestApi.createFile('/index.ts', source), source);
        await expect(frame.locator('h1')).toHaveText('Live Preview Utility');
        const previewPath = test.info().outputPath('live-ui-workspace.png');
        await visual.screenshot({path: previewPath});
        await test.info().attach('Connected Live UI preview', {path: previewPath, contentType: 'image/png'});
        // A reload invalidates the owner connection until it explicitly opens again.
        const reloaded = editor.waitForEvent('domcontentloaded');
        // Force this test's reload past the unrelated unsaved-work confirmation.
        await app.evaluate(({BrowserWindow}) => {
            const owner = BrowserWindow.getAllWindows().find(window => window.__fdoEditorWindow);
            owner.webContents.once('will-prevent-unload', event => event.preventDefault());
            owner.reload();
        });
        await reloaded;
        await expect(visual.getByText('IDE disconnected', {exact: true})).toBeVisible();
        await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/index.ts'));
        await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        await expect(visual.getByText('IDE disconnected', {exact: true})).toHaveCount(0);
        await expect(frame.locator('body')).toContainText('Paste a config or API response. Inspection stays local.');
    } finally { await closeElectronApp(app); }
});

test('simultaneous IDE workspaces keep separate Live UI sessions and reject foreign readers', async () => {
    test.setTimeout(90000);
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        const home = await app.firstWindow();
        const windows = [];
        for (const name of ['Workspace Alpha', 'Workspace Beta']) {
            const opening = app.waitForEvent('window');
            await home.evaluate(name => window.electron.system.openEditorWindow({name, template: 'blank'}), name);
            const editor = await opening;
            await editor.waitForFunction(() => window.__editorTestApi?.getState().workspaceTreeIds.includes('/render.tsx'));
            const previewOpening = app.waitForEvent('window');
            await editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
            const visual = await previewOpening;
            await expect(visual.frameLocator('iframe[title="Plugin UI preview"]').locator('h1')).toHaveText(name);
            windows.push({editor, visual, name});
        }
        const session = new URLSearchParams(new URL(windows[1].visual.url()).hash.split('?')[1]).get('session');
        const denied = await windows[0].editor.evaluate(async session => {
            try { await window.electron.liveUi.read(session); return ''; }
            catch (error) { return error.message; }
        }, session);
        expect(denied).toContain('does not belong');
        // The older IDE can still focus/reuse its own window after a newer IDE opens.
        await windows[0].editor.getByRole('button', {name: 'Live UI editor', exact: true}).click();
        for (const {visual, name} of windows) await expect(visual.frameLocator('iframe[title="Plugin UI preview"]').locator('h1')).toHaveText(name);
        expect(app.windows()).toHaveLength(5);
    } finally { await closeElectronApp(app); }
});
