const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require('./helpers/electronApp');

test('certificate settings fit explicit import actions and readable developer details', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        await app.evaluate(({ipcMain}) => {
            const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
            const createdAt = new Date().toISOString();
            ipcMain.removeHandler('settings:certificates:registry-status');
            ipcMain.handle('settings:certificates:registry-status', () => ({available: true,
                anchor: {id: 'AA:'.repeat(31) + 'AA', label: 'FDO Plugin Registry', official: true, expiresAt, createdAt},
                developers: [{id: 'E0:'.repeat(31) + 'E0', label: 'CN=f4282428-2001-70a5-a03d-9658eb262ac9\nO=FDO Plugin Registry Developers',
                    kind: 'developer', scope: 'registry', imported: true, expiresAt, createdAt, lifecycleStatus: 'revoked', lifecycleError: 'Developer certificate was revoked. Recover it in your registry account.'}],
            }));
        });
        const page = await app.firstWindow();
        await dismissBlueprintOverlays(page);
        await page.getByTestId('header-command-search').click();
        await page.locator('.bp6-omnibar input').fill('Settings');
        await page.getByRole('menuitem', {name: /Settings/}).click();
        await page.getByRole('tab', {name: 'Certificates', exact: true}).click();
        const settings = page.getByRole('dialog', {name: 'Settings', exact: true});
        await expect(settings.getByRole('button', {name: 'Import root certificate', exact: true})).toBeVisible();
        await expect(settings.getByRole('button', {name: 'Import developer certificate', exact: true})).toBeVisible();
        const name = settings.getByText('Developer signing certificate', {exact: true});
        await expect(name).toBeVisible();
        const region = settings.getByRole('region', {name: 'Registry signing certificates'});
        await region.locator('summary').last().click();
        await expect(region.getByText('Account ID:', {exact: false})).toBeVisible();
        await expect(region.getByText('Revoked — signing blocked',{exact:true})).toBeVisible();
        const developerCard=region.locator('.bp6-card').last();
        await expect(developerCard.getByText(/Valid —/)).toHaveCount(0);
        const row=developerCard.locator('[class*="registryCertificateRow"]');
        const issue=developerCard.locator('.bp6-callout');
        const rowBox=await row.boundingBox(),issueBox=await issue.boundingBox();
        expect(issueBox.y).toBeGreaterThanOrEqual(rowBox.y+rowBox.height);
        expect(await developerCard.evaluate(element=>element.scrollWidth <= element.clientWidth+1)).toBe(true);
        const body = name.locator('..').locator('..');
        expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await settings.screenshot({path: test.info().outputPath('certificate-settings.png'), animations: 'disabled'});
        for (const label of ['Import root certificate', 'Import developer certificate']) {
            const button = settings.getByRole('button', {name: label, exact: true});
            expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        }
    } finally {await closeElectronApp(app);}
});
