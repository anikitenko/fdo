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

const EXAMPLE_RELATIVE_PATH = "fixtures/error-handling-plugin.fixture.ts";
const EXPECTED = {
  initLogMessage: "Error handling fixture initialized",
  uiMarkers: [
    "Fixture: Error Handling",
    "Trigger Success Handler",
    "Trigger Failure Handler",
    "UI_MESSAGE",
  ],
  handlers: ["fixture.ok", "fixture.fail"],
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
  throw new Error(`Unable to resolve SDK examples root for error fixture spec. Tried: ${preferred}, ${fallback}`);
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
  if (logs.length > 0) return logs.map((item) => String(item?.tail || "")).join("\n");
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

async function getFixtureUiSnapshot(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    return {
      text: String(doc?.body?.innerText || "").trim(),
      output: String(doc?.getElementById("fixture-error-output")?.innerText || "").trim(),
      hasSuccessButton: !!doc?.getElementById("fixture-ok-button"),
      hasFailureButton: !!doc?.getElementById("fixture-fail-button"),
    };
  });
}

async function waitForFixtureUiReady(window, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getFixtureUiSnapshot(window);
    const ready = snapshot.hasSuccessButton && snapshot.hasFailureButton && snapshot.text.includes("Fixture: Error Handling");
    if (ready) return snapshot;
    await window.waitForTimeout(180);
  }
  return getFixtureUiSnapshot(window);
}

async function clickFixtureButtonAndWait(window, buttonId, matcherExpr, timeoutMs = 9000) {
  return await window.evaluate(async ({ buttonId, matcherExpr, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", output: "" };
    const button = doc.getElementById(buttonId);
    const output = doc.getElementById("fixture-error-output");
    if (!button || !output) return { ok: false, reason: "controls_missing", output: "" };

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const outputText = String(output.textContent || "").trim();
      // eslint-disable-next-line no-new-func
      const matched = new Function("output", `return (${matcherExpr});`)(outputText);
      if (matched) return { ok: true, output: outputText };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, reason: "timeout", output: String(output.textContent || "").trim() };
  }, { buttonId, matcherExpr, timeoutMs });
}

test.describe("SDK fixture error-handling-plugin: live E2E line proof", () => {
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

  test("error-handling fixture: success/failure handlers + UI output + logs + coverage", async () => {
    test.setTimeout(200000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-fixture-error-handling-dedicated";

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

      const snapshot = await waitForFixtureUiReady(window, 30000);
      for (const marker of EXPECTED.uiMarkers) {
        expect(snapshot.text).toContain(marker);
      }

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      expect(diagnostics).toBeTruthy();
      const handlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      for (const handlerName of EXPECTED.handlers) {
        expect(handlers).toContain(handlerName);
      }

      const directOk = await invokeHandler(window, pluginName, "fixture.ok", { probe: "direct" });
      expect(directOk.ok).toBe(true);
      const directOkText = JSON.stringify(directOk);
      expect(/"ok"\s*:\s*true/i.test(directOkText)).toBe(true);
      expect(directOkText).toContain("direct");

      const directFail = await invokeHandler(window, pluginName, "fixture.fail", {});
      const directFailText = JSON.stringify(directFail);
      expect(/Intentional fixture handler failure|fixture\.fail|error/i.test(directFailText)).toBe(true);

      const successClick = await clickFixtureButtonAndWait(
        window,
        "fixture-ok-button",
        "output.includes('\"ok\": true') && output.includes('fixture-ui')"
      );
      expect(successClick.ok, JSON.stringify(successClick)).toBe(true);

      const failClick = await clickFixtureButtonAndWait(
        window,
        "fixture-fail-button",
        "output.includes('Intentional fixture handler failure') || output.includes('error')"
      );
      expect(failClick.ok, JSON.stringify(failClick)).toBe(true);

      const uiState = await getPluginUiState(window, pluginName);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Error rendering plugin/i);
      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.hostOverlayVisible).toBe(false);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 8, maxChars: 180000 });
      const combinedLog = toTailText(logTail);
      expect(combinedLog).toMatch(/plugin\.init\.success|plugin\.handler\.start|ui\.message\.response\.(success|error)|plugin\.render\.success/);
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
