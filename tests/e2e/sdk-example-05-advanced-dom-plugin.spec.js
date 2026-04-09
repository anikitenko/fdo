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

const EXAMPLE_RELATIVE_PATH = "05-advanced-dom-plugin.ts";
const RENDER_INJECTED_ERROR = "Injected render failure for 05 e2e branch test";

const EXPECTED = {
  metadata: {
    name: "Advanced DOM Example",
    version: "1.0.0",
    author: "FDO SDK Team",
    description: "Demonstrates advanced composition with DOM helper classes",
    icon: "widget",
  },
  initLogMessage: "AdvancedDOMPlugin initialized",
  uiMarkers: [
    "Advanced DOM Example",
    "Demonstrates advanced composition with DOM helper classes",
    "Health Table",
    "Runtime Health Snapshot",
    "Environment",
    "Status",
    "Latency",
    "Production",
    "Staging",
    "Operator Form",
    "Operator name",
    "platform-team",
    "advanced DOM helpers are useful for structured UI composition",
    "Need more details?",
    "Open plugin author docs",
  ],
  fallbackMarkers: [
    "Error rendering plugin",
    "Advanced DOM example failed to render. Check plugin logs for details.",
    "Failed to render UI",
  ],
};

const STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES = new Set([
  // Known source-map/instrumentation gaps and low-value lines for this example.
  13, 22, 167, 168, 169, 170,
]);
const STRICT_COVERAGE_MINIMUMS = {
  lines: 75,
  statements: 75,
  functions: 75,
  branches: 60,
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
  throw new Error(`Unable to resolve SDK examples root for 05 spec. Tried: ${preferred}, ${fallback}`);
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

async function getAdvancedDomSnapshot(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const byId = (id) => doc?.getElementById(id);
    const text = (selector) => String(doc?.querySelector(selector)?.textContent || "").trim();
    const attr = (selector, name) => String(doc?.querySelector(selector)?.getAttribute(name) || "");
    const style = (selector, property) => String(doc?.querySelector(selector)?.style?.[property] || "");
    const computed = (selector, property) => {
      const el = doc?.querySelector(selector);
      if (!el) return "";
      return String(globalThis.getComputedStyle(el)?.getPropertyValue(property) || "").trim();
    };
    const link = doc?.querySelector("#docs-link");
    const registerBtn = Array.from(doc?.querySelectorAll("button") || []).find((el) =>
      String(el?.textContent || "").trim() === "Register Session"
    );
    return {
      hasMain: !!doc?.querySelector("main"),
      hasHeader: !!doc?.querySelector("main > header"),
      hasFooter: !!doc?.querySelector("main > footer"),
      hasHealthTable: !!byId("health-table"),
      hasUsernameInput: !!byId("username-input"),
      usernameInputType: String(byId("username-input")?.getAttribute("type") || ""),
      usernameInputValueAttr: String(byId("username-input")?.getAttribute("value") || ""),
      usernameInputReadOnly: byId("username-input")?.hasAttribute("readonly") || false,
      usernameLabelFor: String(doc?.querySelector('label[for="username-input"]')?.getAttribute("for") || ""),
      docsLinkHref: String(link?.getAttribute("href") || ""),
      docsLinkText: String(link?.textContent || "").trim(),
      docsLinkStyleTextDecoration: style("#docs-link", "textDecoration"),
      docsLinkComputedTextDecoration: computed("#docs-link", "text-decoration-line"),
      docsLinkStyleColor: style("#docs-link", "color"),
      docsLinkComputedColor: computed("#docs-link", "color"),
      registerButtonPresent: !!registerBtn,
      registerButtonBorder: registerBtn ? String(registerBtn.style.border || "") : "",
      registerButtonBackground: registerBtn ? String(registerBtn.style.background || "") : "",
      registerButtonColor: registerBtn ? String(registerBtn.style.color || "") : "",
      helperSmallText: text("main section:nth-of-type(2) small"),
      sectionCount: (doc?.querySelectorAll("main > section") || []).length,
      tableHeaderText: text("#health-table thead tr"),
      productionRowText: text("#health-table tbody tr:nth-child(1)"),
      stagingRowText: text("#health-table tbody tr:nth-child(2)"),
      strongStatusCount: (doc?.querySelectorAll("#health-table td span[style*='font-weight']") || []).length,
      htmlLength: String(doc?.body?.innerHTML || "").length,
    };
  });
}

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
  const uncovered = Array.isArray(details?.uncoveredStatementLines) ? details.uncoveredStatementLines : [];
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

