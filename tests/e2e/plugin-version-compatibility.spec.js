const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {ensureRootCertificate} = require('./helpers/sdkExamples');

test('incompatible imports and activation are refused before plugin code executes', async () => {
    test.setTimeout(120000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-compatibility-e2e-'));
    let app;
    const manifest = {name: 'version-fixture', version: '1.0.0', author: 'FDO', description: 'Compatibility fixture', main: 'index.cjs'};
    try {
        await fs.writeFile(path.join(root, 'index.cjs'), 'throw new Error("PLUGIN_CODE_MUST_NOT_RUN");');
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({...manifest, fdo: {compatibility: {fdo: '>=99.0.0'}}}));
        app = await launchElectronApp(electron, {isolatedUserDataDir: true});
        const page = await app.firstWindow();
        await page.waitForFunction(() => !!window.electron?.plugin?.inspectFolder);
        await ensureRootCertificate(page);
        const rejected = await page.evaluate(async directory => {
            const preview = await window.electron.plugin.inspectFolder(directory);
            return {preview, install: await window.electron.plugin.installFolder({token: preview.token, id: 'future-plugin', mode: 'bundle'})};
        }, root);
        expect(rejected.preview.compatibility).toMatchObject({status: 'incompatible', supportedFdo: '>=99.0.0'});
        expect(rejected.install.success).toBe(false);
        expect(rejected.install.error).toContain('Requires FDO');
        // Legacy imports remain possible. Recheck the files on activation rather
        // than relying on a registry record or the earlier preview.
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
        const installed = await page.evaluate(async directory => {
            const preview = await window.electron.plugin.inspectFolder(directory);
            const result = await window.electron.plugin.installFolder({token: preview.token, id: 'legacy-version-fixture', mode: 'bundle'});
            return {result, plugin: (await window.electron.plugin.getAll()).plugins.find(item => item.id === 'legacy-version-fixture')};
        }, root);
        expect(installed.result.success).toBe(true);
        expect(installed.plugin.compatibility.status).toBe('unverified');
        await fs.writeFile(path.join(installed.plugin.home, 'package.json'), JSON.stringify({...manifest, fdo: {compatibility: {fdo: '>=99.0.0'}}}));
        const activation = await page.evaluate(async id => {
            const signed = await window.electron.plugin.sign(id, 'root');
            if (!signed.success) throw new Error(signed.error);
            return window.electron.plugin.activate(id);
        }, installed.plugin.id);
        expect(activation).toMatchObject({success: false, code: 'PLUGIN_HOST_INCOMPATIBLE'});
        expect(activation.error).toContain('Requires FDO');
        expect(activation.error).not.toContain('PLUGIN_CODE_MUST_NOT_RUN');
        // Editor deployment must carry its in-memory manifest into a new
        // installation, rather than requiring a package file on disk already.
        const deployed = await page.evaluate(async () => {
            const metadata = {name: 'Versioned editor fixture', version: '1.0.0', author: 'FDO', description: 'Editor deployment fixture', icon: 'cube'};
            const packageJson = JSON.stringify({name: 'editor-version-fixture', source: 'index.ts', main: 'index.ts',
                fdo: {compatibility: {fdo: '^1.0.0'}}});
            const build = await window.electron.plugin.build({latestContent: {'/package.json': packageJson, '/index.ts': 'export const answer = 42;'}});
            if (!build.success) throw new Error(build.error);
            const result = await window.electron.plugin.deployToMainFromEditor({name: 'editor-version-fixture', sandbox: 'version-test',
                entrypoint: 'dist/index.cjs', packageJson, content: build.files.outputFiles[0].text, metadata, rootCert: 'root'});
            return {result, plugin: (await window.electron.plugin.getAll()).plugins.find(item => item.id === 'editor-version-fixture')};
        });
        expect(deployed.result.success).toBe(true);
        expect(deployed.plugin.compatibility.status).toBe('compatible');
        expect(deployed.plugin.compatibility.builtWith.sdk).toBeTruthy();
        const deployedManifest = JSON.parse(await fs.readFile(path.join(deployed.plugin.home, 'package.json'), 'utf8'));
        expect(deployedManifest.fdo.compatibility.fdo).toBe('^1.0.0');
        expect(deployedManifest.main).toBe('dist/index.cjs');
    } finally {
        if (app) await closeElectronApp(app);
        await fs.rm(root, {recursive: true, force: true});
    }
});
