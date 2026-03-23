const { test, expect, _electron: electron } = require('@playwright/test');
const { launchElectronApp, closeElectronApp, openEditorWithMockedIPC, expectNoToastContaining, expectNoUnexpectedErrorToasts, getConfirmLog, clearConfirmLog } = require('./helpers/electronApp');
const { SystemChannels } = require('../../src/ipc/channels.js');

let electronApp;

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
}, 60000);

test.afterEach(async () => {
  const editorWindow = await electronApp.firstWindow();
  await expectNoUnexpectedErrorToasts(editorWindow);
});

test('Editor window should open correctly', async () => {
  const editorWindow = await openEditorWithMockedIPC(electronApp);
  const title = await editorWindow.title();
  expect(['Plugin Editor', 'FlexDevOps (FDO)']).toContain(title);
  await expect(editorWindow.locator('body')).toBeVisible();
  await expect(editorWindow.locator('button:has-text("Snapshot"), button:has-text("Recent")').first()).toBeVisible({ timeout: 15000 });

  await editorWindow.waitForFunction(() => typeof window.__editorTestApi?.getState === 'function');
  await editorWindow.waitForFunction(() => {
    const state = window.__editorTestApi?.getState?.();
    const ids = (state?.workspaceTreeIds || state?.treeIds || []).filter((id) => typeof id === 'string' && !id.startsWith('/node_modules') && !id.startsWith('/dist'));
    return ids.includes('/index.ts') && ids.includes('/render.tsx') && ids.includes('/package.json');
  }, { timeout: 15000 });
  const state = await editorWindow.evaluate(() => window.__editorTestApi.getState());
  const workspaceTreeIds = (state.workspaceTreeIds || state.treeIds || []).filter((id) => typeof id === 'string' && !id.startsWith('/node_modules') && !id.startsWith('/dist'));

  expect(workspaceTreeIds).toContain('/index.ts');
  expect(workspaceTreeIds).toContain('/render.tsx');
  expect(workspaceTreeIds).toContain('/package.json');
  expect(state.activeTabId).toBe('/index.ts');
  expect(state.selectedId).toBe('/index.ts');
  expect(state.versions.length).toBeGreaterThanOrEqual(1);
  expect(state.currentVersion).toBeTruthy();

  await expectNoToastContaining(editorWindow, /No source file found/i);
  await expectNoToastContaining(editorWindow, /Failed to initialize editor workspace/i);
});

test('Editor close confirmation is shown only once for duplicate close events', async () => {
  const editorWindow = await openEditorWithMockedIPC(electronApp);

  await editorWindow.waitForFunction(() => typeof window.__editorTestApi?.getState === 'function');
  await clearConfirmLog(editorWindow);

  await electronApp.evaluate(({ BrowserWindow }, channelName) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => {
      try {
        return candidate.webContents.getURL().includes('#/editor');
      } catch (_) {
        return false;
      }
    });
    if (!win) {
      throw new Error('Editor window not found');
    }
    win.webContents.send(channelName);
    win.webContents.send(channelName);
  }, SystemChannels.on_off.CONFIRM_CLOSE);

  await editorWindow.waitForFunction(() => (window.__e2eConfirmLog || []).length >= 1);
  await editorWindow.waitForTimeout(200);

  const confirmLog = await getConfirmLog(editorWindow);
  const discardConfirms = confirmLog.filter((entry) => /Changes will be discarded unless a snapshot is created!/i.test(entry.message));
  expect(discardConfirms).toHaveLength(1);
});
