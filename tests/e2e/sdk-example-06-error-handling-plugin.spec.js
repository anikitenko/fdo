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

const EXAMPLE_RELATIVE_PATH = "06-error-handling-plugin.ts";
const RENDER_INJECTED_ERROR = "Injected render failure for 06 e2e branch test";

const EXPECTED = {
  metadata: {
    name: "Error Handling Example",
    version: "1.0.0",
    author: "FDO SDK Team",
    description: "Demonstrates @handleError usage across init, render, and backend handlers",
    icon: "warning-sign",
  },
  initLogMessage: "ErrorHandlingPlugin initialized",
  handlers: ["simulateSuccess", "simulateError"],
  uiMarkers: [
    "Error Handling Example",
    "Backend Handler Outcomes",
    "Trigger Success Handler",
    "Trigger Error Handler",
    "What This Example Teaches",
  ],
  fallbackMarkers: [
    "Plugin Error",
    RENDER_INJECTED_ERROR,
  ],
};

const STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES = new Set([
  // Known source-map/instrumentation gaps and low-value lines for this example.
  13, 30, 177,
  39, 48, 76, 77, 78, 79, 80, 81, 82,
]);
const STRICT_COVERAGE_MINIMUMS = {
  lines: 80,
  statements: 80,
  functions: 80,
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
  throw new Error(`Unable to resolve SDK examples root for 06 spec. Tried: ${preferred}, ${fallback}`);
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

function toTailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

function getFailureMessage(result) {
  const payloadError = result?.result?.error;
  if (typeof payloadError === "string" && payloadError.trim()) return payloadError;
  if (typeof result?.error === "string" && result.error.trim()) return result.error;
  return "";
}

function extractSuccessPayload(result) {
  const candidate = result?.result;
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.received || candidate.at || candidate.ok === true) return candidate;
  if (candidate.result && typeof candidate.result === "object") return candidate.result;
  if (candidate.data && typeof candidate.data === "object") return candidate.data;
  return candidate;
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

async function clickButtonAndReadOutput(window, buttonSelector, outputSelector, timeoutMs = 8000) {
  return await window.evaluate(async ({ buttonSelector, outputSelector, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };
    const button = doc.querySelector(buttonSelector);
    const output = doc.querySelector(outputSelector);
    if (!button) return { ok: false, reason: "button_not_found", text: "" };
    if (!output) return { ok: false, reason: "output_not_found", text: "" };

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const until = Date.now() + Number(timeoutMs || 8000);
    while (Date.now() < until) {
      const text = String(output.textContent || "").trim();
      if (text && text !== "Running...") {
        return { ok: true, text };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: true, text: String(output.textContent || "").trim() };
  }, { buttonSelector, outputSelector, timeoutMs });
}

async function isPrivilegedDialogOpen(window) {
  return await window.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll(".bp6-dialog"));
    return dialogs.some((dialog) => String(dialog?.innerText || "").includes("Privileged Action Failed"));
  });
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
    "render(): string {\n    return `",
    `render(): string {\n    throw new Error("${RENDER_INJECTED_ERROR}");\n    return \``
  );
  if (source === original) {
    throw new Error(`Failed to inject render-catch mode into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-e2e-06-render-catch-"));
  const outFile = path.join(tempDir, "06-error-handling-plugin.injected.ts");
  fs.writeFileSync(outFile, source, "utf8");

  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/render-catch/${baseEntry.relativePath}`,
      slug: "fault-injected-render-catch-06-error-handling-plugin",
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 06-error-handling-plugin: live E2E line proof", () => {
  test.beforeAll(async () => {
    process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = "1";
    electronApp = await launchElectronApp(electron);
  });

  test.afterAll(async () => {
    process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE = previousCoverageEnv;
    await closeElectronApp(electronApp);
  });

  test("base behavior: UI + handlers + logs + non-privileged failure UX", async () => {
    const window = await electronApp.firstWindow();
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);

    const examplesRoot = resolveExamplesRootForThisSpec();
    const entries = discoverSdkExampleEntries(examplesRoot);
    const baseEntry = entries.find((entry) => entry.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find ${EXAMPLE_RELATIVE_PATH} under ${examplesRoot}`).toBeTruthy();

    let pluginName = "";
    try {
      pluginName = `sdk-e2e-${baseEntry.slug}`;
      await removePlugin(window, pluginName);
      const deployed = await deploySdkExample(window, baseEntry, { pluginName });
      pluginName = deployed.pluginName;

      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const diagnostics = await waitForHandlersRegistered(window, pluginName, EXPECTED.handlers, 20000);
      expect(diagnostics).toBeTruthy();

      const marker = await waitForAnyUiMarker(window, pluginName, EXPECTED.uiMarkers, 15000);
      expect(marker).toBeTruthy();

      const successButtonResult = await clickButtonAndReadOutput(
        window,
        "#trigger-success-handler",
        "#error-handling-result"
      );
      expect(successButtonResult.ok, `Success button failed: ${successButtonResult.reason || "unknown"}`).toBe(true);
      expect(successButtonResult.text.includes('"ok": true')).toBe(true);
      expect(successButtonResult.text.includes('"source": "ui"')).toBe(true);

      const successInvoke = await invokeHandler(window, pluginName, "simulateSuccess", { source: "e2e-direct" });
      expect(successInvoke.ok).toBe(true);
      const successPayload = extractSuccessPayload(successInvoke);
      const successText = JSON.stringify(successInvoke);
      expect(
        (successPayload?.ok === true)
        || successText.includes('"ok":true')
      ).toBe(true);
      expect(
        successPayload?.received?.source === "e2e-direct"
        || successText.includes("e2e-direct")
      ).toBe(true);
      expect(
        typeof successPayload?.at === "string"
        || successText.includes('"at"')
      ).toBe(true);

      const errorButtonResult = await clickButtonAndReadOutput(
        window,
        "#trigger-error-handler",
        "#error-handling-result"
      );
      expect(errorButtonResult.ok, `Error button failed: ${errorButtonResult.reason || "unknown"}`).toBe(true);
      const errorButtonText = String(errorButtonResult.text || "");
      expect(
        errorButtonText.includes("Simulated backend handler failure")
        || errorButtonText.includes("Intentional handler exception for demo")
      ).toBe(true);
      expect(await isPrivilegedDialogOpen(window)).toBe(false);

      const errorInvoke = await invokeHandler(window, pluginName, "simulateError", {});
      const failureMessage = getFailureMessage(errorInvoke);
      const structuredFail = errorInvoke?.result && typeof errorInvoke.result === "object" && errorInvoke.result.success === false;
      const messageFail = failureMessage.includes("Simulated backend handler failure")
        || failureMessage.includes("Intentional handler exception for demo");
      expect(
        structuredFail || messageFail,
        `Expected handled backend failure response, got: ${JSON.stringify(errorInvoke)}`
      ).toBe(true);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 6, maxChars: 160000 });
      expect(logTail).toBeTruthy();
      const tailText = toTailText(logTail);
      const diagnosticsAfterFailure = await getPluginDiagnostics(window, pluginName, { attempts: 3 });
      const lastErrorMessage = String(diagnosticsAfterFailure?.health?.lastErrorMessage || "");
      const hasFailureEvidence = tailText.includes("Simulated backend handler failure")
        || tailText.includes("Intentional handler exception for demo")
        || lastErrorMessage.includes("Simulated backend handler failure")
        || lastErrorMessage.includes("Intentional handler exception for demo");
      expect(hasFailureEvidence).toBe(true);

      const coverage = await getSourceCoverageDetails(window, pluginName, baseEntry.absPath);
      assertStrictCoverageWithAllowlist(coverage);
    } finally {
      if (pluginName) {
        await removePlugin(window, pluginName);
      }
    }
  });

  test("render failure path: decorator fallback UI is shown", async () => {
    const window = await electronApp.firstWindow();
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);

    const examplesRoot = resolveExamplesRootForThisSpec();
    const entries = discoverSdkExampleEntries(examplesRoot);
    const baseEntry = entries.find((entry) => entry.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find ${EXAMPLE_RELATIVE_PATH} under ${examplesRoot}`).toBeTruthy();

    const injected = createFaultInjectedEntry(baseEntry);
    let pluginName = "";
    try {
      pluginName = `sdk-e2e-${injected.entry.slug}`;
      await removePlugin(window, pluginName);
      const deployed = await deploySdkExample(window, injected.entry, { pluginName });
      pluginName = deployed.pluginName;

      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);

      const marker = await waitForAnyUiMarker(window, pluginName, EXPECTED.fallbackMarkers, 20000);
      expect(marker).toBeTruthy();
      expect(await waitForLogContains(window, pluginName, RENDER_INJECTED_ERROR, 15000)).toBe(true);
    } finally {
      if (pluginName) {
        await removePlugin(window, pluginName);
      }
      injected.cleanup();
    }
  });
});
