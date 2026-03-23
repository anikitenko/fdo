const { test, expect, _electron: electron } = require('@playwright/test');
const { launchElectronApp, closeElectronApp } = require('./helpers/electronApp');

let electronApp;

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test('Main window should load with correct title', async () => {
  const window = await electronApp.firstWindow();
  const title = await window.title();
  expect(title).toBe('FlexDevOps (FDO)');
  await expect(window.locator('body')).toBeVisible();
});
