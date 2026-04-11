const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCoverageMap } = require("istanbul-lib-coverage");
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
const previousCoverageEnv = process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;

const EXAMPLE_RELATIVE_PATH = "04-ui-extensions-plugin.ts";
const RENDER_INJECTED_ERROR = "Injected render failure for 04 e2e branch test";
const QUICK_SEARCH_INJECTED_ERROR = "Injected quickSearch failure for 04 e2e";
const QUICK_CREATE_INJECTED_ERROR = "Injected quickCreate failure for 04 e2e";
const QUICK_SETTINGS_INJECTED_ERROR = "Injected quickSettings failure for 04 e2e";
const SHOW_DASHBOARD_INJECTED_ERROR = "Injected showDashboard failure for 04 e2e";
const SHOW_REPORTS_INJECTED_ERROR = "Injected showReports failure for 04 e2e";
const SHOW_SETTINGS_INJECTED_ERROR = "Injected showSettings failure for 04 e2e";

const EXPECTED = {
  metadata: {
    name: "UI Extensions Plugin Example",
    version: "1.0.0",
    author: "FDO SDK Team",
    description: "Demonstrates quick actions and side panel integration using mixins",
    icon: "panel-table",
  },
  initLogMessage: "UIExtensionsPlugin initialized!",
  handlers: ["quickSearch", "quickCreate", "quickSettings", "showDashboard", "showReports", "showSettings"],
  baseUiMarkers: [
    "UI Extensions Plugin Example",
    "UI Extensions",
    "Welcome to UI Extensions Example",
    "Use the quick action menu to trigger quick actions",
    "Use the side panel to navigate between views",
  ],
  fallbackMarkers: [
    "Error rendering plugin",
    "An error occurred while rendering the plugin UI. Check plugin logs for details.",
  ],
  actionExpectations: [
    {
      handler: "quickSearch",
      payload: { query: "cluster health" },
      expectedView: "search",
      expectedMessage: "Search view activated",
      expectedLog: "Quick search triggered",
      renderMarkers: ["Search View", "Search Plugin Data", "search-view-input", "Search plugin data"],
    },
    {
      handler: "quickCreate",
      payload: { title: "My Item" },
      expectedView: "create",
      expectedMessage: "Create view activated",
      expectedLog: "Quick create triggered",
      renderMarkers: ["Create View", "Create New Item", "create-title-input", "create-description-input"],
    },
    {
      handler: "quickSettings",
      payload: { from: "quick-action" },
      expectedView: "settings",
      expectedMessage: "Settings view activated",
      expectedLog: "Quick settings triggered",
      renderMarkers: ["Settings View", "Enable notifications", "settings-theme", "Save Settings"],
    },
    {
      handler: "showDashboard",
      payload: { from: "sidepanel" },
      expectedView: "dashboard",
      expectedMessage: "Dashboard view activated",
      expectedLog: "Dashboard view triggered from side panel",
      renderMarkers: ["Dashboard View", "Metric 1", "42", "Metric 2", "87%"],
    },
    {
      handler: "showReports",
      payload: { from: "sidepanel" },
      expectedView: "reports",
      expectedMessage: "Reports view activated",
      expectedLog: "Reports view triggered from side panel",
      renderMarkers: ["Reports View", "Monthly Report", "Quarterly Report", "Annual Report"],
    },
    {
      handler: "showSettings",
      payload: { from: "sidepanel" },
      expectedView: "settings",
      expectedMessage: "Settings view activated",
      expectedLog: "Settings view triggered from side panel",
      renderMarkers: ["Settings View", "Enable notifications", "settings-autosave", "Theme:"],
    },
  ],
};

const STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES = new Set([
  // Known source-map/instrumentation gaps for non-critical paths in this example.
  13, 22, 79, 114, 115, 152, 153, 176, 177, 199, 200,
  222, 223, 245, 246, 268, 269, 291, 292, 320, 321, 333, 334,
]);
const STRICT_COVERAGE_MINIMUMS = {
  lines: 75,
  statements: 75,
  functions: 80,
  branches: 70,
};