function createFaultInjectedEntry(baseEntry) {
  const original = fs.readFileSync(baseEntry.absPath, "utf8");
  const source = original.replace(
    "const content = semantic.createMain(",
    `throw new Error("${RENDER_INJECTED_ERROR}");\n      const content = semantic.createMain(`
  );
  if (source === original) {
    throw new Error(`Failed to inject render-catch mode into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-e2e-05-render-catch-"));
  const outFile = path.join(tempDir, "05-advanced-dom-plugin.injected.ts");
  fs.writeFileSync(outFile, source, "utf8");
  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/render-catch/${baseEntry.relativePath}`,
      slug: "fault-injected-render-catch-05-advanced-dom-plugin",
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 05-advanced-dom-plugin: live E2E line proof", () => {
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

  test("05-advanced-dom-plugin renders advanced DOM layout as authored", async () => {
    test.setTimeout(180000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-05-advanced-dom-plugin-dedicated";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveExamplesRootForThisSpec();
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

      const matched = await waitForAnyUiMarker(window, pluginName, EXPECTED.uiMarkers, 25000);
      expect(!!matched).toBe(true);

      const uiState = await getPluginUiState(window, pluginName);
      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 12 });
      const hasInitLog = await waitForLogContains(window, pluginName, EXPECTED.initLogMessage, 12000);
      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;

      expect(diagnostics?.metadata?.name).toBe(EXPECTED.metadata.name);
      expect(diagnostics?.metadata?.version).toBe(EXPECTED.metadata.version);
      expect(diagnostics?.metadata?.author).toBe(EXPECTED.metadata.author);
      expect(diagnostics?.metadata?.description).toBe(EXPECTED.metadata.description);
      expect(diagnostics?.metadata?.icon).toBe(EXPECTED.metadata.icon);

      expect(hasInitLog).toBe(true);
      for (const marker of EXPECTED.uiMarkers) {
        expect(combinedUi).toContain(marker);
      }
      for (const marker of EXPECTED.fallbackMarkers) {
        expect(combinedUi).not.toContain(marker);
      }

      const dom = await getAdvancedDomSnapshot(window);
      expect(dom.hasMain).toBe(true);
      expect(dom.hasHeader).toBe(true);
      expect(dom.hasFooter).toBe(true);
      expect(dom.hasHealthTable).toBe(true);
      expect(dom.hasUsernameInput).toBe(true);
      expect(dom.usernameInputType).toBe("text");
      expect(dom.usernameInputValueAttr).toBe("platform-team");
      expect(dom.usernameInputReadOnly).toBe(true);
      expect(dom.usernameLabelFor).toBe("username-input");
      expect(dom.docsLinkHref).toBe("https://docs.sdk.fdo.alexvwan.me");
      expect(dom.docsLinkText).toBe("Open plugin author docs");
      expect(
        String(dom.docsLinkStyleTextDecoration || "").includes("none")
        || String(dom.docsLinkComputedTextDecoration || "").includes("none")
      ).toBe(true);
      expect(dom.docsLinkComputedTextDecoration === "none" || dom.docsLinkComputedTextDecoration === "initial").toBe(true);
      expect(
        String(dom.docsLinkStyleColor || "").includes("11, 101, 216")
        || String(dom.docsLinkComputedColor || "").includes("11, 101, 216")
      ).toBe(true);
      expect(String(dom.docsLinkComputedColor || "")).toContain("11, 101, 216");
      expect(dom.registerButtonPresent).toBe(false);
      expect(String(dom.helperSmallText || "")).toContain("advanced DOM helpers are useful");
      expect(dom.sectionCount).toBe(2);
      expect(dom.tableHeaderText).toContain("Environment");
      expect(dom.tableHeaderText).toContain("Status");
      expect(dom.tableHeaderText).toContain("Latency");
      expect(dom.productionRowText).toContain("Production");
      expect(dom.productionRowText).toContain("Healthy");
      expect(dom.productionRowText).toContain("42ms");
      expect(dom.stagingRowText).toContain("Staging");
      expect(dom.stagingRowText).toContain("Degraded");
      expect(dom.stagingRowText).toContain("190ms");
      expect(dom.htmlLength).toBeGreaterThan(400);

      expect(uiState?.runtimeStatus?.loaded).toBe(true);
      expect(uiState?.runtimeStatus?.ready).toBe(true);
      expect(uiState?.runtimeStatus?.inited).toBe(true);
      expect(uiState?.runtimeStatus?.loading).toBe(false);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 180000 });
      const tailText = toTailText(logTail);
      expect(String(tailText)).not.toContain("plugin.render.error");
      expect(String(tailText)).not.toContain("document is not defined");

      const coverage = await getSourceCoverageDetails(window, pluginName, entry.absPath);
      assertStrictCoverageWithAllowlist(coverage);
    } finally {
      await removePlugin(window, pluginName);
    }
  });

  test("05-advanced-dom-plugin render() catch branch returns fallback UI", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-05-advanced-dom-plugin-render-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveExamplesRootForThisSpec();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry);

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
