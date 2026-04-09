const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { createCoverageMap } = require("istanbul-lib-coverage");
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
  clearToastLog,
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
  getPluginDiagnostics,
  removePlugin,
} = require("./helpers/sdkExamples");
const { getBehaviorSpec } = require("./helpers/sdkExampleBehaviorManifest");

const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const coverageRecords = [];
const prevCoverageEnv = process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;

const DEFAULT_THRESHOLDS = {
  lines: 70,
  statements: 70,
  functions: 60,
};

const THRESHOLD_OVERRIDES = {
  "01-basic-plugin.ts": { lines: 55, statements: 55 },
  "03-persistence-plugin.ts": { lines: 40, statements: 40, functions: 35 },
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
const CALIBRATE_MODE = process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE_CALIBRATE === "1";

let electronApp;

function mergeThreshold(relativePath) {
  return {
    ...DEFAULT_THRESHOLDS,
    ...(THRESHOLD_OVERRIDES[relativePath] || {}),
  };
}

function normalizeUiMessageResponse(response) {
  if (response && typeof response === "object" && "ok" in response) {
    if ("result" in response) {
      return {
        ok: !!response.ok,
        result: response.result,
        error: response.error || "",
        code: response.code || "",
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
    return { ok: true, result: response, error: "", code: "" };
  }
  return { ok: true, result: response, error: "", code: "" };
}

async function callHandler(window, pluginId, handler, content = {}) {
  const raw = await window.evaluate(async ({ pluginId, handler, content }) => {
    return await window.electron.plugin.uiMessage(pluginId, { handler, content });
  }, { pluginId, handler, content });
  return normalizeUiMessageResponse(raw);
}

function calcPct(summary, key) {
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
    fs.writeFileSync(path.join(outDir, "sdk-examples-line-coverage.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: coverageRecords.length,
      records: coverageRecords,
    }, null, 2), "utf8");
  } catch (_) {}

  await closeElectronApp(electronApp);
  if (prevCoverageEnv === undefined) {
    delete process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE;
  } else {
    process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = prevCoverageEnv;
  }
});

for (const entry of entries) {
  test(`SDK line coverage: ${entry.relativePath}`, async () => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    const pluginName = `sdk-e2e-${entry.slug}`;
    const behavior = getBehaviorSpec(entry);
    const handlerPayloads = behavior?.handlerExpectations || {};
    const thresholds = mergeThreshold(entry.relativePath);
    const record = {
      relativePath: entry.relativePath,
      pluginName,
      thresholds,
      invokedHandlers: [],
      metrics: null,
      status: "running",
      error: "",
    };
    coverageRecords.push(record);

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

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 10 });
      const runtimeHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      const behaviorHandlers = Array.isArray(behavior?.handlers) ? behavior.handlers : [];
      const handlers = Array.from(new Set([...runtimeHandlers, ...behaviorHandlers]))
        .filter((name) => !String(name || "").startsWith("__"));

      for (const handler of handlers) {
        const payload = handlerPayloads?.[handler]?.payload || {};
        const response = await callHandler(window, pluginName, handler, payload);
        record.invokedHandlers.push({ handler, ok: !!response?.ok, code: response?.code || "" });
      }

      const covResponse = await callHandler(window, pluginName, "__e2e.getCoverage", {});
      expect(covResponse?.ok).toBe(true);
      const rawCoverage = covResponse?.result?.coverage || covResponse?.result || {};
      const coverageMap = createCoverageMap(rawCoverage);
      const fileCoverage = coverageMap.fileCoverageFor(entry.absPath);
      const summary = fileCoverage.toSummary();
      const metrics = {
        lines: calcPct(summary, "lines"),
        statements: calcPct(summary, "statements"),
        functions: calcPct(summary, "functions"),
      };
      record.metrics = metrics;

      if (!CALIBRATE_MODE) {
        expect(metrics.lines, `${entry.relativePath} line coverage`).toBeGreaterThanOrEqual(thresholds.lines);
        expect(metrics.statements, `${entry.relativePath} statement coverage`).toBeGreaterThanOrEqual(thresholds.statements);
        expect(metrics.functions, `${entry.relativePath} function coverage`).toBeGreaterThanOrEqual(thresholds.functions);
      }
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
