const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
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
const { getBehaviorSpec } = require("./helpers/sdkExampleBehaviorManifest");

let electronApp;
const records = [];
const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const previousCoverageEnv = process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;

const DEFAULT_THRESHOLDS = { lines: 70, statements: 70, functions: 60 };
const THRESHOLD_OVERRIDES = {
  "01-basic-plugin.ts": { lines: 55, statements: 55 },
  "03-persistence-plugin.ts": { lines: 40, statements: 40, functions: 35 },
  "04-ui-extensions-plugin.ts": { lines: 69, statements: 67 },
  "05-advanced-dom-plugin.ts": { lines: 55, statements: 55 },
  "08-privileged-actions-plugin.ts": { functions: 55 },
  "09-operator-plugin.ts": { functions: 65 },
  "dom_elements_plugin.ts": { functions: 65 },
  "fixtures/advanced-ui-plugin.fixture.ts": { lines: 55, statements: 55 },
  "fixtures/error-handling-plugin.fixture.ts": { functions: 65 },
  "fixtures/minimal-plugin.fixture.ts": { functions: 65 },
  "fixtures/operator-terraform-plugin.fixture.ts": { functions: 65 },
  "fixtures/storage-plugin.fixture.ts": { functions: 65 },
};

function resolveThresholds(relativePath) {
  return { ...DEFAULT_THRESHOLDS, ...(THRESHOLD_OVERRIDES[relativePath] || {}) };
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
    return { ok: true, result: response, error: "", code: "", details: null, correlationId: "" };
  }
  return { ok: true, result: response, error: "", code: "", details: null, correlationId: "" };
}

function tailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) return logs.map((item) => String(item?.tail || "")).join("\n");
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

function isDiagnosticsPayload(payload) {
  return !!(payload && typeof payload === "object" && payload.apiVersion && payload.capabilities && payload.health);
}

