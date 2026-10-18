const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {ensureRootCertificate} = require('./helpers/sdkExamples');

test('folder import builds sources, preserves signed bundles and releases only recoverable draft IDs', async () => {
    test.setTimeout(120000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-folder-e2e-'));
    let app;
    try {
        const source = `const {FDO_SDK, createProcessExecActionRequest} = require('@anikitenko/fdo-sdk');
class FolderFixture extends FDO_SDK {
    get metadata() {return {name:'Folder Fixture',version:'1.0.0',author:'FDO',description:'Folder import fixture',icon:'folder-open'};}
    declareCapabilities() {return ['system.process.exec','system.process.scope.git'];}
    inspect() {return createProcessExecActionRequest({scope:'git',command:'/usr/bin/git',args:['status']});}
    init() {} render() {return '<p>Imported source</p>';}
}
new FolderFixture();`;
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({name:'folder-fixture',version:'1.0.0',source:'index.ts',main:'dist/index.cjs',scripts:{install:'exit 99'}}));
        await fs.writeFile(path.join(root, 'index.ts'), source);
        await fs.writeFile(path.join(root, 'logic.ts'), `const {createProcessExecActionRequest} = require('@anikitenko/fdo-sdk');
export function inspect() {return createProcessExecActionRequest({scope:'git',command:'/usr/bin/git',args:['status']});}`);
        const asset = Buffer.from([137,80,78,71,0,255]);
        await fs.writeFile(path.join(root, 'asset.png'), asset);
        app = await launchElectronApp(electron, {isolatedUserDataDir:true});
        const page = await app.firstWindow();
        await page.waitForFunction(() => !!window.electron?.plugin?.inspectFolder);
        await ensureRootCertificate(page);
        // The normal creation UI exposes recovery only for an undeployed draft.
        await page.evaluate(() => localStorage.setItem('sandbox_recoverable-tools', 'opaque original work'));
        await page.getByPlaceholder('Search...', {exact:true}).click();
        await page.getByPlaceholder('Search commands...').fill('Create Plugin');
        await page.getByRole('menuitem', {name:/^Create Plugin/}).click();
        await page.getByLabel('Name', {exact:true}).fill('Recoverable Tools');
        const release = page.getByRole('button', {name:'Safe release ID'});
        await expect(release).toBeEnabled(); await release.click();
        await expect(page.getByText('ID released. Your draft is archived below and can be restored.')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('sandbox_recoverable-tools'))).toBeNull();
        await page.getByText('Archived drafts (1)').click();
        await page.getByRole('button', {name:/Restore draft/}).click();
        await expect(page.getByText('Draft restored. Resume it to continue editing.')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('sandbox_recoverable-tools'))).toBe('opaque original work');
        await app.evaluate(({dialog}, directory) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[directory]});}, root);
        await page.getByRole('button', {name:'Select folder'}).click();
        await expect(page.getByText('Source project', {exact:true})).toBeVisible();
        await expect(page.getByRole('button', {name:'Build and install plugin'})).toBeEnabled();
        await page.screenshot({path:'/tmp/fdo-folder-import-preview.png'});
        await page.getByRole('button', {name:'Build and install plugin'}).click();
        await expect(page.getByRole('dialog', {name:'Create Plugin'})).toBeHidden();
        const installed = await page.evaluate(async () => (await window.electron.plugin.getAll()).plugins.find(plugin => plugin.id === 'folder-fixture'));
        expect(installed.capabilities).toEqual([]);
        expect(await fs.readFile(path.join(installed.home, 'index.ts'), 'utf8')).toBe(source);
        expect(await fs.readFile(path.join(installed.home, 'asset.png'))).toEqual(asset);
        expect(await fs.readFile(path.join(installed.home, installed.entry), 'utf8')).toContain('FolderFixture');
        const signature = await fs.readFile(path.join(installed.home, 'fdo.signature'));
        const exported = Buffer.from(await page.evaluate(async () => Array.from(await window.electron.plugin.export('folder-fixture'))));
        expect(exported.includes(Buffer.from('dist/index.cjs'))).toBe(true);
        expect(exported.includes(Buffer.from('fdo.signature'))).toBe(true);
        // Import the compiled export with its original source and exact signature.
        const copied = await page.evaluate(async home => {
            const preview = await window.electron.plugin.inspectFolder(home);
            const mismatch = await window.electron.plugin.installFolder({token:'forged',id:'forged',mode:'bundle'});
            return {preview, mismatch, result:await window.electron.plugin.installFolder({token:preview.token,id:'folder-copy',mode:'bundle'})};
        }, installed.home);
        expect(copied.preview.hasSource).toBe(true); expect(copied.preview.hasCompiled).toBe(true);
        expect(copied.mismatch.success).toBe(false); expect(copied.result.success).toBe(true);
        const copy = await page.evaluate(async () => (await window.electron.plugin.getAll()).plugins.find(plugin => plugin.id === 'folder-copy'));
        expect(await fs.readFile(path.join(copy.home, 'fdo.signature'))).toEqual(signature);
        expect(await fs.readFile(path.join(copy.home, 'asset.png'))).toEqual(asset);
        const blocked = await page.evaluate(() => window.electron.plugin.checkDraftRelease('folder-copy'));
        expect(blocked.success).toBe(false);
        // Invalid signatures fail closed, without registering a half-imported plugin.
        await fs.appendFile(path.join(copy.home, copy.entry), '\n// tampered runtime\n');
        const rejected = await page.evaluate(async home => {
            const preview = await window.electron.plugin.inspectFolder(home);
            return window.electron.plugin.installFolder({token:preview.token,id:'invalid-copy',mode:'bundle'});
        }, copy.home);
        expect(rejected.success).toBe(false); expect(rejected.error).toContain('signature verification failed');
        expect(await page.evaluate(async () => (await window.electron.plugin.getAll()).plugins.some(plugin => plugin.id === 'invalid-copy'))).toBe(false);
        const opened = app.waitForEvent('window');
        await page.evaluate(() => window.electron.system.openEditorWindow({name:'folder-fixture'}));
        const editor = await opened;
        await editor.waitForFunction(() => !!window.__editorTestApi?.getModelMarkers);
        const missingInBothFiles = () => editor.evaluate(() => ['/index.ts','/logic.ts'].map(file =>
            window.__editorTestApi.getModelMarkers(file).some(marker => String(marker.code).startsWith('FDO_MISSING_'))));
        await expect.poll(missingInBothFiles).toEqual([true,true]);
        expect((await page.evaluate(() => window.electron.plugin.setCapabilities('folder-fixture',['system.process.exec','system.process.scope.git']))).success).toBe(true);
        await expect.poll(missingInBothFiles).toEqual([false,false]);
        expect((await page.evaluate(() => window.electron.plugin.setCapabilities('folder-fixture',[]))).success).toBe(true);
        await expect.poll(missingInBothFiles).toEqual([true,true]);
    } finally {
        if (app) await closeElectronApp(app);
        await fs.rm(root, {recursive:true,force:true});
    }
});
