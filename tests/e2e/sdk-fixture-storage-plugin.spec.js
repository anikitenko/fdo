const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { createCoverageMap } = require("istanbul-lib-coverage");
const {
  launchElectronApp,
  closeElectronApp,
  clearToastLog,
  dismissBlueprintOverlays,
} = require("./helpers/electronApp");
const {
  discoverSdkExampleEntries,
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

const EXAMPLE_RELATIVE_PATH = "fixtures/storage-plugin.fixture.ts";
const EXPECTED = {
  uiMarkers: [
    "Fixture: Storage",
    "Fixture handler version:",
    "storageFixture.v2.*",
    "Refresh Snapshot",
    "Save Theme: dark",
    "Record Session Action",
  ],
  handlers: [
    "storageFixture.v2.getSnapshot",
    "storageFixture.v2.savePreference",
    "storageFixture.v2.recordAction",
  ],
  coverageMinimums: {
    lines: 80,
    statements: 80,
    functions: 70,
  },
};

function resolveExamplesRootForThisSpec() {
  const preferred = path.resolve(process.cwd(), "../fdo-sdk/examples");
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) {
    return preferred;
  }
  const fallback = path.resolve(process.cwd(), "vendor/fdo-sdk/examples");
  if (fs.existsSync(fallback) && fs.statSync(fallback).isDirectory()) {
    return fallback;
  }
  throw new Error(`Unable to resolve SDK examples root for storage fixture spec. Tried: ${preferred}, ${fallback}`);
}

function normalizeUiMessageResponse(response) {
  if (response && typeof response === "object" && "ok" in response) {
    if ("result" in response) {
      return {
        ok: !!response.ok,
        result: response.result,
        error: response.error || "",
        code: response.code || "",
        correlationId: response.correlationId || "",
      };
    }
    const { ok, code, correlationId, ...payload } = response;
    return {
      ok: !!ok,
      result: payload,
      error: response.error || "",
      code: code || "",
      correlationId: correlationId || "",
    };
  }
  if (response && typeof response === "object" && "success" in response && !("error" in response)) {
    return { ok: true, result: response, error: "", code: "", correlationId: "" };
  }
  return { ok: true, result: response, error: "", code: "", correlationId: "" };
}

function toTailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

async function invokeHandler(window, pluginId, handler, content = {}) {
  const raw = await window.evaluate(async ({ pluginId, handler, content }) => {
    return await window.electron.plugin.uiMessage(pluginId, { handler, content });
  }, { pluginId, handler, content });
  return normalizeUiMessageResponse(raw);
}

async function getSourceCoverageMetrics(window, pluginName, sourceAbsPath) {
  const response = await invokeHandler(window, pluginName, "__e2e.getCoverage", {});
  expect(response?.ok).toBe(true);
  const rawCoverage = response?.result?.coverage || response?.result || {};
  const coverageMap = createCoverageMap(rawCoverage);
  const fileCoverage = coverageMap.fileCoverageFor(sourceAbsPath);
  const summary = fileCoverage.toSummary();
  return {
    lines: Number(summary?.lines?.pct ?? 0),
    statements: Number(summary?.statements?.pct ?? 0),
    functions: Number(summary?.functions?.pct ?? 0),
  };
}

async function waitForStorageUiReady(window, pluginName, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const uiState = await getPluginUiState(window, pluginName);
    const iframeText = String(uiState?.iframeText || "");
    if (iframeText.includes("Fixture: Storage") && iframeText.includes("storageFixture.v2.*")) {
      return uiState;
    }
    await window.waitForTimeout(180);
  }
  return getPluginUiState(window, pluginName);
}

async function clickFixtureButton(window, buttonId) {
  return await window.evaluate(({ buttonId }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const button = doc?.getElementById(buttonId);
    if (!button) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, { buttonId });
}

async function readFixtureOutput(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const output = doc?.getElementById("storage-output");
    return String(output?.textContent || "").trim();
  });
}

async function waitForOutputJson(window, predicateExpr, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const outputText = await readFixtureOutput(window);
    try {
      const parsed = JSON.parse(outputText);
      // eslint-disable-next-line no-new-func
      const matched = new Function("data", `return (${predicateExpr});`)(parsed);
      if (matched) {
        return { ok: true, text: outputText, data: parsed };
      }
    } catch (_) {}
    await window.waitForTimeout(120);
  }
  return { ok: false, text: await readFixtureOutput(window), data: null };
}