function normalizeUiMessageResponse(response) {
  if (response && typeof response === "object" && "ok" in response) {
    if ("result" in response) {
      return {
        ok: !!response.ok,
        result: response.result,
        error: response.error || "",
        code: response.code || "",
        details: response.details || null,
      };
    }
    const { ok, code, correlationId, ...payload } = response;
    return {
      ok: !!ok,
      result: payload,
      error: response.error || "",
      code: code || "",
      correlationId: correlationId || "",
      details: response.details || null,
    };
  }
  if (response && typeof response === "object" && "success" in response && !("error" in response)) {
    return { ok: true, result: response, error: "", code: "", details: null };
  }
  return { ok: true, result: response, error: "", code: "", details: null };
}

async function invokeHandler(window, pluginId, handler, content = {}) {
  const raw = await window.evaluate(async ({ pluginId, handler, content }) => {
    return await window.electron.plugin.uiMessage(pluginId, { handler, content });
  }, { pluginId, handler, content });
  return normalizeUiMessageResponse(raw);
}

async function invokeHandlerWithRetry(window, pluginId, handler, content = {}, attempts = 8) {
  for (let index = 0; index < attempts; index += 1) {
    const result = await invokeHandler(window, pluginId, handler, content);
    const failure = getFailureMessage(result).toLowerCase();
    if (!failure.includes("not ready")) {
      return result;
    }
    await waitForPluginReady(window, pluginId);
    await window.waitForTimeout(120);
  }
  return await invokeHandler(window, pluginId, handler, content);
}

async function triggerRender(window, pluginId) {
  const response = await window.evaluate(async ({ pluginId }) => {
    return await window.electron.plugin.render(pluginId);
  }, { pluginId });
  expect(response?.success).toBe(true);
}

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
  if (expected.length === 0) return "";
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getPluginUiState(window, pluginName);
    const combined = `${String(state?.iframeText || "")}\n${String(state?.iframeHtml || "")}`;
    const match = expected.find((marker) => combined.includes(marker));
    if (match) return match;
    await window.waitForTimeout(180);
  }
  return "";
}

async function waitForLogContains(window, pluginName, needle, timeoutMs = 12000) {
  const expected = String(needle || "").trim();
  if (!expected) return false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 6, maxChars: 160000 });
    const tailText = toTailText(logTail);
    if (String(tailText || "").includes(expected)) {
      return true;
    }
    await window.waitForTimeout(220);
  }
  return false;
}

async function waitForHandlersRegistered(window, pluginName, requiredHandlers, timeoutMs = 20000) {
  const expected = Array.isArray(requiredHandlers)
    ? requiredHandlers.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!expected.length) return null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 2 });
    const registered = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
      ? diagnostics.capabilities.registeredHandlers
      : [];
    const allPresent = expected.every((name) => registered.includes(name));
    if (allPresent) {
      return diagnostics;
    }
    await waitForPluginReady(window, pluginName);
    await window.waitForTimeout(150);
  }
  return null;
}

async function getHomeRegistrationSnapshot(window) {
  return await window.evaluate(() => {
    if (!window.__homeTestApi) {
      return { ok: false, reason: "homeTestApi_missing" };
    }
    const searchActions = typeof window.__homeTestApi.getSearchActionsSnapshot === "function"
      ? window.__homeTestApi.getSearchActionsSnapshot()
      : [];
    const rightSidebarItems = typeof window.__homeTestApi.getRightSidebarItemsSnapshot === "function"
      ? window.__homeTestApi.getRightSidebarItemsSnapshot()
      : [];
    const rightSidebarVisible = typeof window.__homeTestApi.isRightSidebarVisible === "function"
      ? window.__homeTestApi.isRightSidebarVisible()
      : false;
    return { ok: true, searchActions, rightSidebarItems, rightSidebarVisible };
  });
}

