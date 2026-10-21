const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

let electronApp;

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true});
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test('long GitHub release notes stay within the Settings dialog and scroll internally', async () => {
  const releaseNotes = Array.from({length: 80}, (_, index) => (
    `### Change ${index + 1}\n\nThis release note describes a user-facing change in FDO. `
    + 'A very long unbroken value for layout testing: '
    + 'release-artifact-'.repeat(18)
  )).join('\n\n');

  await electronApp.evaluate((_, notes) => {
    const {ipcMain} = require('electron');
    ipcMain.removeHandler('settings:updates:check-updates');
    ipcMain.handle('settings:updates:check-updates', async () => ({
      success: true,
      currentVersion: '1.0.0-rc.19',
      latestVersion: '1.0.0-rc.20',
      hasUpdate: true,
      platform: 'mac-arm64',
      downloads: [],
      releaseName: 'FDO 1.0.0-rc.20',
      releaseUrl: 'https://github.com/anikitenko/fdo/releases/tag/v1.0.0-rc.20',
      releaseNotes: notes,
    }));
  }, releaseNotes);

  const window = await electronApp.firstWindow();
  await electronApp.evaluate(({BrowserWindow}) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:open-settings', {
      tab: 'updates',
      checkNow: true,
    });
  });

  const dialog = window.getByRole('dialog', {name: 'Settings'});
  await expect(dialog).toBeVisible();
  const notesHeading = dialog.getByRole('heading', {name: 'Latest Release Notes · 1.0.0-rc.20'});
  await expect(notesHeading).toBeVisible({timeout: 10_000});

  const layout = await dialog.evaluate(node => {
    const body = node.querySelector('.bp6-dialog-body');
    const panel = node.querySelector('.bp6-tab-panel');
    const notesCard = [...node.querySelectorAll('.bp6-card')].find(card =>
      card.querySelector('h4')?.textContent?.startsWith('Latest Release Notes'));
    const rect = element => {
      const bounds = element.getBoundingClientRect();
      return {top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right};
    };
    return {
      dialog: rect(node),
      body: rect(body),
      panel: rect(panel),
      notesCard: rect(notesCard),
      notesCardClientHeight: notesCard?.clientHeight,
      notesCardScrollHeight: notesCard?.scrollHeight,
      notesCardOverflowY: getComputedStyle(notesCard).overflowY,
      panelClientWidth: panel?.clientWidth,
      panelScrollWidth: panel?.scrollWidth,
    };
  });

  expect(layout.panel.top).toBeGreaterThanOrEqual(layout.body.top - 1);
  expect(layout.panel.bottom).toBeLessThanOrEqual(layout.body.bottom + 1);
  expect(layout.notesCard.right).toBeLessThanOrEqual(layout.panel.right + 1);
  expect(layout.notesCardOverflowY).toMatch(/auto|scroll/);
  expect(layout.notesCardScrollHeight).toBeGreaterThan(layout.notesCardClientHeight);
  expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth + 1);
});
