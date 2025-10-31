const { test, expect, _electron: electron } = require('@playwright/test');

test.beforeAll(async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
});

let electronApp;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: ['.'] });
});

test.afterAll(async () => {
  await electronApp.close();
});

test('Main window should load with correct title', async () => {
  const window = await electronApp.firstWindow();
  const title = await window.title();
  expect(title).toBe('FlexDevOps (FDO)');
  const isVisible = await window.isVisible('body');
  expect(isVisible).toBeTruthy();
});