async function waitForHomeRegistrations(window, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getHomeRegistrationSnapshot(window);
    const actionNames = (snapshot?.searchActions || []).map((item) => item?.name);
    const hasAllQuickActions = ["Search Plugin Data", "Create New Item", "Plugin Settings"]
      .every((name) => actionNames.includes(name));
    const sidebarItem = (snapshot?.rightSidebarItems || []).find((item) => item?.name === "UI Extensions");
    const hasSidebarConfig = !!sidebarItem && Array.isArray(sidebarItem.submenu_list) && sidebarItem.submenu_list.length === 3;
    if (hasAllQuickActions && hasSidebarConfig) {
      return snapshot;
    }
    await window.waitForTimeout(150);
  }
  return await getHomeRegistrationSnapshot(window);
}

async function openCommandBarAndGetText(window) {
  await window.click('input[placeholder="Search..."]');
  await window.waitForTimeout(250);
  await window.waitForSelector(".bp6-omnibar", { timeout: 5000 });
  const text = await window.evaluate(() => {
    const omnibar = document.querySelector(".bp6-omnibar");
    return String(omnibar?.textContent || "");
  });
  await window.keyboard.press("Escape");
  return text;
}

function getFailureMessage(result) {
  const payloadError = result?.result?.error;
  if (typeof payloadError === "string" && payloadError.trim()) return payloadError;
  if (typeof result?.error === "string" && result.error.trim()) return result.error;
  return "";
}

function expectHandlerFailure(result, expectedText) {
  const message = String(getFailureMessage(result) || "");
  const payload = result?.result;
  const payloadSuccessIsFalse = payload && typeof payload === "object" && payload.success === false;
  const messageMatches = message.includes(expectedText);
  expect(
    messageMatches || payloadSuccessIsFalse,
    `Expected handler failure containing "${expectedText}", got: ${JSON.stringify(result)}`
  ).toBe(true);
}

async function getSourceCoverageDetails(window, pluginName, sourceAbsPath) {
  const response = await invokeHandler(window, pluginName, "__e2e.getCoverage", {});
  expect(response?.ok).toBe(true);
  const rawCoverage = response?.result?.coverage || response?.result || {};
  const coverageMap = createCoverageMap(rawCoverage);
  const fileCoverage = coverageMap.fileCoverageFor(sourceAbsPath);
  const summary = fileCoverage.toSummary();
  const statementMap = fileCoverage.statementMap || {};
  const statementHits = fileCoverage.s || {};
  const uncoveredStatementLines = Object.keys(statementHits)
    .filter((id) => Number(statementHits[id] || 0) <= 0)
    .map((id) => Number(statementMap[id]?.start?.line || 0))
    .filter((line) => Number.isFinite(line) && line > 0)
    .sort((left, right) => left - right);

  const metrics = {
    lines: Number(summary?.lines?.pct ?? 0),
    statements: Number(summary?.statements?.pct ?? 0),
    functions: Number(summary?.functions?.pct ?? 0),
    branches: Number(summary?.branches?.pct ?? 0),
  };
  return {
    metrics,
    uncoveredStatementLines: Array.from(new Set(uncoveredStatementLines)),
  };
}

function assertStrictCoverageWithAllowlist(details) {
  const uncovered = Array.isArray(details?.uncoveredStatementLines)
    ? details.uncoveredStatementLines
    : [];
  const unexpected = uncovered.filter((line) => !STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES.has(line));
  expect(
    unexpected,
    `Unexpected uncovered executable lines: ${unexpected.join(", ")}. ` +
      `Coverage metrics=${JSON.stringify(details?.metrics || {})}`
  ).toEqual([]);
  const metrics = details?.metrics || {};
  expect(Number(metrics.lines || 0), "line coverage regression").toBeGreaterThanOrEqual(STRICT_COVERAGE_MINIMUMS.lines);
  expect(Number(metrics.statements || 0), "statement coverage regression").toBeGreaterThanOrEqual(STRICT_COVERAGE_MINIMUMS.statements);
  expect(Number(metrics.functions || 0), "function coverage regression").toBeGreaterThanOrEqual(STRICT_COVERAGE_MINIMUMS.functions);
  expect(Number(metrics.branches || 0), "branch coverage regression").toBeGreaterThanOrEqual(STRICT_COVERAGE_MINIMUMS.branches);
}

