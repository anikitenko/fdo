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

const EXAMPLE_RELATIVE_PATH = "03-persistence-plugin.ts";
const RENDER_INJECTED_ERROR = "Injected render failure for 03 e2e branch test";
const SAVE_INJECTED_ERROR = "Injected save failure for 03 e2e branch test";
const CLEAR_INJECTED_ERROR = "Injected clear failure for 03 e2e branch test";
const RECORD_INJECTED_ERROR = "Injected record failure for 03 e2e branch test";

const EXPECTED = {
  metadata: {
    name: "Persistence Plugin Example",
    version: "1.0.0",
    author: "FDO SDK Team",
    description: "Demonstrates data persistence with StoreDefault and StoreJson",
    icon: "database",
  },
  initLogMessages: ["PersistencePlugin initialized!", "Session initialized. Visit count:"],
  handlers: ["savePreferences", "clearPreferences", "recordAction"],
  uiMarkers: ["Persistence Plugin Example", "Persistent Preferences (StoreJson)", "Session Data (StoreDefault)", "Storage Concepts"],
  fallbackMarkers: ["Error rendering plugin", "An error occurred while rendering the plugin UI. Check plugin logs for details."],
};

const STRICT_COVERAGE_ALLOWED_UNCOVERED_LINES = new Set([
  // Known non-critical/unreachable in the base path due current example structure and sourcemap mapping.
  13, 22, 89, 103, 115, 136, 137, 160, 161, 188, 189, 314, 315,
]);
const STRICT_COVERAGE_MINIMUMS = {
  lines: 70,
  statements: 70,
  functions: 70,
  branches: 60,
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

function getFailureMessage(result) {
  const payloadError = result?.result?.error;
  if (typeof payloadError === "string" && payloadError.trim()) return payloadError;
  if (typeof result?.error === "string" && result.error.trim()) return result.error;
  return "";
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
    await window.waitForTimeout(200);
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

async function waitForAnyLogContains(window, pluginName, needles, timeoutMs = 12000) {
  const expected = (Array.isArray(needles) ? needles : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!expected.length) return "";
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 6, maxChars: 160000 });
    const tailText = toTailText(logTail);
    const matched = expected.find((needle) => String(tailText).includes(needle));
    if (matched) return matched;
    await window.waitForTimeout(220);
  }
  return "";
}

