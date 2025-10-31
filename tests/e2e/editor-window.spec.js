const { test, expect, _electron: electron } = require('@playwright/test');

let electronApp;

test.beforeAll(async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  electronApp = await electron.launch({ args: ['.'] });
});

test.afterAll(async () => {
  for (const win of electronApp.windows()) {
    try {
      await win.close();
    } catch (e) {}
  }
  await electronApp.close();
}, 60000);

test('Editor window should open correctly', async () => {
  const window = await electronApp.firstWindow();
  await window.click('button:has-text("Plugins Activated")');
  await window.click('text=Create plugin');
  const randomName = 'plugin-' + Math.random().toString(36).substring(2, 8);
  await window.fill('#plugin-name', randomName);
  const [editorWindow] = await Promise.all([
    electronApp.waitForEvent('window'),
    window.click('text=Open editor')
  ]);
  const title = await editorWindow.title();
  expect(title).toBe('FlexDevOps (FDO)');
});