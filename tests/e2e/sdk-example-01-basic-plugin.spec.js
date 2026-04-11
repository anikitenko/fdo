const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  launchElectronApp,
  closeElectronApp,
  clearToastLog,
  dismissBlueprintOverlays,
} = require("./helpers/electronApp");
const {
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
  deploySdkExample,
  waitForPluginRegistered,
  waitForPluginReady,
  waitForPluginSettled,
  selectPluginOpen,
  expectPluginUiVisible,
  waitForPluginUiRendered,
  getPluginUiState,
  getPluginDiagnostics,
  getPluginLogTail,
  removePlugin,
} = require("./helpers/sdkExamples");

let electronApp;

const EXAMPLE_RELATIVE_PATH = "01-basic-plugin.ts";
const INIT_INJECTED_ERROR = "Injected init failure for e2e branch test";
const RENDER_INJECTED_ERROR = "Injected render failure for e2e branch test";
const INIT_CATCH_SENTINEL = "__E2E_INIT_CATCH_REACHED__";
const RENDER_CATCH_SENTINEL = "__E2E_RENDER_CATCH_REACHED__";
const INIT_CATCH_UI_SENTINEL = "E2E init catch reached";

const EXPECTED = {
  metadata: {
    name: "Basic Plugin Example", // 01-basic-plugin.ts:48
    version: "1.0.0", // 01-basic-plugin.ts:49
    author: "FDO SDK Team", // 01-basic-plugin.ts:50
    description: "A minimal example demonstrating basic plugin creation and lifecycle", // 01-basic-plugin.ts:51
    icon: "cog", // 01-basic-plugin.ts:52
  },
  initLogMessage: "BasicPlugin initialized!", // 01-basic-plugin.ts:79
  renderMarkers: [
    "Welcome to Basic Plugin Example", // 01-basic-plugin.ts:109
    "Version:", // 01-basic-plugin.ts:110
    "Author:", // 01-basic-plugin.ts:111
    "A minimal example demonstrating basic plugin creation and lifecycle", // 01-basic-plugin.ts:112
    "What's Next?", // 01-basic-plugin.ts:114
    "This is a learning example. For production-oriented authoring, start from the canonical fixture set first:", // 01-basic-plugin.ts
    "Use fixtures/minimal-plugin.fixture.ts for the smallest stable scaffold", // 01-basic-plugin.ts:117
    "Use operator fixtures for kubectl, terraform, or host-specific operational tooling", // 01-basic-plugin.ts:118
    "Read docs/SAFE_PLUGIN_AUTHORING.md and docs/OPERATOR_PLUGIN_PATTERNS.md before expanding capabilities", // 01-basic-plugin.ts:119
  ],
  forbiddenFallbackMarkers: [
    "Error rendering plugin", // 01-basic-plugin.ts:130
    "An error occurred while rendering the plugin UI. Check the console for details.", // 01-basic-plugin.ts:131
    "Failed to render UI",
    "Plugin UI failed to load",
  ],
};

function toTailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

async function waitForAnyUiMarker(window, pluginName, markers = [], timeoutMs = 20000) {
  const expected = (Array.isArray(markers) ? markers : []).map((value) => String(value || "").trim()).filter(Boolean);
  if (expected.length === 0) {
    return "";
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getPluginUiState(window, pluginName);
    const combinedUi = `${String(state?.iframeText || "")}\n${String(state?.iframeHtml || "")}`;
    const match = expected.find((marker) => combinedUi.includes(marker));
    if (match) {
      return match;
    }
    await window.waitForTimeout(180);
  }
  return "";
}

