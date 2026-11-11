const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC, expectNoUnexpectedErrorToasts} = require('./helpers/electronApp');
let app, page;

test.beforeAll(async () => {
    app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    page = await openEditorWithMockedIPC(app);
    await page.waitForFunction(() => window.__editorTestApi?.getState().filesKeys.includes('/index.ts'));
}, 120000);
test.afterAll(async () => closeElectronApp(app), 60000);

const treeNode = name => page.locator('.bp6-tree-node-label').filter({hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)});
async function create(kind, name) {
    await page.getByRole('button', {name: kind, exact: true}).click();
    const input = page.getByPlaceholder('Name');
    await input.fill(name);
    await page.screenshot({animations: 'disabled', path: test.info().outputPath(`${kind.replace(/ /g, '-').toLowerCase()}.png`)});
    await input.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('project tools create directories, refactor paths, duplicate, delete, and navigate files', async () => {
    await expect(page.getByRole('button', {name:'Show dependencies and build output'})).toHaveCount(0);
    await expect(treeNode('node_modules')).toBeVisible();
    await create('New file', 'shared/website-check-ui.ts');
    await page.evaluate(() => {
        window.__editorTestApi.createFile('/shared/website-check-ui.ts', `import {theme} from '../theme'; export const ui = theme;`);
        window.__editorTestApi.createFile('/theme.ts', 'export const theme = 42;');
        window.__editorTestApi.createFile('/index.ts', `import {ui} from './shared/website-check-ui'; export const result = ui;`);
        window.__editorTestApi.openTabs([{id: '/shared/website-check-ui.ts', active: true}, {id: '/index.ts', active: false}]);
    });
    await treeNode('website-check-ui.ts').click();
    await create('New directory', 'empty');
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().workspaceTreeIds)).toContain('/shared/empty');
    await page.screenshot({animations: 'disabled', path: test.info().outputPath('before-move.png')});

    await treeNode('shared').click({button: 'right'});
    await expect(page.getByRole('menuitem', {name: 'Move…', exact: true})).toBeVisible();
    await page.screenshot({animations: 'disabled', path: test.info().outputPath('project-context-menu.png')});
    await page.getByRole('menuitem', {name: 'Move…', exact: true}).click();
    await page.getByPlaceholder('Location/New name').fill('/src/checks');
    await page.getByRole('button', {name: 'Move', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().filesKeys)).toContain('/src/checks/website-check-ui.ts');
    expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/index.ts'))).toContain("from './src/checks/website-check-ui'");
    expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/src/checks/website-check-ui.ts'))).toContain("from '../../theme'");
    expect((await page.evaluate(() => window.__editorTestApi.getState())).workspaceTreeIds).toContain('/src/checks/empty');

    await page.keyboard.press('ControlOrMeta+p');
    await page.getByRole('textbox', {name: 'Search project files'}).fill('website-check');
    await page.getByRole('textbox', {name: 'Search project files'}).press('Enter');
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/src/checks/website-check-ui.ts');

    await page.getByRole('button', {name: 'Rename selected'}).click();
    await expect(page.getByPlaceholder('Location/New name')).toHaveValue('website-check-ui.ts');
    await page.getByPlaceholder('Location/New name').fill('/index.ts');
    await page.getByRole('button', {name: 'Rename file', exact: true}).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already exists');
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();

    await page.getByRole('button', {name: 'Rename selected'}).click();
    await page.getByPlaceholder('Location/New name').fill('check-ui.ts');
    await page.getByRole('button', {name: 'Rename file', exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/src/checks/check-ui.ts');
    expect(await page.evaluate(() => window.__editorTestApi.getFileContent('/index.ts'))).toContain("from './src/checks/check-ui'");

    await treeNode('check-ui.ts').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Duplicate…', exact: true}).click();
    await page.getByPlaceholder('Location/New name').fill('copy.ts');
    await page.getByRole('button', {name: 'Duplicate', exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().filesKeys)).toContain('/src/checks/copy.ts');
    await treeNode('copy.ts').click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Delete…', exact: true}).click();
    await page.getByRole('button', {name: 'Delete file', exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().filesKeys)).not.toContain('/src/checks/copy.ts');
    expect((await page.evaluate(() => window.__editorTestApi.getState())).filesKeys).toContain('/src/checks/check-ui.ts');

    const snapshot = await page.evaluate(() => window.__editorTestApi.createSnapshot());
    await page.evaluate(async version => {await window.__editorTestApi.switchSnapshot(version);}, snapshot.version);
    expect((await page.evaluate(() => window.__editorTestApi.getState())).workspaceTreeIds).toContain('/src/checks/empty');
    await page.getByRole('button', {name: 'Compile', exact: true}).click();
    await expect(page.getByRole('region', {name: 'Plugin test output'}).getByText('Compilation successful!', {exact: true})).toBeVisible({timeout: 15000});
    await expect(page.getByRole('button', {name: 'Select opened file', exact: true})).toHaveCount(0);
    await page.getByRole('button',{name:'Find in files',exact:true}).click();
    await page.getByLabel('Find text in files').fill('export const ui = theme');
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 matches');
    await page.getByRole('dialog').getByRole('menuitem').filter({hasText:'export const ui = theme'}).click();
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/src/checks/check-ui.ts');
    await expect.poll(() => page.evaluate(() => {
        const location = window.__editorTestApi.getEditorLocation();
        const source = window.__editorTestApi.getFileContent('/src/checks/check-ui.ts');
        return {uri:location.uri,line:location.selection?.startLineNumber,column:location.selection?.startColumn,expectedColumn:source.indexOf('export const ui = theme')+1};
    })).toMatchObject({uri:'file:///src/checks/check-ui.ts',line:1,column:expect.any(Number)});
    await page.waitForFunction(() => {
        const location = window.__editorTestApi.getEditorLocation();
        const source = window.__editorTestApi.getFileContent('/src/checks/check-ui.ts');
        return location.selection?.startColumn === source.indexOf('export const ui = theme')+1;
    });
    await page.evaluate(() => window.__editorTestApi.openTabs([{id: '/index.ts', active: true}]));
    const editor = page.locator('.monaco-editor').first();
    await editor.click({button: 'right', position: {x: 120, y: 80}});
    await expect(page.getByRole('menuitem', {name: 'New file', exact: true})).toBeVisible();
    await page.getByRole('menuitem', {name: /Command Palette/}).click();
    await expect(page.locator('.quick-input-widget')).toBeVisible();
    await page.keyboard.press('Escape');

    await editor.click({button: 'right', position: {x: 120, y: 80}});
    await expect(page.getByRole('menuitem', {name: 'New file', exact: true})).toBeVisible();
    await page.getByRole('menuitem', {name: 'New file', exact: true}).click();
    await page.getByPlaceholder('Name').fill('right-click.ts');
    await page.getByPlaceholder('Name').press('Enter');
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().filesKeys)).toContain('/right-click.ts');
    await editor.click({button: 'right', position: {x: 120, y: 80}});
    await expect(page.getByRole('menuitem', {name: /New folder/})).toBeVisible();
    await page.getByRole('menuitem', {name: /New folder/}).click();
    await page.getByPlaceholder('Name').fill('right-click-dir');
    await page.getByPlaceholder('Name').press('Enter');
    await expect.poll(() => page.evaluate(() => window.__editorTestApi.getState().workspaceTreeIds)).toContain('/right-click-dir');
    await expectNoUnexpectedErrorToasts(page);
    await page.screenshot({animations: 'disabled', path: test.info().outputPath('project-tools.png')});
});
