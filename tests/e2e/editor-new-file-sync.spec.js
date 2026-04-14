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