function createFaultInjectedEntry(baseEntry, mode) {
  const originalSource = fs.readFileSync(baseEntry.absPath, "utf8");
  let updatedSource = originalSource;

  if (mode === "init-catch") {
    updatedSource = updatedSource.replace(
      "export default class BasicPlugin extends FDO_SDK implements FDOInterface {",
      "export default class BasicPlugin extends FDO_SDK implements FDOInterface {\n  private __e2eInitCatchReached = false;",
    );
    updatedSource = updatedSource.replace(
      'this.log("BasicPlugin initialized!");',
      `throw new Error("${INIT_INJECTED_ERROR}");`,
    );
    updatedSource = updatedSource.replace(
      "this.error(error as Error);",
      `this.error(error as Error);\n      this.__e2eInitCatchReached = true;\n      this.log("${INIT_CATCH_SENTINEL}");`,
    );
    updatedSource = updatedSource.replace(
      "<h1>Welcome to ${this._metadata.name}</h1>",
      `<h1>Welcome to \${this._metadata.name}</h1>\n          \${this.__e2eInitCatchReached ? '<p id="e2e-init-catch-sentinel">${INIT_CATCH_UI_SENTINEL}</p>' : ""}`,
    );
  } else if (mode === "render-catch") {
    updatedSource = originalSource.replace(
      "return `",
      `throw new Error("${RENDER_INJECTED_ERROR}");\n      return \``,
    );
    updatedSource = updatedSource.replace(
      "this.error(error as Error);\n      \n      return `",
      `this.error(error as Error);\n      this.log("${RENDER_CATCH_SENTINEL}");\n      return \``,
    );
  } else {
    throw new Error(`Unknown injection mode: ${mode}`);
  }

  if (updatedSource === originalSource) {
    throw new Error(`Failed to inject fault mode "${mode}" into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `fdo-e2e-${mode}-`));
  const outFile = path.join(tempDir, "01-basic-plugin.injected.ts");
  fs.writeFileSync(outFile, updatedSource, "utf8");

  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/${mode}/${baseEntry.relativePath}`,
      slug: `fault-injected-${mode}-01-basic-plugin`,
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 01-basic-plugin: live E2E line proof", () => {
  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron);
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("01-basic-plugin executes and renders exactly as authored", async () => {
    test.setTimeout(120000);

    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-01-basic-plugin-dedicated";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const entry = discoverSdkExampleEntries(sdkExamplesRoot).find(
      (candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH,
    );
    expect(entry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();

    try {
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);

      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 25000);
      const matchedMarker = await waitForAnyUiMarker(window, pluginName, EXPECTED.renderMarkers, 20000);
      expect(matchedMarker).toBeTruthy();

      const uiState = await getPluginUiState(window, pluginName);
      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 18000 });
      const tailText = toTailText(logTail);

      expect(uiState?.runtimeStatus?.loaded).toBe(true);
      expect(uiState?.runtimeStatus?.ready).toBe(true);
      expect(uiState?.runtimeStatus?.inited).toBe(true);
      expect(uiState?.runtimeStatus?.loading).toBe(false);

      expect(diagnostics?.metadata?.name).toBe(EXPECTED.metadata.name);
      expect(diagnostics?.metadata?.version).toBe(EXPECTED.metadata.version);
      expect(diagnostics?.metadata?.author).toBe(EXPECTED.metadata.author);
      expect(diagnostics?.metadata?.description).toBe(EXPECTED.metadata.description);
      expect(diagnostics?.metadata?.icon).toBe(EXPECTED.metadata.icon);

      expect(String(tailText)).not.toContain("plugin.init.error");
      expect(String(tailText)).not.toContain("plugin.render.error");

      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;
      for (const marker of EXPECTED.renderMarkers) {
        expect(combinedUi).toContain(marker);
      }
      for (const marker of EXPECTED.forbiddenFallbackMarkers) {
        expect(combinedUi).not.toContain(marker);
      }
      expect(uiState?.hostOverlayVisible).toBe(false);
    } finally {
      await removePlugin(window, pluginName);
    }
  });

  test("01-basic-plugin init() catch branch executes on init failure", async () => {
    test.setTimeout(120000);

    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-01-basic-plugin-init-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find(
      (candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH,
    );
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();

    const injected = createFaultInjectedEntry(baseEntry, "init-catch");
    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);

      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      const matchedInitCatchMarker = await waitForAnyUiMarker(window, pluginName, [INIT_CATCH_UI_SENTINEL], 25000);
      expect(matchedInitCatchMarker).toBe(INIT_CATCH_UI_SENTINEL);

      const uiState = await getPluginUiState(window, pluginName);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 18000 });
      const tailText = toTailText(logTail);
      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;

      expect(uiState?.runtimeStatus?.loaded).toBe(true);
      expect(combinedUi).toContain(INIT_CATCH_UI_SENTINEL);
      expect(String(tailText)).toMatch(
        new RegExp(`${INIT_CATCH_SENTINEL}|${INIT_INJECTED_ERROR}`),
      );
      expect(String(tailText)).not.toContain("plugin.init.error");
      expect(String(tailText)).not.toContain(EXPECTED.initLogMessage);
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("01-basic-plugin render() catch branch executes on render failure", async () => {
    test.setTimeout(120000);

    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-01-basic-plugin-render-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find(
      (candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH,
    );
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();

    const injected = createFaultInjectedEntry(baseEntry, "render-catch");
    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);

      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);

      const matchedFallback = await waitForAnyUiMarker(window, pluginName, [
        "Error rendering plugin",
        "An error occurred while rendering the plugin UI. Check the console for details.",
      ], 20000);
      expect(matchedFallback).toBeTruthy();

      const uiState = await getPluginUiState(window, pluginName);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 18000 });
      const tailText = toTailText(logTail);
      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;

      expect(String(tailText)).toContain(RENDER_CATCH_SENTINEL);
      expect(combinedUi).toContain("Error rendering plugin");
      expect(combinedUi).toContain("An error occurred while rendering the plugin UI. Check the console for details.");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });
});
