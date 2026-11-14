const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {certificateFixture} = require('../helpers/certificateFixture.cjs');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('migrates signing keys to OS-encrypted SQLite, exposes public records only, and preserves certificate operations across restart', async () => {
    test.setTimeout(90000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-certificate-e2e-'));
    const original = await certificateFixture('migrated');
    const store = new Conf({cwd: profile, configName: 'settings', encryptionKey: 'FDO-APPLICATION'});
    store.set('certificates', {root: [original]});
    let app;
    const launch = () => launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
    try {
        app = await launch();
        let page = await app.firstWindow();
        let certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
        expect(certificates).toHaveLength(1);
        expect(certificates[0]).toMatchObject({id: original.id, cert: original.cert, label: 'migrated', hasPrivateKey: true});
        expect(certificates[0]).not.toHaveProperty('key');
        // Reading public certificate metadata must not unlock the key store.
        expect(store.has('certificates')).toBe(true);
        // A deliberate signing-key write migrates the legacy private key into
        // OS-encrypted SQLite; startup and read-only listing remain deferred.
        await page.evaluate(() => window.electron.settings.certificates.create('migration-probe'));
        expect(store.has('certificates')).toBe(false);
        const migrationProbe = (await page.evaluate(() => window.electron.settings.certificates.getRoot())).find(item => item.label === 'migration-probe');
        expect(migrationProbe).toBeDefined();
        await page.evaluate(id => window.electron.settings.certificates.delete(id), migrationProbe.id);
        const checkSigning = () => app.evaluate(({safeStorage}, {profile, id}) => {
            const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
            const crypto = process.getBuiltinModule('node:crypto');
            const db = new DatabaseSync(process.getBuiltinModule('node:path').join(profile, 'certificates.sqlite'));
            try {
                const row = db.prepare(/* language=SQLite */ 'SELECT metadata, privateKey FROM certificates WHERE id = ?').get(id);
                const encrypted = Buffer.from(row.privateKey);
                const key = safeStorage.decryptString(encrypted);
                const content = Buffer.from('Signing after migration');
                return {valid: crypto.verify('sha256', content, JSON.parse(row.metadata).cert, crypto.sign('sha256', content, key)),
                    encrypted: !encrypted.includes(Buffer.from('PRIVATE KEY')), metadataHasKey: Object.hasOwn(JSON.parse(row.metadata), 'key')};
            } finally {db.close();}
        }, {profile, id: original.id});
        expect(await checkSigning()).toEqual({valid: true, encrypted: true, metadataHasKey: false});
        await page.evaluate(id => window.electron.settings.certificates.rename(id, 'Renamed signer'), original.id);
        expect(await page.evaluate(id => window.electron.settings.certificates.export(id), original.id)).toBe(original.cert);
        await closeElectronApp(app); app = null;
        app = await launch(); page = await app.firstWindow();
        expect(await checkSigning()).toEqual({valid: true, encrypted: true, metadataHasKey: false});
        certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
        expect(certificates[0]).toMatchObject({id: original.id, label: 'Renamed signer', hasPrivateKey: true});
        await page.evaluate(() => window.electron.settings.certificates.renew('Renamed signer'));
        certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
        expect(certificates).toHaveLength(1);
        expect(certificates[0].id).not.toBe(original.id);
        expect(certificates[0].hasPrivateKey).toBe(true);
        expect(certificates[0]).not.toHaveProperty('key');
        const pem = path.join(profile, 'public.pem'); fs.writeFileSync(pem, original.cert);
        expect(await page.evaluate(file => window.electron.settings.certificates.import(file), pem)).toEqual({success: true});
        certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
        expect(certificates.find(entry => entry.id === original.id)).toMatchObject({hasPrivateKey: false});
        await page.evaluate(id => window.electron.settings.certificates.delete(id), original.id);
        expect(await page.evaluate(() => window.electron.settings.certificates.getRoot())).toHaveLength(1);
        for (const file of fs.readdirSync(profile).filter(name => name.startsWith('certificates.sqlite'))) {
            expect(fs.readFileSync(path.join(profile, file)).includes(Buffer.from(original.key))).toBe(false);
        }
    } finally {await closeElectronApp(app); fs.rmSync(profile, {recursive: true, force: true});}
});

test('official registry certificate is automatic and unavailable until release configuration is provisioned', async () => {
    let app;
    try {
        app=await launchElectronApp(electron,{isolatedUserDataDir:true});
        const page=await app.firstWindow();
        expect(await page.evaluate(()=>window.electron.settings.certificates.registryStatus())).toMatchObject({available:false,configured:false,developers:[]});
        expect(await page.evaluate(()=>window.electron.settings.certificates.importRegistry({kind:'anchor',fingerprint:'00'.repeat(32)}))).toMatchObject({success:false,error:expect.stringContaining('automatically')});
        await page.getByTestId('header-command-search').click();
        await page.locator('.bp6-omnibar input').fill('Settings');
        await page.getByRole('menuitem',{name:/Settings/}).click();
        await page.getByRole('tab',{name:'Certificates',exact:true}).click();
        const section=page.getByRole('region',{name:'Registry signing certificates'});
        await expect(section.getByText('Registry unavailable',{exact:true})).toBeVisible();
        await expect(section.locator('.bp6-non-ideal-state')).toBeVisible();
        await section.scrollIntoViewIfNeeded();
        expect((await section.locator('.bp6-non-ideal-state').boundingBox()).height).toBeLessThan(110);
        expect((await section.locator('.bp6-non-ideal-state-visual svg').boundingBox()).width).toBeLessThanOrEqual(24);
        await expect(section.getByRole('textbox')).toHaveCount(0);
        await expect(section.getByRole('combobox')).toHaveCount(0);
        await page.getByRole('dialog',{name:'Settings',exact:true}).screenshot({path:test.info().outputPath('official-registry-certificates.png'),animations:'disabled'});
    }finally{await closeElectronApp(app);}
});
