// Playwright E2E tests for snapshot system
// Launches Electron app and drives the renderer
const { test, expect, _electron: electron } = require('@playwright/test');

const openEditorWithMockedIPC = async (app) => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Inject IPC mocks before editor initializes
  await window.evaluate(() => {
    // Mark E2E environment and soft override electron preload bridge for tests
    window.__E2E__ = true;
    // Neutralize native dialogs to avoid headless hangs/errors
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';
    window.electron = window.electron || {};
    window.electron.system = window.electron.system || {};
    window.electron.system.getModuleFiles = () => Promise.resolve({ files: [] });
    window.electron.system.getFdoSdkTypes = () => Promise.resolve({ files: [] });
    window.electron.settings = { certificates: { getRoot: async () => [] } };
  });
  // Navigate directly to Editor route with minimal data
  const pluginData = encodeURIComponent(JSON.stringify({ name: 'E2E Plugin', template: 'basic', dir: '/tmp' }));
  await window.evaluate((pd) => { window.location.hash = `#/editor?data=${pd}`; }, pluginData);
  await window.waitForFunction(() => location.hash.startsWith('#/editor'));
  return window;
};

// These tests require the app to be built: npm run build
// Then run with: npx playwright test

test.describe('Snapshots E2E', () => {
  let app;

  test.beforeAll(async () => {
    app = await electron.launch({ args: ['.'] });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('Recent menu renders quickly (<100ms)', async () => {
    const win = await openEditorWithMockedIPC(app);

    // Measure Recent menu open -> first item visible (initial snapshot exists after workspace init)
    const recentBtn = await win.waitForSelector('button:has-text("Recent")', { timeout: 15000 });
    const start = Date.now();
    await recentBtn.click();
    await win.waitForSelector('div[role="menu"] .bp6-menu-item');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThanOrEqual(100);
  });

  test('Switch via toolbar Recent menu shows a toast and updates state', async () => {
    const win = await openEditorWithMockedIPC(app);
    // Ensure at least two snapshots
    const snapshotBtn = await win.waitForSelector('button:has-text("Snapshot")');
    await snapshotBtn.click();
    await win.waitForSelector('.bp6-toast');
    await snapshotBtn.click();
    await win.waitForSelector('.bp6-toast');

    // Open Snapshot toolbar Recent menu and click the second item
    const recentBtn = await win.waitForSelector('button:has-text("Recent")');
    await recentBtn.click();
    const menuItems = await win.locator('div[role="menu"] .bp6-menu-item').all();
    if (menuItems.length > 1) {
      await menuItems[1].click();
    }
    // Expect a switched toast
    await win.getByText(/Switched to /i).waitFor({ timeout: 5000 });
  });

  test('Blueprint intents and focusable toolbar buttons', async () => {
    const win = await openEditorWithMockedIPC(app);
    const snapshotBtn = await win.waitForSelector('button:has-text("Snapshot")');
    const className = await snapshotBtn.getAttribute('class');
    expect(className).toContain('bp6-intent-success');

    const recentBtn = await win.waitForSelector('button:has-text("Recent")');
    // Programmatically focus and verify
    await recentBtn.evaluate((el) => el.focus());
    const hasFocus = await recentBtn.evaluate((el) => document.activeElement === el);
    expect(hasFocus).toBeTruthy();
  });

  test('Keyboard shortcut mod+shift+s creates snapshot', async () => {
    const win = await openEditorWithMockedIPC(app);
    await win.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await win.keyboard.down('Shift');
    await win.keyboard.press('KeyS');
    await win.keyboard.up('Shift');
    await win.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');

    await win.getByText(/Snapshot .* created/i).waitFor({ timeout: 5000 });
  });

  test('Error handling: quota exceeded surfaces danger toast', async () => {
    const win = await openEditorWithMockedIPC(app);
    // Monkey-patch localStorage to throw
    await win.evaluate(() => {
      const origSet = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = function(k, v) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    });

    const snapshotBtn = await win.waitForSelector('button:has-text("Snapshot")');
    await snapshotBtn.click();

    // Expect error toast
    await win.getByText(/Failed to persist snapshot/i).waitFor({ timeout: 5000 });
  });
  
  test('Editor file tree uses correct icon asset paths', async () => {
    const win = await openEditorWithMockedIPC(app);
    // Wait for file browser to render at least one icon image
    const img = await win.waitForSelector('img[src^="static://assets/icons/vscode/"]', { timeout: 15000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^static:\/\/assets\/icons\/vscode\//);
  });
});
