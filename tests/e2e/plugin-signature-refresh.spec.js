const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
const Conf=createRequire(require.resolve('electron-store'))('conf').default;
const {certificateFixture}=require('../helpers/certificateFixture.cjs');
const {launchElectronApp,closeElectronApp,dismissBlueprintOverlays}=require('./helpers/electronApp');

test('open Manage Plugins replaces certificate details when the plugin is signed elsewhere', async () => {
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-signature-refresh-'));
    let app;
    try {
        const roots=await Promise.all([certificateFixture('Original Root'),certificateFixture('Replacement Root')]);
        new Conf({cwd:profile,configName:'settings',encryptionKey:'FDO-APPLICATION'}).set('certificates',{root:roots});
        const home=path.join(profile,'plugins','signature-refresh');
        fs.mkdirSync(path.join(home,'dist'),{recursive:true});
        fs.writeFileSync(path.join(home,'package.json'),JSON.stringify({name:'signature-refresh',version:'1.0.0',main:'dist/index.cjs'}));
        fs.writeFileSync(path.join(home,'dist/index.cjs'),'module.exports = {};');
        fs.writeFileSync(path.join(profile,'plugins.json'),JSON.stringify({plugins:[{id:'signature-refresh',home,entry:'dist/index.cjs',capabilities:[],
            metadata:{name:'Signature Refresh',version:'1.0.0',author:'FDO',description:'Signature refresh regression',icon:'code'}}]}));
        app=await launchElectronApp(electron,{isolatedUserDataDir:true,env:{FDO_E2E_USER_DATA_DIR:profile}});
        const page=await app.firstWindow();
        expect(await page.evaluate(()=>window.electron.plugin.sign('signature-refresh','Original Root'))).toEqual({success:true});
        await dismissBlueprintOverlays(page);
        await page.getByRole('button',{name:/Plugins Activated:/i}).click();
        await page.getByRole('button',{name:'Manage plugins',exact:true}).click();
        await expect(page.getByText('Original Root',{exact:true})).toBeVisible();
        expect(await page.evaluate(()=>window.electron.plugin.sign('signature-refresh','Replacement Root'))).toEqual({success:true});
        await expect(page.getByText('Replacement Root',{exact:true})).toBeVisible();
        await expect(page.getByText('Original Root',{exact:true})).toHaveCount(0);
        await page.getByRole('dialog').screenshot({path:test.info().outputPath('updated-signature.png'),animations:'disabled'});
    } finally {if(app)await closeElectronApp(app);fs.rmSync(profile,{recursive:true,force:true});}
});
