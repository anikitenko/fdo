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

const EXAMPLE_RELATIVE_PATH = "02-interactive-plugin.ts";
const RENDER_INJECTED_ERROR = "Injected render failure for 02 e2e branch test";
const INCREMENT_INJECTED_ERROR = "Injected increment failure for 02 e2e branch test";
const DECREMENT_INJECTED_ERROR = "Injected decrement failure for 02 e2e branch test";
const SUBMIT_INJECTED_ERROR = "Injected submit failure for 02 e2e branch test";

const EXPECTED = {
  metadata: {
    name: "Interactive Plugin Example",
    version: "1.0.0",
    author: "FDO SDK Team",
    description: "Demonstrates interactive UI with buttons, forms, and message handlers",
    icon: "widget-button",
  },
  initLogMessage: "InteractivePlugin initialized!",
  handlers: ["incrementCounter", "decrementCounter", "submitForm"],
  uiMarkers: ["Interactive Plugin Example", "Counter Example", "Form Example", "Key Concepts"],
  fallbackMarkers: ["Error rendering plugin", "An error occurred while rendering the plugin UI. Check plugin logs for details."],
};

const STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES = new Set([
  // Known non-critical/unreachable in the base path due current example structure and sourcemap mapping.
  13, 22, 73, 92, 93, 115, 116, 145, 146, 226, 227,
]);
const STRICT_COVERAGE_MINIMUMS = {
  lines: 82,
  statements: 81,
  functions: 88,
  branches: 82,
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

async function clickInIframeAndRead(window, pluginName, options) {
  return await window.evaluate(async ({ pluginName, buttonSelector, targetSelector, waitMs }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true") || null;
    const doc = iframe?.contentDocument;
    if (!iframe) return { ok: false, reason: "plugin_iframe_not_found", text: "" };
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };
    const until = Date.now() + Number(waitMs || 6000);

    let button = doc.querySelector(buttonSelector);
    let target = doc.querySelector(targetSelector);
    while ((!button || !target) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      button = doc.querySelector(buttonSelector);
      target = doc.querySelector(targetSelector);
    }
    if (!button) return { ok: false, reason: "button_not_found", text: "" };
    if (!target) return { ok: false, reason: "target_not_found", text: "" };

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const outputUntil = Date.now() + Number(waitMs || 6000);
    while (Date.now() < outputUntil) {
      const text = String(target.textContent || "").trim();
      if (text.length > 0) return { ok: true, text };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: true, text: String(target.textContent || "").trim() };
  }, {
    pluginName,
    buttonSelector: options.buttonSelector,
    targetSelector: options.targetSelector,
    waitMs: Number(options.waitMs || 6000),
  });
}