async function waitForUiMarker(window, pluginName, markers = [], timeoutMs = 20000) {
  const expected = (Array.isArray(markers) ? markers : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (expected.length === 0) {
    return "";
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getPluginUiState(window, pluginName);
    const combinedUi = `${String(state?.iframeText || "")}\n${String(state?.iframeHtml || "")}`;
    const matched = expected.find((marker) => combinedUi.includes(marker));
    if (matched) return matched;
    await window.waitForTimeout(180);
  }
  return "";
}

async function invokeHandler(window, pluginId, handler, content = {}) {
  const raw = await Promise.race([
    window.evaluate(async ({ pluginId, handler, content }) => {
      return await window.electron.plugin.uiMessage(pluginId, { handler, content });
    }, { pluginId, handler, content }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Handler timeout: ${handler}`)), 15000)),
  ]);
  return normalizeUiMessageResponse(raw);
}

async function runUiInteractionChecks(window, checks = [], timeoutMs = 5000) {
  const list = Array.isArray(checks) ? checks : [];
  const results = [];
  for (const check of list) {
    const output = await window.evaluate(async ({ check, timeoutMs }) => {
      const waitUntil = Date.now() + timeoutMs;
      const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
      const doc = iframe?.contentDocument;
      if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };

      const waitForText = async (selector, expected) => {
        while (Date.now() < waitUntil) {
          const node = doc.querySelector(selector);
          const text = String(node?.textContent || "").trim();
          if (text.includes(expected)) return { ok: true, text };
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const finalNode = doc.querySelector(selector);
        return { ok: false, text: String(finalNode?.textContent || "").trim() };
      };

      const waitForNode = async (selector) => {
        while (Date.now() < waitUntil) {
          const node = doc.querySelector(selector);
          if (node) return node;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };

      if (check?.action === "click") {
        const fields = Array.isArray(check?.fields) ? check.fields : [];
        for (const field of fields) {
          const input = await waitForNode(field?.selector || "");
          if (!input) return { ok: false, reason: "input_not_found", text: "" };
          input.value = String(field?.value || "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const btn = await waitForNode(check?.selector || "");
        if (!btn) return { ok: false, reason: "button_not_found", text: "" };
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        if (check?.targetSelector && check?.expectTextContains) {
          return await waitForText(String(check.targetSelector), String(check.expectTextContains));
        }
        return { ok: true, text: "" };
      }

      if (check?.action === "submit") {
        const fields = Array.isArray(check?.fields) ? check.fields : [];
        for (const field of fields) {
          const input = await waitForNode(field?.selector || "");
          if (!input) return { ok: false, reason: "input_not_found", text: "" };
          input.value = String(field?.value || "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const form = await waitForNode(check?.formSelector || "");
        if (!form) return { ok: false, reason: "form_not_found", text: "" };
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (check?.targetSelector && check?.expectTextContains) {
          return await waitForText(String(check.targetSelector), String(check.expectTextContains));
        }
        return { ok: true, text: "" };
      }

      return { ok: false, reason: "unknown_action", text: "" };
    }, { check, timeoutMs: Number(check?.timeoutMs || timeoutMs) });
    results.push({ id: String(check?.id || "ui-check"), ...output });
  }
  return results;
}

function coveragePct(summary, key) {
  const total = Number(summary?.[key]?.total || 0);
  const covered = Number(summary?.[key]?.covered || 0);
  if (!Number.isFinite(total) || total <= 0) return 100;
  return Math.round((covered / total) * 10000) / 100;
}

test.beforeAll(async () => {
  process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = "1";
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  try {
    const outDir = path.resolve(process.cwd(), "test-results");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "sdk-examples-per-plugin-proof.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: records.length,
      passed: records.filter((r) => r.status === "passed").length,
      failed: records.filter((r) => r.status === "failed").length,
      records,
    }, null, 2), "utf8");
  } catch (_) {}
  await closeElectronApp(electronApp);
  if (previousCoverageEnv === undefined) {
    delete process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;
  } else {
    process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = previousCoverageEnv;
  }
});

for (const entry of entries) {
  test(`Per-plugin E2E: ${entry.relativePath}`, async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = `sdk-e2e-${entry.slug}`;
    const spec = getBehaviorSpec(entry);
    const expectedHandlers = Array.isArray(spec?.handlers) ? spec.handlers : [];
    const uiMarkers = Array.isArray(spec?.uiMarkerAnyOf) ? spec.uiMarkerAnyOf : [];
    const uiInteractionChecks = Array.isArray(spec?.uiInteractionChecks) ? spec.uiInteractionChecks : [];
    const handlerExpectations = spec?.handlerExpectations || {};
    const thresholds = resolveThresholds(entry.relativePath);

    const record = {
      relativePath: entry.relativePath,
      pluginName,
      thresholds,
      matchedUiMarker: "",
      actualHandlers: [],
      invokedHandlers: [],
      uiInteractions: [],
      coverage: null,
      status: "running",
      error: "",
    };
    records.push(record);

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    try {
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 25000);

      const matchedUiMarker = await waitForUiMarker(window, pluginName, uiMarkers, 20000);
      record.matchedUiMarker = matchedUiMarker;
      if (uiMarkers.length > 0) expect(!!matchedUiMarker).toBe(true);

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      expect(diagnostics).toBeTruthy();
      const runtimeHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      const safeRuntimeHandlers = runtimeHandlers
        .map((name) => String(name || "").trim())
        .filter(Boolean)
        .filter((name) => !name.startsWith("__"))
        .filter((name) => name !== "requestPrivilegedAction");
      const handlers = expectedHandlers.length > 0
        ? Array.from(new Set(expectedHandlers))
        : Array.from(new Set(safeRuntimeHandlers));
      record.actualHandlers = runtimeHandlers;

      for (const handler of expectedHandlers) {
        expect(runtimeHandlers).toContain(handler);
      }

      for (const handler of handlers) {
        const payload = handlerExpectations?.[handler]?.payload || {};
        const response = await invokeHandler(window, pluginName, handler, payload);
        expect(isDiagnosticsPayload(response?.result)).toBe(false);
        record.invokedHandlers.push({ handler, ok: !!response?.ok, code: response?.code || "" });
      }

      if (uiInteractionChecks.length > 0) {
        const uiResults = await runUiInteractionChecks(window, uiInteractionChecks);
        record.uiInteractions = uiResults;
        for (const uiResult of uiResults) {
          expect(uiResult?.ok, `UI interaction failed ${entry.relativePath}: ${JSON.stringify(uiResult)}`).toBe(true);
        }
      }

      const cov = await invokeHandler(window, pluginName, "__e2e.getCoverage", {});
      expect(cov?.ok).toBe(true);
      const rawCoverage = cov?.result?.coverage || cov?.result || {};
      const coverageMap = createCoverageMap(rawCoverage);
      const fileCoverage = coverageMap.fileCoverageFor(entry.absPath);
      const summary = fileCoverage.toSummary();
      const metrics = {
        lines: coveragePct(summary, "lines"),
        statements: coveragePct(summary, "statements"),
        functions: coveragePct(summary, "functions"),
      };
      record.coverage = metrics;
      expect(metrics.lines, `${entry.relativePath} line coverage`).toBeGreaterThanOrEqual(thresholds.lines);
      expect(metrics.statements, `${entry.relativePath} statement coverage`).toBeGreaterThanOrEqual(thresholds.statements);
      expect(metrics.functions, `${entry.relativePath} function coverage`).toBeGreaterThanOrEqual(thresholds.functions);

      const uiState = await getPluginUiState(window, pluginName);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Error rendering plugin/i);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 120000 });
      const combined = tailText(logTail);
      expect(combined).not.toMatch(/plugin\.render\.error|plugin\.init\.error|document is not defined/i);

      record.status = "passed";
    } catch (error) {
      record.status = "failed";
      record.error = error?.message || String(error);
      throw error;
    } finally {
      await removePlugin(window, pluginName);
    }
  });
}
