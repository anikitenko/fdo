const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
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

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
  editorWindow = await openEditorWithMockedIPC(electronApp);
  await waitForWorkspaceReady(editorWindow);
}, 120000);

test.afterAll(async () => {
  await closeElectronApp(electronApp);
}, 60000);

test("metadata icon suggestions are prefix-relevant for weak fuzzy input", async () => {
  const runs = await editorWindow.evaluate(() => {
    const input = "aaaa";
    const execute = () => window.__editorTestApi.suggestBlueprintIcons(input, 5);
    return [execute(), execute(), execute(), execute(), execute()];
  });

  expect(runs.length).toBe(5);
  const first = runs[0];
  expect(Array.isArray(first)).toBe(true);
  expect(first.length).toBeGreaterThan(0);
  expect(first.every((icon) => String(icon).startsWith("a"))).toBeTruthy();
  expect(first.includes("cog")).toBeFalsy();
  for (const run of runs) {
    expect(run).toEqual(first);
  }
});

test("metadata icon suggestions do not default to unrelated values for random input", async () => {
  const suggestions = await editorWindow.evaluate(() => window.__editorTestApi.suggestBlueprintIcons("zzbzfbfb", 5));
  expect(Array.isArray(suggestions)).toBe(true);
  if (suggestions.length > 0) {
    expect(suggestions.every((icon) => String(icon).startsWith("z"))).toBeTruthy();
  }
  expect(suggestions.includes("cog")).toBeFalsy();
});

test("metadata icon suggestion defaults stay stable for empty input", async () => {
  const runs = await editorWindow.evaluate(() => {
    const execute = () => window.__editorTestApi.suggestBlueprintIcons("", 5);
    return [execute(), execute(), execute()];
  });

  expect(runs.length).toBe(3);
  expect(runs[0]).toEqual(["cog", "application", "code", "wrench", "widget"]);
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[2]).toEqual(runs[0]);
});

test("metadata icon suggestions include typo correction for meaningful input", async () => {
  const suggestions = await editorWindow.evaluate(() => window.__editorTestApi.suggestBlueprintIcons("setings", 5));
  expect(Array.isArray(suggestions)).toBe(true);
  expect(suggestions).toContain("settings");
});

test("metadata icon quick fixes are stable for invalid icon input", async () => {
  const runs = await editorWindow.evaluate(() => {
    const execute = () => window.__editorTestApi.getMetadataIconQuickFixTitles("aaaa");
    return [execute(), execute(), execute()];
  });

  expect(runs.length).toBe(3);
  expect(Array.isArray(runs[0])).toBe(true);
  expect(runs[0].length).toBeGreaterThan(0);
  expect(runs[0].some((title) => String(title).includes('Use Blueprint icon "a'))).toBeTruthy();
  expect(runs[0].some((title) => String(title).includes('"cog"'))).toBeFalsy();
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[2]).toEqual(runs[0]);
});

test("monaco live model quick fixes include relevant metadata icon suggestions", async () => {
  const source = `
    private readonly _metadata: PluginMetadata = {
      name: "Example",
      version: "1.0.0",
      author: "Test",
      description: "Demo",
      icon: "setings",
    };
  `;

  await editorWindow.evaluate((content) => {
    window.__editorTestApi.createFile("/index.ts", content, "typescript");
    window.__editorTestApi.focusEditor();
  }, source);

  await editorWindow.waitForFunction(() => {
    const markers = window.__editorTestApi.getModelMarkers("/index.ts") || [];
    return markers.some((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
  }, { timeout: 15000 });

  const triggerOk = await editorWindow.evaluate(async () => {
    const markers = window.__editorTestApi.getModelMarkers("/index.ts") || [];
    const marker = markers.find((item) => item.code === "FDO_INVALID_METADATA_ICON");
    if (marker) {
      window.__editorTestApi.setEditorPosition(
        Math.max(1, marker.startLineNumber),
        Math.max(1, marker.startColumn)
      );
    }
    return await window.__editorTestApi.triggerQuickFix();
  });
  expect(triggerOk).toBeTruthy();

  const texts = await editorWindow.evaluate(() => window.__editorTestApi.getMetadataIconQuickFixTitlesForPath("/index.ts"));
  expect(Array.isArray(texts)).toBe(true);
  expect(texts.some((text) => String(text).includes('Use Blueprint icon "settings"'))).toBeTruthy();
});

test("editor remains clickable after triggering metadata icon quick fix", async () => {
  const source = `
    private readonly _metadata: PluginMetadata = {
      name: "Example",
      version: "1.0.0",
      author: "Test",
      description: "Demo",
      icon: "zzbzfbfb",
    };
  `;

  await editorWindow.evaluate((content) => {
    window.__editorTestApi.createFile("/index.ts", content, "typescript");
    window.__editorTestApi.focusEditor();
  }, source);

  await editorWindow.waitForFunction(() => {
    const markers = window.__editorTestApi.getModelMarkers("/index.ts") || [];
    return markers.some((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
  }, { timeout: 15000 });

  const triggerOk = await editorWindow.evaluate(async () => {
    const markers = window.__editorTestApi.getModelMarkers("/index.ts") || [];
    const marker = markers.find((item) => item.code === "FDO_INVALID_METADATA_ICON");
    if (marker) {
      window.__editorTestApi.setEditorPosition(
        Math.max(1, marker.startLineNumber),
        Math.max(1, marker.startColumn)
      );
    }
    return await window.__editorTestApi.triggerQuickFix();
  });
  expect(triggerOk).toBeTruthy();

  await editorWindow.getByRole("tab", { name: "AI Coding Agent" }).click();
  await expect(editorWindow.locator('text=AI Coding Assistant')).toBeVisible({ timeout: 10000 });
});

test("tree and tab interactions stay responsive after applying metadata icon quick fix", async () => {
  const source = `
    private readonly _metadata: PluginMetadata = {
      name: "Example",
      version: "1.0.0",
      author: "Test",
      description: "Demo",
      icon: "co",
    };
    export const value = 1;
  `;

  await editorWindow.evaluate((content) => {
    window.__editorTestApi.createFile("/index.ts", content, "typescript");
    window.__editorTestApi.createFile("/notes.ts", "export const note = 'ok';", "typescript");
    window.__editorTestApi.openTabs([
      { id: "/index.ts", active: true },
      { id: "/notes.ts", active: false },
    ]);
  }, source);

  await editorWindow.waitForFunction(() => {
    const markers = window.__editorTestApi.getModelMarkers("/index.ts") || [];
    return markers.some((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
  }, { timeout: 15000 });

  const applied = await editorWindow.evaluate(() => window.__editorTestApi.applyFirstMetadataIconQuickFixForPath("/index.ts"));
  expect(applied).toBeTruthy();

  await editorWindow.waitForFunction(() => {
    const state = window.__editorTestApi.getState();
    return state?.restoreLoading === false;
  }, { timeout: 10000 });

  await editorWindow.getByRole("button", { name: "notes.ts" }).first().click();
  await editorWindow.waitForFunction(() => window.__editorTestApi.getState()?.activeTabId === "/notes.ts", { timeout: 10000 });

  await editorWindow.locator(".bp6-tree-node-content", { hasText: "index.ts" }).first().click();
  await editorWindow.waitForFunction(() => window.__editorTestApi.getState()?.selectedId === "/index.ts", { timeout: 10000 });
});
