const { test, expect, _electron: electron } = require('@playwright/test');
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  expectNoUnexpectedErrorToasts,
} = require('./helpers/electronApp');

let electronApp;
let editorWindow;

async function waitForWorkspaceReady(page) {
  await page.waitForFunction(() => typeof window.__editorTestApi?.getState === 'function', { timeout: 15000 });
  await page.waitForFunction(() => {
    const state = window.__editorTestApi.getState();
    const ids = state?.workspaceTreeIds || state?.treeIds || [];
    return ids.includes('/index.ts');
  }, { timeout: 15000 });
}

async function setIndexSource(page, source) {
  await page.evaluate((code) => {
    window.__editorTestApi.createFile('/index.ts', code, 'typescript');
  }, source);
}

async function expectModelMarkerMessage(page, messagePattern) {
  await page.waitForFunction((pattern) => {
    const markers = window.__editorTestApi?.getModelMarkers?.('/index.ts') || [];
    const re = new RegExp(String(pattern), 'i');
    return markers.some((marker) => re.test(String(marker?.message || '')));
  }, String(messagePattern), { timeout: 15000 });
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
  editorWindow = await openEditorWithMockedIPC(electronApp);
  await waitForWorkspaceReady(editorWindow);
}, 120000);

test.afterAll(async () => {
  await closeElectronApp(electronApp);
}, 60000);

test.afterEach(async () => {
  await expectNoUnexpectedErrorToasts(editorWindow, {
    allow: [
      /missing capability/i,
      /deprecated/i,
    ],
  });
});

test('shows Monaco diagnostics for missing privileged capabilities', async () => {
  await setIndexSource(editorWindow, `
    export function run() {
      return createFilesystemMutateActionRequest({
        action: "system.fs.mutate",
        payload: {
          scope: "etc-hosts",
          operations: []
        }
      });
    }
  `);

  await editorWindow.getByRole('tab', { name: 'Problems' }).click();
  await expect(editorWindow.locator('code', { hasText: 'Missing capability: "system.hosts.write"' }).first()).toBeVisible({ timeout: 15000 });
  await expect(editorWindow.locator('code', { hasText: 'system.fs.scope.etc-hosts' }).first()).toBeVisible({ timeout: 15000 });
});

test('shows Monaco diagnostics for deprecated privileged patterns', async () => {
  await setIndexSource(editorWindow, `
    export const legacyHandler = "__host.privilegedAction";
    export const legacyAction = "system.fs.write";
    const forceTsValidation: number = "1";
  `);

  await expectModelMarkerMessage(editorWindow, 'Deprecated privileged channel');
  await expectModelMarkerMessage(editorWindow, 'Deprecated action "system.fs.write"');
});

test('shows Monaco diagnostics for invalid metadata icon names', async () => {
  await setIndexSource(editorWindow, `
    import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

    class DemoPlugin extends FDO_SDK implements FDOInterface {
      private readonly _metadata: PluginMetadata = {
        name: "demo",
        version: "1.0.0",
        author: "e2e",
        description: "demo plugin",
        icon: "not-a-blueprint-icon",
      };
    }

    new DemoPlugin();
  `);

  await expectModelMarkerMessage(editorWindow, 'Invalid metadata.icon "not-a-blueprint-icon"');
});
