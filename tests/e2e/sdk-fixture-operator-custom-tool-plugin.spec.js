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

const EXAMPLE_RELATIVE_PATH = "fixtures/operator-custom-tool-plugin.fixture.ts";
const EXPECTED = {
  handlers: [
    "customToolFixture.v2.previewRunnerStatus",
  ],
  uiMarkers: [
    "Fixture: Custom Operator Tool",
    "customToolFixture.v2.*",
    "Preview Runner Status",
    "UI_MESSAGE",
    "internal-runner",
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
  throw new Error(`Unable to resolve SDK examples root for custom tool fixture spec. Tried: ${preferred}, ${fallback}`);
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

function extractEnvelopePayload(response) {
  const root = response?.result ?? response ?? {};
  const candidates = [
    root,
    root?.request,
    root?.content,
    root?.payload,
    root?.result,
    root?.result?.request,
    root?.result?.content,
    root?.result?.payload,
  ];
  return candidates.find((item) => item && typeof item === "object" && typeof item.action === "string") || root;
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
      output: String(doc?.getElementById("custom-tool-result")?.innerText || "").trim(),
      hasPreviewButton: !!doc?.getElementById("custom-tool-preview-status"),
    };
  });
}

async function waitForFixtureUiReady(window, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getFixtureUiSnapshot(window);
    const ready = snapshot.hasPreviewButton && snapshot.text.includes("Fixture: Custom Operator Tool");
    if (ready) return snapshot;
    await window.waitForTimeout(180);
  }
  return getFixtureUiSnapshot(window);
}

async function clickButtonAndWaitOutput(window, buttonId, timeoutMs = 12000) {
  return await window.evaluate(async ({ buttonId, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const button = doc?.getElementById(buttonId);
    const output = doc?.getElementById("custom-tool-result");
    if (!button || !output) return { ok: false, reason: "controls_missing", text: "" };
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const text = String(output.textContent || "").trim();
      if (text && text !== "Building request envelope..." && text !== "Result will appear here...") {
        return { ok: true, text };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, reason: "timeout", text: String(output.textContent || "").trim() };
  }, { buttonId, timeoutMs });
}

test.describe("SDK fixture operator-custom-tool-plugin: live E2E line proof", () => {
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

  test("custom tool fixture: scoped process envelope + host path response + UI/logs/coverage", async () => {
    test.setTimeout(220000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-fixture-operator-custom-tool-dedicated";

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

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      expect(diagnostics).toBeTruthy();
      const handlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      for (const handlerName of EXPECTED.handlers) {
        expect(handlers).toContain(handlerName);
      }

      const declaredCaps = Array.isArray(diagnostics?.capabilities?.declaration?.declared)
        ? diagnostics.capabilities.declaration.declared
        : [];
      expect(declaredCaps).toContain("system.process.exec");
      expect(declaredCaps).toContain("system.process.scope.internal-runner");

      await window.evaluate(async ({ pluginName, declaredCaps }) => {
        await window.electron.plugin.setCapabilities(pluginName, declaredCaps);
      }, { pluginName, declaredCaps });

      const readySnapshot = await waitForFixtureUiReady(window, 30000);
      for (const marker of EXPECTED.uiMarkers) {
        expect(readySnapshot.text).toContain(marker);
      }

      const previewEnvelope = await invokeHandler(window, pluginName, "customToolFixture.v2.previewRunnerStatus", {});
      expect(previewEnvelope.ok).toBe(true);
      const previewEnvelopePayload = extractEnvelopePayload(previewEnvelope);
      expect(previewEnvelopePayload?.action).toBe("system.process.exec");

      const previewHost = await invokeHandler(window, pluginName, "requestPrivilegedAction", previewEnvelopePayload || {});
      expect(typeof previewHost?.ok).toBe("boolean");
      if (previewHost.ok) {
        expect(String(previewHost.correlationId || "")).not.toBe("");
      } else {
        const errText = `${previewHost?.error || ""} ${previewHost?.code || ""}`.trim();
        expect(errText.length).toBeGreaterThan(0);
      }

      const clickPreview = await clickButtonAndWaitOutput(window, "custom-tool-preview-status", 14000);
      expect(clickPreview.ok, JSON.stringify(clickPreview)).toBe(true);
      expect(/ok|error|code|correlationId|stdout|stderr/i.test(clickPreview.text)).toBe(true);

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
