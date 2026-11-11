const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  expectNoUnexpectedErrorToasts,
} = require("./helpers/electronApp");

let electronApp;
let editorWindow;

async function waitForWorkspaceReady(page) {
  await page.waitForFunction(() => typeof window.__editorTestApi?.getState === "function", { timeout: 15000 });
  await page.waitForFunction(() => {
    const state = window.__editorTestApi.getState();
    const ids = state?.workspaceTreeIds || state?.treeIds || [];
    return ids.includes("/index.ts");
  }, { timeout: 15000 });
}

async function waitForModelMarkerMessage(page, filePath, messagePattern) {
  await page.waitForFunction(
    ({ path, pattern }) => {
      const markers = window.__editorTestApi?.getModelMarkers?.(path) || [];
      const rx = new RegExp(String(pattern), "i");
      return markers.some((marker) => rx.test(String(marker?.message || "")));
    },
    { path: String(filePath), pattern: String(messagePattern) },
    { timeout: 15000 }
  );
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true});
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

test("new file created from editor is immediately visible to Monaco diagnostics and esbuild", async () => {
  await editorWindow.locator(".monaco-editor").first().click({ timeout: 15000 });
  await editorWindow.keyboard.press("ControlOrMeta+N");

  const nameInput = editorWindow.getByPlaceholder("Name");
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill("new-file.ts");
  await nameInput.press("Enter");

  await editorWindow.waitForFunction(() => {
    const state = window.__editorTestApi.getState();
    return state?.workspaceTreeIds?.includes("/new-file.ts") && state?.filesKeys?.includes("/new-file.ts");
  }, { timeout: 15000 });

  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile(
      "/new-file.ts",
      `
      export function requestedCapability() {
        return createFilesystemMutateActionRequest({
          action: "system.fs.mutate",
          payload: {
            scope: "etc-hosts",
            operations: []
          }
        });
      }
      `,
      "typescript"
    );
  });

  await waitForModelMarkerMessage(editorWindow, "/new-file.ts", "system\\.host(?:s)?\\.write");

  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile(
      "/index.ts",
      `
      import { requestedCapability } from "./new-file";
      export const fromNewFile = requestedCapability;
      `,
      "typescript"
    );
  });

  await editorWindow.waitForFunction(() => {
    const markers = window.__editorTestApi?.getModelMarkers?.("/index.ts") || [];
    return !markers.some((marker) => {
      const text = String(marker?.message || "").toLowerCase();
      return text.includes("cannot find module './new-file'") || text.includes('cannot find module "./new-file"');
    });
  }, { timeout: 15000 });

  const buildResult = await editorWindow.evaluate(async () => {
    const state = window.__editorTestApi.getState();
    const latestContent = {};
    const workspaceIds = Array.isArray(state?.workspaceTreeIds) ? state.workspaceTreeIds : [];

    for (const id of workspaceIds) {
      if (typeof id !== "string" || !id.startsWith("/") || id === "/") {
        continue;
      }
      const content = window.__editorTestApi.getFileContent(id);
      if (typeof content === "string") {
        latestContent[id] = content;
      }
    }

    return window.electron.plugin.build({ latestContent });
  });

  expect(buildResult?.success).toBe(true);
});