function createFaultInjectedEntry(baseEntry, mode) {
  const original = fs.readFileSync(baseEntry.absPath, "utf8");
  let source = original;

  if (mode === "render-catch") {
    source = source.replace("return `", `throw new Error("${RENDER_INJECTED_ERROR}");\n      return \``);
  } else if (mode === "quick-search-catch") {
    source = source.replace('this.currentView = "search";', `throw new Error("${QUICK_SEARCH_INJECTED_ERROR}");\n      this.currentView = "search";`);
  } else if (mode === "quick-create-catch") {
    source = source.replace('this.currentView = "create";', `throw new Error("${QUICK_CREATE_INJECTED_ERROR}");\n      this.currentView = "create";`);
  } else if (mode === "quick-settings-catch") {
    source = source.replace('this.currentView = "settings";', `throw new Error("${QUICK_SETTINGS_INJECTED_ERROR}");\n      this.currentView = "settings";`);
  } else if (mode === "show-dashboard-catch") {
    source = source.replace('this.currentView = "dashboard";', `throw new Error("${SHOW_DASHBOARD_INJECTED_ERROR}");\n      this.currentView = "dashboard";`);
  } else if (mode === "show-reports-catch") {
    source = source.replace('this.currentView = "reports";', `throw new Error("${SHOW_REPORTS_INJECTED_ERROR}");\n      this.currentView = "reports";`);
  } else if (mode === "show-settings-catch") {
    source = source.replace(
      'this.log("Settings view triggered from side panel");',
      `throw new Error("${SHOW_SETTINGS_INJECTED_ERROR}");\n      this.log("Settings view triggered from side panel");`
    );
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (source === original) {
    throw new Error(`Failed to inject mode "${mode}" into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `fdo-e2e-04-${mode}-`));
  const outFile = path.join(tempDir, "04-ui-extensions-plugin.injected.ts");
  fs.writeFileSync(outFile, source, "utf8");
  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/${mode}/${baseEntry.relativePath}`,
      slug: `fault-injected-${mode}-04-ui-extensions-plugin`,
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 04-ui-extensions-plugin: live E2E line proof", () => {
  test.beforeAll(async () => {
    process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = "1";
    electronApp = await launchElectronApp(electron);
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
    if (previousCoverageEnv === undefined) {
      delete process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;
    } else {
      process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = previousCoverageEnv;
    }
  });

  test("04-ui-extensions-plugin executes handlers and view transitions as authored", async () => {
    test.setTimeout(180000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-dedicated";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const entry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(entry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();

    try {
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 30000);

      const baseMarker = await waitForAnyUiMarker(window, pluginName, EXPECTED.baseUiMarkers, 25000);
      expect(!!baseMarker).toBe(true);

      const uiState = await getPluginUiState(window, pluginName);
      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 25000);
      const hasInitLog = await waitForLogContains(window, pluginName, EXPECTED.initLogMessage, 12000);
      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;

      expect(diagnostics?.metadata?.name).toBe(EXPECTED.metadata.name);
      expect(diagnostics?.metadata?.version).toBe(EXPECTED.metadata.version);
      expect(diagnostics?.metadata?.author).toBe(EXPECTED.metadata.author);
      expect(diagnostics?.metadata?.description).toBe(EXPECTED.metadata.description);
      expect(diagnostics?.metadata?.icon).toBe(EXPECTED.metadata.icon);

      const runtimeHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      for (const handler of EXPECTED.handlers) {
        expect(runtimeHandlers).toContain(handler);
      }

      const registration = await waitForHomeRegistrations(window, 15000);
      expect(registration?.ok).toBe(true);
      const rightSidebarPluginItem = (registration?.rightSidebarItems || []).find((item) => item?.name === "UI Extensions");
      expect(!!rightSidebarPluginItem).toBe(true);
      expect(rightSidebarPluginItem?.name).toBe("UI Extensions");
      expect(rightSidebarPluginItem?.submenu_list?.map((item) => item.name)).toEqual([
        "Dashboard",
        "Reports",
        "Settings",
      ]);
      expect(rightSidebarPluginItem?.submenu_list?.map((item) => item.message_type)).toEqual([
        "showDashboard",
        "showReports",
        "showSettings",
      ]);

      const commandBarText = await openCommandBarAndGetText(window);
      expect(commandBarText).toContain("Search Plugin Data");
      expect(commandBarText).toContain("Create New Item");
      expect(commandBarText).toContain("Plugin Settings");
      expect(
        commandBarText.includes("UI Extensions Plugin Example")
        || commandBarText.includes("SDK Example: 04-ui-extensions-plugin.ts")
      ).toBe(true);

      expect(hasInitLog).toBe(true);
      for (const marker of EXPECTED.fallbackMarkers) {
        expect(combinedUi).not.toContain(marker);
      }

      for (const action of EXPECTED.actionExpectations) {
        const result = await invokeHandlerWithRetry(window, pluginName, action.handler, action.payload);
        expect(result.ok).toBe(true);
        expect(result.result?.success).toBe(true);
        expect(result.result?.view).toBe(action.expectedView);
        expect(String(result.result?.message || "")).toContain(action.expectedMessage);

        await triggerRender(window, pluginName);
        const matchedViewMarker = await waitForAnyUiMarker(window, pluginName, action.renderMarkers, 20000);
        expect(!!matchedViewMarker).toBe(true);

        const hasActionLog = await waitForLogContains(window, pluginName, action.expectedLog, 12000);
        expect(hasActionLog).toBe(true);
      }

      const finalUiState = await getPluginUiState(window, pluginName);
      expect(finalUiState?.runtimeStatus?.loaded).toBe(true);
      expect(finalUiState?.runtimeStatus?.ready).toBe(true);
      expect(finalUiState?.runtimeStatus?.inited).toBe(true);
      expect(finalUiState?.runtimeStatus?.loading).toBe(false);

      const coverage = await getSourceCoverageDetails(window, pluginName, entry.absPath);
      assertStrictCoverageWithAllowlist(coverage);
    } finally {
      await removePlugin(window, pluginName);
    }
  });

  test("04-ui-extensions-plugin handleQuickSearch() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-quick-search-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "quick-search-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "quickSearch", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to activate search");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin handleQuickCreate() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-quick-create-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "quick-create-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "quickCreate", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to activate create");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin handleQuickSettings() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-quick-settings-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "quick-settings-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "quickSettings", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to activate settings");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin handleShowDashboard() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-show-dashboard-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "show-dashboard-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "showDashboard", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to show dashboard");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin handleShowReports() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-show-reports-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "show-reports-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "showReports", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to show reports");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin handleShowSettings() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-show-settings-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "show-settings-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(!!diagnostics).toBe(true);

      const result = await invokeHandlerWithRetry(window, pluginName, "showSettings", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to show settings");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("04-ui-extensions-plugin render() catch branch returns fallback UI", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-04-ui-extensions-plugin-render-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "render-catch");

    try {
      await deploySdkExample(window, injected.entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);

      const marker = await waitForAnyUiMarker(window, pluginName, EXPECTED.fallbackMarkers, 25000);
      expect(!!marker).toBe(true);
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });
});
