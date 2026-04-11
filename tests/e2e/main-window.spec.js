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

test('workspace keeps app background visible when no plugin is active', async () => {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.evaluate(async () => {
    const activeIds = Array.isArray(window.__homeTestApi?.getActivePluginIds?.())
      ? window.__homeTestApi.getActivePluginIds()
      : [];
    for (const pluginId of activeIds) {
      try {
        window.__homeTestApi?.deselectPluginById?.(pluginId);
      } catch (_) {}
      try {
        await window.electron.plugin.deactivate(pluginId);
      } catch (_) {}
    }
  });

  await expect.poll(async () => {
    return await window.evaluate(() => document.querySelectorAll('iframe[title^="Plugin Container ID"]').length);
  }, { timeout: 10000 }).toBe(0);

  const visualState = await window.evaluate(() => {
    const mainContainer = document.querySelector('[data-testid="fdo-main-container"]');
    const workspace = document.querySelector('[data-testid="fdo-plugin-workspace"]');
    const mainStyle = mainContainer ? window.getComputedStyle(mainContainer) : null;
    const workspaceStyle = workspace ? window.getComputedStyle(workspace) : null;
    const workspaceBackground = String(workspaceStyle?.backgroundColor || "");
    return {
      mainBackgroundImage: String(mainStyle?.backgroundImage || ""),
      workspaceBackground,
      workspaceIsTransparent: (
        workspaceBackground === "rgba(0, 0, 0, 0)"
        || workspaceBackground === "transparent"
      ),
      mainFound: !!mainContainer,
      workspaceFound: !!workspace,
    };
  });

  expect(visualState.mainFound).toBe(true);
  expect(visualState.workspaceFound).toBe(true);
  expect(visualState.mainBackgroundImage).not.toBe('none');
  expect(visualState.workspaceIsTransparent).toBe(true);
});