test('nested shared helper created from the root resolves in Monaco and the editor build', async () => {
  await editorWindow.locator('.bp6-tree-node-content').first().click({button: 'right'});
  await editorWindow.getByRole('menuitem', {name: 'New file', exact: true}).click();
  const nameInput = editorWindow.getByPlaceholder('Name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('shared/website-check-ui.ts');
  await nameInput.press('Enter');

  await expect.poll(() => editorWindow.evaluate(() => {
    const state = window.__editorTestApi.getState();
    return {tree: state.workspaceTreeIds.includes('/shared/website-check-ui.ts'),
      files: state.filesKeys.filter(path => path.includes('website-check-ui'))};
  })).toEqual({tree: true, files: ['/shared/website-check-ui.ts']});

  const helperSource = `import {DOM, DOMText} from '@anikitenko/fdo-sdk';
export function createWebsiteCheckUI() {
  const dom = new DOM(), text = new DOMText();
  dom.collectStylesFrom(text);
  return {dom, text};
}`;
  await editorWindow.evaluate(() => window.__editorTestApi.focusEditor());
  await editorWindow.keyboard.press('ControlOrMeta+a');
  await editorWindow.keyboard.insertText(helperSource);
  await expect.poll(() => editorWindow.evaluate(() => window.__editorTestApi.getFileContent('/shared/website-check-ui.ts').split('\n').map(line => line.trim()).join('\n'))).toBe(helperSource.split('\n').map(line => line.trim()).join('\n'));
  await editorWindow.getByRole('button', {name:'Close website-check-ui.ts',exact:true}).click();
  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile('/index.ts', `
      import {createWebsiteCheckUI} from './shared/website-check-ui';
      export const ui = createWebsiteCheckUI();
      ui.nonexistentProperty;
    `);
  });
  // A diagnostic for the return type proves the worker resolved the actual
  // helper, rather than passing before an asynchronous diagnostic appeared.
  await waitForModelMarkerMessage(editorWindow, '/index.ts', 'nonexistentProperty');
  const markers = await editorWindow.evaluate(() => window.__editorTestApi.getModelMarkers('/index.ts'));
  expect(markers.some(marker => /cannot find module/i.test(marker.message))).toBe(false);

  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile('/index.ts', `
      import {createWebsiteCheckUI} from './shared/website-check-ui';
      export const ui = createWebsiteCheckUI();
    `);
  });
  await editorWindow.getByRole('button', {name: 'Compile', exact: true}).click();
  await expect(editorWindow.getByRole('region', {name: 'Plugin test output'})
    .getByText('Compilation successful!', {exact: true})).toBeVisible({timeout: 15000});
});

 test('a helper edited after snapshot restore immediately becomes a module for its importer', async () => {
  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile('/shared/restored.ts', '// new helper');
    window.__editorTestApi.createFile('/index.ts', "import {answer} from './shared/restored'; const typed: string = answer;");
  });
  const snapshot = await editorWindow.evaluate(() => window.__editorTestApi.createSnapshot());
  await editorWindow.evaluate(async version => {
    await window.__editorTestApi.switchSnapshot(version);
    window.__editorTestApi.openTabs([{id:'/shared/restored.ts',active:true},{id:'/index.ts',active:false}]);
  }, snapshot.version);
  await expect.poll(() => editorWindow.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/shared/restored.ts');
  await editorWindow.evaluate(() => window.__editorTestApi.focusEditor());
  await editorWindow.keyboard.press('ControlOrMeta+a');
  await editorWindow.keyboard.insertText('export const answer = 42;');
  await expect.poll(() => editorWindow.evaluate(() => window.__editorTestApi.getFileContent('/shared/restored.ts'))).toBe('export const answer = 42;');
  await editorWindow.evaluate(() => window.__editorTestApi.openTabs([{id:'/index.ts',active:true},{id:'/shared/restored.ts',active:false}]));
  await waitForModelMarkerMessage(editorWindow,'/index.ts', 'not assignable to type');
  const markers = await editorWindow.evaluate(() => window.__editorTestApi.getModelMarkers('/index.ts'));
  expect(markers.some(marker => /not a module|cannot find module/i.test(marker.message))).toBe(false);
 });

test('existing importer and Problems update when only its newly created helper is edited', async () => {
  await editorWindow.evaluate(() => {
    window.__editorTestApi.createFile('/index.ts', `import {createWebsiteCheckUI} from './shared/import-before-create';
export const expected: string = createWebsiteCheckUI().status;`);
    window.__editorTestApi.openTabs([{id:'/index.ts',active:true}]);
  });
  await waitForModelMarkerMessage(editorWindow,'/index.ts','cannot find module');
  await editorWindow.evaluate(() => window.__editorTestApi.focusEditor());
  await editorWindow.keyboard.press('ControlOrMeta+n');
  const input = editorWindow.getByPlaceholder('Name');
  await input.fill('shared/import-before-create.ts');await input.press('Enter');
  await expect.poll(() => editorWindow.evaluate(() => window.__editorTestApi.getState().activeTabId)).toBe('/shared/import-before-create.ts');
  await waitForModelMarkerMessage(editorWindow,'/index.ts','is not a module');
  await editorWindow.evaluate(() => window.__editorTestApi.focusEditor());
  await editorWindow.keyboard.press('ControlOrMeta+a');
  await editorWindow.keyboard.insertText('export function createWebsiteCheckUI() { return {status: 200}; }');
  // Do not edit or reopen index.ts: it is the dependent whose cached error must refresh.
  await waitForModelMarkerMessage(editorWindow,'/index.ts','not assignable to type');
  await expect.poll(() => editorWindow.evaluate(() => {
    const native = window.__editorTestApi.getModelMarkers('/index.ts');
    const displayed = window.__editorTestApi.getState().markers.find(item => item.id === '/index.ts')?.markers || [];
    return {nativeStale:native.some(marker => /not a module|cannot find module/i.test(marker.message)),
      displayedStale:displayed.some(marker => /not a module|cannot find module/i.test(marker.message)),
      displayedTypeError:displayed.some(marker => /not assignable to type/i.test(marker.message))};
  })).toEqual({nativeStale:false,displayedStale:false,displayedTypeError:true});
  await editorWindow.keyboard.press('ControlOrMeta+a');
  await editorWindow.keyboard.insertText("export function createWebsiteCheckUI() { return {status: 'OK'}; }");
  await expect.poll(() => editorWindow.evaluate(() => {
    const native = window.__editorTestApi.getModelMarkers('/index.ts');
    const displayed = window.__editorTestApi.getState().markers.find(item => item.id === '/index.ts')?.markers || [];
    return [...native,...displayed].some(marker => /not a module|cannot find module|not assignable to type/i.test(marker.message));
  }),{timeout:15000}).toBe(false);
});