async function setInputValueInIframe(window, pluginName, selector, value) {
  return await window.evaluate(async ({ pluginName, selector, value }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true") || null;
    const doc = iframe?.contentDocument;
    if (!iframe) return false;
    if (!doc?.body) return false;
    const until = Date.now() + 6000;
    let input = doc.querySelector(selector);
    while (!input && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      input = doc.querySelector(selector);
    }
    if (!input) return false;
    input.value = String(value ?? "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { pluginName, selector, value });
}

async function setCheckboxInIframe(window, pluginName, selector, checked) {
  return await window.evaluate(async ({ pluginName, selector, checked }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true") || null;
    const doc = iframe?.contentDocument;
    if (!iframe) return false;
    if (!doc?.body) return false;
    const until = Date.now() + 6000;
    let input = doc.querySelector(selector);
    while (!input && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      input = doc.querySelector(selector);
    }
    if (!input) return false;
    input.checked = !!checked;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { pluginName, selector, checked });
}

async function clickAndReadInIframe(window, pluginName, options) {
  return await window.evaluate(async ({ pluginName, buttonSelector, targetSelector, waitMs, expectTextContains }) => {
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
      if (expectTextContains && text.includes(expectTextContains)) return { ok: true, text };
      if (!expectTextContains && text.length > 0) return { ok: true, text };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: true, text: String(target.textContent || "").trim() };
  }, {
    pluginName,
    buttonSelector: options.buttonSelector,
    targetSelector: options.targetSelector,
    waitMs: Number(options.waitMs || 6000),
    expectTextContains: options.expectTextContains || "",
  });
}

async function getTextInIframe(window, pluginName, selector) {
  return await window.evaluate(async ({ pluginName, selector }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true") || null;
    const doc = iframe?.contentDocument;
    if (!iframe) return "";
    if (!doc?.body) return "";
    const until = Date.now() + 6000;
    let node = doc.querySelector(selector);
    while (!node && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      node = doc.querySelector(selector);
    }
    return String(node?.textContent || "").trim();
  }, { pluginName, selector });
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
    source = source.replace(
      'const userName = this.persistentStore.get(this.KEYS.USER_NAME) || "Not set";',
      `throw new Error("${RENDER_INJECTED_ERROR}");\n      const userName = this.persistentStore.get(this.KEYS.USER_NAME) || "Not set";`
    );
  } else if (mode === "save-catch") {
    source = source.replace("this.persistentStore.set(this.KEYS.USER_NAME, data.userName);", `throw new Error("${SAVE_INJECTED_ERROR}");\n        this.persistentStore.set(this.KEYS.USER_NAME, data.userName);`);
  } else if (mode === "clear-catch") {
    source = source.replace("this.persistentStore.remove(this.KEYS.USER_NAME);", `throw new Error("${CLEAR_INJECTED_ERROR}");\n      this.persistentStore.remove(this.KEYS.USER_NAME);`);
  } else if (mode === "record-catch") {
    source = source.replace("this.tempStore.set(this.KEYS.LAST_ACTION, {", `throw new Error("${RECORD_INJECTED_ERROR}");\n      this.tempStore.set(this.KEYS.LAST_ACTION, {`);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (source === original) {
    throw new Error(`Failed to inject mode "${mode}" into ${baseEntry.relativePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `fdo-e2e-03-${mode}-`));
  const outFile = path.join(tempDir, "03-persistence-plugin.injected.ts");
  fs.writeFileSync(outFile, source, "utf8");
  return {
    entry: {
      ...baseEntry,
      absPath: outFile,
      relativePath: `fault-injected/${mode}/${baseEntry.relativePath}`,
      slug: `fault-injected-${mode}-03-persistence-plugin`,
    },
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test.describe("SDK example 03-persistence-plugin: live E2E line proof", () => {
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

  test("03-persistence-plugin executes handlers and persistence UI as authored", async () => {
    test.setTimeout(180000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-03-persistence-plugin-dedicated";

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
      const matchedInitLog = await waitForAnyLogContains(
        window,
        pluginName,
        [...EXPECTED.initLogMessages, "plugin.init.success"],
        12000
      );
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

      expect(!!matchedInitLog).toBe(true);
      for (const marker of EXPECTED.fallbackMarkers) {
        expect(combinedUi).not.toContain(marker);
      }

      const saveResult = await invokeHandler(window, pluginName, "savePreferences", {
        userName: "Contract E2E",
        theme: "dark",
        notificationsEnabled: false,
      });
      expect(saveResult.ok).toBe(true);
      expect(saveResult.result?.success).toBe(true);
      expect(String(saveResult.result?.message || "")).toContain("Preferences saved successfully");

      const recordResult = await invokeHandler(window, pluginName, "recordAction", { action: "ContractAction" });
      expect(recordResult.ok).toBe(true);
      expect(recordResult.result?.success).toBe(true);
      expect(recordResult.result?.action).toBe("ContractAction");

      const clearResult = await invokeHandler(window, pluginName, "clearPreferences", {});
      expect(clearResult.ok).toBe(true);
      expect(clearResult.result?.success).toBe(true);

      expect(await setInputValueInIframe(window, pluginName, "#userName", "UI User")).toBe(true);
      expect(await setInputValueInIframe(window, pluginName, "#theme", "dark")).toBe(true);
      expect(await setCheckboxInIframe(window, pluginName, "#notifications", false)).toBe(true);
      const saveUi = await clickAndReadInIframe(window, pluginName, {
        buttonSelector: "#save-preferences-btn",
        targetSelector: "#prefs-result",
        expectTextContains: "Preferences saved successfully",
      });
      expect(saveUi.ok).toBe(true);
      expect(String(saveUi.text || "")).toContain("Preferences saved successfully");
      expect(await getTextInIframe(window, pluginName, "#current-user-name")).toBe("UI User");
      expect(await getTextInIframe(window, pluginName, "#current-theme")).toBe("dark");
      expect(await getTextInIframe(window, pluginName, "#current-notifications")).toBe("Disabled");

      const recordUi = await clickAndReadInIframe(window, pluginName, {
        buttonSelector: "#record-action-btn",
        targetSelector: "#prefs-result",
        expectTextContains: "Action recorded.",
      });
      expect(recordUi.ok).toBe(true);
      expect(String(recordUi.text || "")).toContain("Action recorded.");
      expect(await getTextInIframe(window, pluginName, "#current-last-action")).toContain("Button Click");

      const clearUi = await clickAndReadInIframe(window, pluginName, {
        buttonSelector: "#clear-preferences-btn",
        targetSelector: "#prefs-result",
        expectTextContains: "cleared",
      });
      expect(clearUi.ok).toBe(true);
      expect(String(clearUi.text || "")).toContain("cleared");
      expect(await getTextInIframe(window, pluginName, "#current-user-name")).toBe("Not set");
      expect(await getTextInIframe(window, pluginName, "#current-theme")).toBe("light");
      expect(await getTextInIframe(window, pluginName, "#current-notifications")).toBe("Enabled");

      const coverage = await getSourceCoverageDetails(window, pluginName, entry.absPath);
      assertStrictCoverageWithAllowlist(coverage);
    } finally {
      await removePlugin(window, pluginName);
    }
  });

  test("03-persistence-plugin savePreferences() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-03-persistence-plugin-save-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "save-catch");

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

      const result = await invokeHandler(window, pluginName, "savePreferences", {
        userName: "Fault User",
        theme: "dark",
        notificationsEnabled: true,
      });
      expectHandlerFailure(result, "Failed to save preferences");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("03-persistence-plugin clearPreferences() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-03-persistence-plugin-clear-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "clear-catch");

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

      const result = await invokeHandler(window, pluginName, "clearPreferences", {});
      expectHandlerFailure(result, "Failed to clear preferences");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("03-persistence-plugin recordAction() catch branch returns structured failure", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-03-persistence-plugin-record-catch";

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    const sdkExamplesRoot = resolveSdkExamplesPath();
    const baseEntry = discoverSdkExampleEntries(sdkExamplesRoot).find((candidate) => candidate.relativePath === EXAMPLE_RELATIVE_PATH);
    expect(baseEntry, `Unable to find SDK example: ${EXAMPLE_RELATIVE_PATH}`).toBeTruthy();
    const injected = createFaultInjectedEntry(baseEntry, "record-catch");

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

      const result = await invokeHandler(window, pluginName, "recordAction", { action: "FaultAction" });
      expectHandlerFailure(result, "Failed to record action");
    } finally {
      await removePlugin(window, pluginName);
      injected.cleanup();
    }
  });

  test("03-persistence-plugin render() catch branch returns fallback UI", async () => {
    test.setTimeout(150000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-03-persistence-plugin-render-catch";

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
