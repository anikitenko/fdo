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

test('command search includes FDO and plugin-management actions by default', async () => {
  const window = await electronApp.firstWindow();

  await expect.poll(() => window.evaluate(() => (
    window.__homeTestApi?.getSearchActionsSnapshot?.().map((action) => action.name) || []
  ))).toEqual(expect.arrayContaining([
    'Settings',
    'Notifications',
    'Chat with AI Assistant',
    'Create Plugin',
    'Manage Plugins',
  ]));

  await window.getByTestId('header-command-search').click();
  await expect(window.getByText('Settings', {exact: true})).toBeVisible();
  await expect(window.getByText('Manage Plugins', {exact: true})).toBeVisible();
  await window.locator('.bp6-omnibar input').fill('plugin');
  await window.waitForTimeout(200);
  await window.keyboard.press('Enter');
  await expect(window.getByText('Create Plugin', {exact: true})).toBeVisible();
  await window.keyboard.press('Escape');
});

test('command search stays usable and clear of centered navigation after a resize', async () => {
  const window = await electronApp.firstWindow();

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 700);
  });
  await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(1024);

  const normalMetrics = await window.evaluate(() => {
    const navigation = document.querySelector('[data-testid="header-plugin-navigation"]')?.getBoundingClientRect();
    const search = document.querySelector('[data-testid="header-command-search"]')?.getBoundingClientRect();
    const navbar = document.querySelector('.bp6-navbar')?.getBoundingClientRect();
    return { navigation, search, navbar };
  });
  expect(normalMetrics.navigation).toBeTruthy();
  expect(normalMetrics.search).toBeTruthy();
  expect(normalMetrics.navbar).toBeTruthy();
  const navigationCenter = normalMetrics.navigation.left + normalMetrics.navigation.width / 2;
  const navbarCenter = normalMetrics.navbar.left + normalMetrics.navbar.width / 2;
  expect(Math.abs(navigationCenter - navbarCenter)).toBeLessThanOrEqual(4);
  expect(normalMetrics.navigation.right).toBeLessThanOrEqual(normalMetrics.search.left + 1);
  expect(normalMetrics.search.right).toBeLessThanOrEqual(normalMetrics.navbar.right);
  expect(normalMetrics.search.width).toBeGreaterThanOrEqual(160);

  await window.getByTestId('header-command-search').click();
  await expect(window.locator('.bp6-omnibar')).toBeVisible();
  await window.keyboard.press('Escape');
});
