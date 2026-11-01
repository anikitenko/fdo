const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

let app, page;
const dialog = () => page.getByRole('dialog', {name: 'Settings', exact: true});
const openUpdates = () => app.evaluate(({BrowserWindow}) => {
  BrowserWindow.getAllWindows()[0].webContents.send('app:open-settings', {tab: 'updates', checkNow: true});
});
const publishProgress = status => app.evaluate(({BrowserWindow}, status) => {
  global.__updateFixture.status = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('settings:updates:update-progress', status);
  }
}, status);

test.beforeEach(async () => {
  app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  page = await app.firstWindow();
  // Exercise the real renderer/preload IPC path with a controlled updater.
  // No release is downloaded and the test never quits or replaces the app.
  await app.evaluate(({ipcMain}) => {
    const fixture = global.__updateFixture = {status: {phase: 'idle'}, installs: 0};
    const handlers = {
      'check-updates': () => ({
        success: true, currentVersion: '1.0.0', latestVersion: '1.1.0', hasUpdate: true,
        platform: 'mac-arm64', downloads: [], macAutoUpdate: {available: true, feed: true},
      }),
      'update-status': () => fixture.status,
      'install-update': () => {
        fixture.installs++;
        return new Promise(resolve => {fixture.finish = resolve;});
      },
    };
    for (const [name, handler] of Object.entries(handlers)) {
      const channel = `settings:updates:${name}`;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    }
  });
  await openUpdates();
  await expect(dialog().getByRole('button', {name: 'Update and Restart'})).toBeVisible();
});

test.afterEach(async () => {await closeElectronApp(app);});

test('shows download progress, restores it after closing Settings, and displays restart status', async () => {
  await dialog().getByRole('button', {name: 'Update and Restart'}).click();
  await expect.poll(() => app.evaluate(() => global.__updateFixture.installs)).toBe(1);
  await publishProgress({phase: 'checking'});
  await expect(dialog().getByText('Checking update…', {exact: true})).toBeVisible();
  await publishProgress({phase: 'downloading'});
  await expect(dialog().getByText('Downloading update…', {exact: true})).toBeVisible();
  await publishProgress({phase: 'downloading', percent: 42});
  await expect(dialog().getByText('42%', {exact: true})).toBeVisible();
  await expect(dialog().locator('.bp6-progress-meter')).toHaveAttribute('style', /width: 42%;/);
  await expect(dialog().getByText(/You can close this window/)).toBeVisible();
  await page.screenshot({animations: 'disabled', path: test.info().outputPath('update-downloading.png')});

  await dialog().getByRole('button', {name: 'Close', exact: true}).click();
  await expect(dialog()).not.toBeVisible();
  await publishProgress({phase: 'downloading', percent: 73});
  await openUpdates();
  await expect(dialog().getByText('73%', {exact: true})).toBeVisible();
  await expect(dialog().locator('.bp6-progress-meter')).toHaveAttribute('style', /width: 73%;/);
  await expect(dialog().getByRole('button', {name: 'Check for Updates', exact: true})).toBeDisabled();
  expect(await app.evaluate(() => global.__updateFixture.installs)).toBe(1);
  await page.screenshot({animations: 'disabled', path: test.info().outputPath('update-reopened.png')});

  await publishProgress({phase: 'verifying'});
  await expect(dialog().getByText('Verifying and preparing update…', {exact: true})).toBeVisible();
  await expect(dialog().getByText('73%', {exact: true})).toHaveCount(0);
  await publishProgress({phase: 'restarting'});
  await expect(dialog().getByText('Restarting FDO…', {exact: true})).toBeVisible();
});

test('shows an installation failure and allows another attempt', async () => {
  await dialog().getByRole('button', {name: 'Update and Restart'}).click();
  await expect.poll(() => app.evaluate(() => global.__updateFixture.installs)).toBe(1);
  await publishProgress({phase: 'downloading', percent: 12});
  await expect(dialog().getByText('12%', {exact: true})).toBeVisible();
  const error = 'Update download interrupted.';
  await publishProgress({phase: 'error', error});
  await app.evaluate(() => global.__updateFixture.finish({success: false, error: 'Update download interrupted.'}));
  await expect(dialog().getByText('Update failed', {exact: true})).toBeVisible();
  await expect(dialog()).toContainText(error);
  await expect(dialog().getByText('12%', {exact: true})).toHaveCount(0);
  await expect(dialog().getByRole('button', {name: 'Check for Updates', exact: true})).toBeEnabled();
  await page.screenshot({animations: 'disabled', path: test.info().outputPath('update-failed.png')});
  await dialog().getByRole('button', {name: 'Check for Updates', exact: true}).click();
  await dialog().getByRole('button', {name: 'Update and Restart'}).click();
  await expect.poll(() => app.evaluate(() => global.__updateFixture.installs)).toBe(2);
});