async function submitFormInIframe(window, pluginName, options) {
  return await window.evaluate(async ({ pluginName, inputSelector, inputValue, submitSelector, targetSelector, waitMs, expectTextContains }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true") || null;
    const doc = iframe?.contentDocument;
    if (!iframe) return { ok: false, reason: "plugin_iframe_not_found", text: "" };
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };

    const until = Date.now() + Number(waitMs || 7000);
    let input = doc.querySelector(inputSelector);
    let submitButton = doc.querySelector(submitSelector);
    let target = doc.querySelector(targetSelector);
    while ((!input || !submitButton || !target) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      input = doc.querySelector(inputSelector);
      submitButton = doc.querySelector(submitSelector);
      target = doc.querySelector(targetSelector);
    }
    if (!input) return { ok: false, reason: "input_not_found", text: "" };
    if (!submitButton) return { ok: false, reason: "submit_button_not_found", text: "" };
    if (!target) return { ok: false, reason: "target_not_found", text: "" };

    input.value = String(inputValue || "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const outputUntil = Date.now() + Number(waitMs || 7000);
    while (Date.now() < outputUntil) {
      const text = String(target.textContent || "").trim();
      if (expectTextContains && text.includes(expectTextContains)) return { ok: true, text };
      if (!expectTextContains && text.length > 0) return { ok: true, text };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: true, text: String(target.textContent || "").trim() };
  }, {
    pluginName,
    inputSelector: options.inputSelector,
    inputValue: options.inputValue,
    submitSelector: options.submitSelector,
    targetSelector: options.targetSelector,
    waitMs: Number(options.waitMs || 7000),
    expectTextContains: options.expectTextContains || "",
  });
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
  } else if (mode === "increment-catch") {
    source = source.replace("this.counter++;", `throw new Error("${INCREMENT_INJECTED_ERROR}");\n      this.counter++;`);
  } else if (mode === "decrement-catch") {
    source = source.replace("this.counter--;", `throw new Error("${DECREMENT_INJECTED_ERROR}");\n      this.counter--;`);
  } else if (mode === "submit-catch") {
    source = source.replace("await new Promise(resolve => setTimeout(resolve, 500));", `throw new Error("${SUBMIT_INJECTED_ERROR}");\n      await new Promise(resolve => setTimeout(resolve, 500));`);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (source === original) {
    throw new Error(`Failed to inject mode "${mode}" into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `fdo-e2e-02-${mode}-`));
  const outFile = path.join(tempDir, "02-interactive-plugin.injected.ts");
  fs.writeFileSync(outFile, source, "utf8");
  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/${mode}/${baseEntry.relativePath}`,
      slug: `fault-injected-${mode}-02-interactive-plugin`,
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 02-interactive-plugin: live E2E line proof", () => {
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

  test("02-interactive-plugin executes handlers and interactive UI as authored", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-02-interactive-plugin-dedicated";

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

      const matched = await waitForAnyUiMarker(window, pluginName, EXPECTED.uiMarkers, 25000);
      expect(!!matched).toBe(true);

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

      expect(hasInitLog).toBe(true);
      for (const marker of EXPECTED.fallbackMarkers) {
        expect(combinedUi).not.toContain(marker);
      }

      const incrementResult = await invokeHandler(window, pluginName, "incrementCounter", { source: "e2e" });
      expect(incrementResult.ok).toBe(true);
      expect(incrementResult.result?.success).toBe(true);
      expect(String(incrementResult.result?.message || "")).toContain("Counter is now");

      const decrementResult = await invokeHandler(window, pluginName, "decrementCounter", { source: "e2e" });
      expect(decrementResult.ok).toBe(true);
      expect(decrementResult.result?.success).toBe(true);
      expect(String(decrementResult.result?.message || "")).toContain("Counter is now");

      const submitResult = await invokeHandler(window, pluginName, "submitForm", { userName: "Contract E2E" });
      expect(submitResult.ok).toBe(true);
      expect(submitResult.result?.success).toBe(true);
      expect(String(submitResult.result?.message || "")).toContain("Contract E2E");
      const submitGuest = await invokeHandler(window, pluginName, "submitForm", {});
      expect(submitGuest.ok).toBe(true);
      expect(submitGuest.result?.success).toBe(true);
      expect(String(submitGuest.result?.message || "")).toContain("Welcome, Guest!");

      const incrementUi = await clickInIframeAndRead(window, pluginName, {
        buttonSelector: "#increment-counter-btn",
        targetSelector: "#counter-result",
      });
      expect(incrementUi.ok).toBe(true);
      expect(String(incrementUi.text || "")).toContain("Counter is now");

      const decrementUi = await clickInIframeAndRead(window, pluginName, {
        buttonSelector: "#decrement-counter-btn",
        targetSelector: "#counter-result",
      });
      expect(decrementUi.ok).toBe(true);
      expect(String(decrementUi.text || "")).toContain("Counter is now");

      const emptySubmit = await submitFormInIframe(window, pluginName, {
        inputSelector: "#userName",
        inputValue: "",
        submitSelector: "#submit-form-btn",
        targetSelector: "#form-result",
        expectTextContains: "Please enter your name",
      });
      expect(emptySubmit.ok, JSON.stringify(emptySubmit)).toBe(true);
      expect(String(emptySubmit.text || "")).toContain("Please enter your name");

      const filledSubmit = await submitFormInIframe(window, pluginName, {
        inputSelector: "#userName",
        inputValue: "UI Contract",
        submitSelector: "#submit-form-btn",
        targetSelector: "#form-result",
        expectTextContains: "Form submitted successfully.",
      });
      expect(filledSubmit.ok, JSON.stringify(filledSubmit)).toBe(true);
      expect(String(filledSubmit.text || "")).toContain("Form submitted successfully.");

      const coverage = await getSourceCoverageDetails(window, pluginName, entry.absPath);
      assertStrictCoverageWithAllowlist(coverage);
    } finally {
      await removePlugin(window, pluginName);
    }
  });

  test("02-interactive-plugin handleIncrement() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-02-interactive-plugin-increment-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "increment-catch");

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

      const result = await invokeHandlerWithRetry(window, pluginName, "incrementCounter", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to increment counter");

    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("02-interactive-plugin handleDecrement() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-02-interactive-plugin-decrement-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "decrement-catch");

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

      const result = await invokeHandlerWithRetry(window, pluginName, "decrementCounter", { source: "fault-test" });
      expectHandlerFailure(result, "Failed to decrement counter");

    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("02-interactive-plugin submitForm() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-02-interactive-plugin-submit-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "submit-catch");

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

      const result = await invokeHandlerWithRetry(window, pluginName, "submitForm", { userName: "Fault User" });
      expectHandlerFailure(result, "Failed to process form submission");

    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("02-interactive-plugin render() catch branch returns fallback UI", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-02-interactive-plugin-render-catch";

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