test.describe("SDK fixture storage-plugin: live E2E line proof", () => {
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

  test("storage fixture: handlers + UI interactions + diagnostics/logs/coverage", async () => {
    test.setTimeout(200000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-fixture-storage-plugin-dedicated";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const examplesRoot = resolveExamplesRootForThisSpec();
    const entry = discoverSdkExampleEntries(examplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(entry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();

    try {
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 30000);

      const firstUiState = await waitForStorageUiReady(window, pluginName, 30000);
      const firstText = String(firstUiState?.iframeText || "");
      for (const marker of EXPECTED.uiMarkers) {
        expect(firstText).toContain(marker);
      }
      expect(firstText).not.toMatch(/Failed to render UI|Error rendering plugin/i);
      expect(firstUiState?.runtimeStatus?.loading).toBe(false);
      expect(firstUiState?.hostOverlayVisible).toBe(false);

      const controlsPresent = await window.evaluate(() => {
        const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
        const doc = iframe?.contentDocument;
        return {
          refresh: !!doc?.getElementById("storage-refresh"),
          saveTheme: !!doc?.getElementById("storage-save-theme"),
          recordAction: !!doc?.getElementById("storage-record-action"),
          output: !!doc?.getElementById("storage-output"),
        };
      });
      expect(controlsPresent.refresh).toBe(true);
      expect(controlsPresent.saveTheme).toBe(true);
      expect(controlsPresent.recordAction).toBe(true);
      expect(controlsPresent.output).toBe(true);

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 10 });
      expect(diagnostics).toBeTruthy();
      expect(diagnostics?.health?.initCount).toBeGreaterThanOrEqual(1);
      expect(diagnostics?.health?.renderCount).toBeGreaterThanOrEqual(1);
      const registeredHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      for (const handlerName of EXPECTED.handlers) {
        expect(registeredHandlers).toContain(handlerName);
      }

      const directSnapshot = await invokeHandler(window, pluginName, "storageFixture.v2.getSnapshot", {});
      expect(directSnapshot.ok).toBe(true);
      expect(Number(directSnapshot?.result?.visits || 0)).toBeGreaterThanOrEqual(1);
      expect(["persistent-json", "session-fallback"]).toContain(String(directSnapshot?.result?.storageMode || ""));

      const directSavePreference = await invokeHandler(window, pluginName, "storageFixture.v2.savePreference", { theme: "dark" });
      expect(directSavePreference.ok).toBe(true);
      expect(directSavePreference?.result?.theme).toBe("dark");

      const directRecordAction = await invokeHandler(window, pluginName, "storageFixture.v2.recordAction", { action: "storage-fixture-direct-call" });
      expect(directRecordAction.ok).toBe(true);
      expect(directRecordAction?.result?.action).toBe("storage-fixture-direct-call");

      expect(await clickFixtureButton(window, "storage-refresh")).toBe(true);
      const refreshOutput = await waitForOutputJson(window, "data && data.visits >= 1 && !!data.storageMode", 8000);
      expect(refreshOutput.ok, refreshOutput.text).toBe(true);

      expect(await clickFixtureButton(window, "storage-save-theme")).toBe(true);
      const saveThemeOutput = await waitForOutputJson(window, "data && data.theme === 'dark' && data.ok !== false", 9000);
      expect(saveThemeOutput.ok, saveThemeOutput.text).toBe(true);

      expect(await clickFixtureButton(window, "storage-record-action")).toBe(true);
      const recordActionOutput = await waitForOutputJson(window, "data && data.lastAction === 'storage-fixture-ui-click'", 9000);
      expect(recordActionOutput.ok, recordActionOutput.text).toBe(true);

      const unknownHandler = await invokeHandler(window, pluginName, "fixture.storage.ping", {});
      const unknownErrorText = `${unknownHandler?.error || ""} ${unknownHandler?.code || ""} ${JSON.stringify(unknownHandler?.result || {})}`;
      expect(/not registered|handler/i.test(unknownErrorText)).toBe(true);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 8, maxChars: 160000 });
      const combinedLog = toTailText(logTail);
      expect(combinedLog).toMatch(/plugin\.init\.success|plugin\.render\.success|plugin\.handler\.start|ui\.message\.response\.(success|error)/);
      expect(combinedLog).not.toMatch(/plugin\.render\.error|plugin\.init\.error|document is not defined/i);

      const coverage = await getSourceCoverageMetrics(window, pluginName, entry.absPath);
      expect(coverage.lines).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.lines);
      expect(coverage.statements).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.statements);
      expect(coverage.functions).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.functions);
    } finally {
      await removePlugin(window, pluginName);
    }
  });
});
