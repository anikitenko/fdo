const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('host prerequisite inventory exposes capability tools and platform setup without requiring a plugin', async ({}, testInfo) => {
    test.setTimeout(90000);
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir:true, env:{FDO_E2E_LIVE_AI:'0'}});
        const page = await app.firstWindow();
        await page.waitForFunction(() => typeof window.electron?.toolSettings?.inspect === 'function');
        await page.getByLabel('Open command search').click();
        await page.getByRole('menuitem').filter({hasText:'Configure FDO'}).click();
        await page.getByRole('tab', {name:'Tools & Prerequisites',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Tools & Prerequisites',exact:true})).toBeVisible();
        await expect(page.getByText(/Detection checks executable files/)).toBeVisible();
        await page.getByRole('textbox',{name:'Search tools'}).fill('azure-cli');
        await expect(page.getByRole('heading',{name:/Azure CLI/})).toBeVisible();
        await expect(page.getByRole('button',{name:'Install / setup instructions',exact:true})).toBeVisible();
        await page.getByRole('button',{name:'Recheck tools',exact:true}).click();
        await expect(page.getByRole('button',{name:'Recheck tools',exact:true})).toBeEnabled();
        const inventory = await page.evaluate(async () => window.electron.toolSettings.inspect());
        expect(inventory.success).toBe(true);
        expect(inventory.inventory.platform).toBe(process.platform);
        expect(inventory.inventory.tools.map(tool => tool.id)).toEqual(expect.arrayContaining(['az','aws','git','kubectl']));
        await page.screenshot({path:testInfo.outputPath('prerequisites.png')});
    } finally {if (app) await closeElectronApp(app);}
});
