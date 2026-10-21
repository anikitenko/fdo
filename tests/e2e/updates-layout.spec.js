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

  await electronApp.evaluate(({ipcMain}, notes) => {
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
    let notesCard = [...node.querySelectorAll('h4')].find(heading =>
        heading.textContent?.startsWith('Latest Release Notes'));
    while (notesCard && notesCard !== node && !(notesCard.style.maxHeight && notesCard.style.overflow === 'auto')) {
      notesCard = notesCard.parentElement;
    }
    let scrollViewport = notesCard?.parentElement;
    while (scrollViewport && scrollViewport !== node) {
      const style = getComputedStyle(scrollViewport);
      if (/auto|scroll/.test(style.overflowY) && scrollViewport.scrollHeight > scrollViewport.clientHeight) break;
      scrollViewport = scrollViewport.parentElement;
    }
    const rect = element => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right};
    };
    return {
      dialog: rect(node),
      notesCard: rect(notesCard),
      scrollViewport: rect(scrollViewport),
      notesCardClientHeight: notesCard?.clientHeight,
      notesCardScrollHeight: notesCard?.scrollHeight,
      notesCardOverflowY: notesCard ? getComputedStyle(notesCard).overflowY : '',
      viewportClientHeight: scrollViewport?.clientHeight,
      viewportScrollHeight: scrollViewport?.scrollHeight,
      viewportOverflowY: scrollViewport ? getComputedStyle(scrollViewport).overflowY : '',
    };
  });

  expect(layout.notesCard).not.toBeNull();
  expect(layout.scrollViewport).not.toBeNull();
  expect(layout.notesCard.right).toBeLessThanOrEqual(layout.dialog.right + 1);
  expect(layout.notesCardOverflowY).toMatch(/auto|scroll/);
  expect(layout.notesCardScrollHeight).toBeGreaterThan(layout.notesCardClientHeight);
  expect(layout.scrollViewport.right).toBeLessThanOrEqual(layout.dialog.right + 1);
  expect(layout.scrollViewport.bottom).toBeLessThanOrEqual(layout.dialog.bottom + 1);
  expect(layout.viewportOverflowY).toMatch(/auto|scroll/);
  expect(layout.viewportScrollHeight).toBeGreaterThan(layout.viewportClientHeight);
});
