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

const EXAMPLE_RELATIVE_PATH = "08-privileged-actions-plugin.ts";
const EXPECTED = {
  metadataName: "PrivilegedActionsPlugin",
  initLogMessage: "PrivilegedActionsPlugin initialized",
  handler: "privileged.buildDryRunRequest",
  uiMarkers: [
    "Privileged Actions Demo",
    "Run Dry-Run",
    "system.hosts.write",
    "system.fs.scope.etc-hosts",
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
  throw new Error(`Unable to resolve SDK examples root for 08 spec. Tried: ${preferred}, ${fallback}`);
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

async function setPluginCapabilities(window, pluginId, capabilities) {
  const result = await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
  expect(result?.success).toBe(true);
}

async function restartPlugin(window, pluginId) {
  const result = await window.evaluate(async ({ pluginId }) => {
    await window.electron.plugin.deactivate(pluginId);
    return await window.electron.plugin.activate(pluginId);
  }, { pluginId });
  expect(result?.success).toBe(true);
  await waitForPluginReady(window, pluginId);
  await waitForPluginSettled(window, pluginId);
}

async function get08UiSnapshot(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const resultText = String(doc?.getElementById("result-box")?.innerText || "").trim();
    const runButton = doc?.getElementById("run-privileged-action");
    const iframeText = String(doc?.body?.innerText || "").trim();
    return {
      iframeText,
      resultText,
      hasRunButton: !!runButton,
    };
  });
}

async function waitFor08UiReady(window, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await get08UiSnapshot(window);
    const ready = snapshot.hasRunButton && snapshot.iframeText.includes("Privileged Actions Demo");
    if (ready) {
      return snapshot;
    }
    await window.waitForTimeout(180);
  }
  return get08UiSnapshot(window);
}

async function clickRunDryRunAndWait(window, matcherExpr, timeoutMs = 10000) {
  return await window.evaluate(async ({ matcherExpr, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };
    const runButton = doc.getElementById("run-privileged-action");
    const resultBox = doc.getElementById("result-box");
    if (!runButton || !resultBox) return { ok: false, reason: "controls_missing", text: "" };

    runButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const text = String(resultBox.textContent || "").trim();
      // eslint-disable-next-line no-new-func
      const matched = new Function("text", `return (${matcherExpr});`)(text);
      if (matched) {
        return { ok: true, text };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, reason: "timeout", text: String(resultBox.textContent || "").trim() };
  }, { matcherExpr, timeoutMs });
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

test.describe("SDK example 08-privileged-actions-plugin: live E2E line proof", () => {
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

  test("08 demo: privileged envelope handler + UI dry-run success and denied paths", async () => {
    test.setTimeout(200000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-08-privileged-actions-plugin-dedicated";

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

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      expect(diagnostics).toBeTruthy();
      expect(diagnostics?.capabilities?.registeredHandlers || []).toContain(EXPECTED.handler);

      const envelopeResponse = await invokeHandler(window, pluginName, EXPECTED.handler, {});
      expect(envelopeResponse?.ok).toBe(true);
      expect(envelopeResponse?.result?.request?.action).toBe("system.fs.mutate");
      expect(envelopeResponse?.result?.request?.payload?.scope).toBe("etc-hosts");
      expect(envelopeResponse?.result?.request?.payload?.dryRun).toBe(true);
      expect(String(envelopeResponse?.result?.correlationId || "")).toMatch(/^etc-hosts-/);

      // Denied path first (no explicit grants in host config yet).
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 30000);
      const baseSnapshot = await waitFor08UiReady(window, 30000);
      expect(baseSnapshot.hasRunButton).toBe(true);
      for (const marker of EXPECTED.uiMarkers) {
        expect(baseSnapshot.iframeText).toContain(marker);
      }
      const deniedResult = await clickRunDryRunAndWait(
        window,
        "text.includes('\"status\": \"error\"') && (text.includes('CAPABILITY_DENIED') || text.includes('Missing required capability'))"
      );
      expect(deniedResult.ok, JSON.stringify(deniedResult)).toBe(true);

      // Grant required capabilities and verify success path.
      await setPluginCapabilities(window, pluginName, [
        "system.hosts.write",
        "system.fs.scope.etc-hosts",
      ]);
      await restartPlugin(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);
      await waitFor08UiReady(window, 20000);

      const successResult = await clickRunDryRunAndWait(
        window,
        "text.includes('\"status\": \"ok\"') && text.includes('\"dryRun\": true') && text.includes('\"scope\": \"etc-hosts\"')"
      );
      expect(successResult.ok, JSON.stringify(successResult)).toBe(true);

      const uiState = await getPluginUiState(window, pluginName);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Error rendering plugin/i);
      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.hostOverlayVisible).toBe(false);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 8, maxChars: 160000 });
      const combinedLog = toTailText(logTail);
      expect(combinedLog).toMatch(/ui\.message\.response\.success|plugin\.handler\.start/);
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
