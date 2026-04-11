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

const EXAMPLE_RELATIVE_PATH = "07-injected-libraries-demo.ts";
const EXPECTED = {
  metadataName: "Injected Libraries Demo",
  initLogMessage: "InjectedLibrariesDemoPlugin initialized!",
  handlers: [
    "demo.getPluginInfo",
    "demo.getClipboardWriteRequest",
    "demo.getClipboardReadRequest",
  ],
  buttons: [
    "show-success-btn",
    "show-error-btn",
    "show-custom-btn",
    "get-editor-content-btn",
    "read-clipboard-btn",
    "test-backend-req-btn",
    "test-wait-for-element-btn",
    "test-apply-class-btn",
  ],
  uiSections: [
    "Injected Libraries Demo",
    "1. Pure CSS Responsive Grid",
    "2. Notyf Notifications",
    "3. FontAwesome Icons",
    "4. Syntax Highlighting with Highlight.js",
    "5. ACE Code Editor",
    "6. Resizable Panels with Split Grid",
    "7. Window Helper Functions",
  ],
  coverageMinimums: {
    lines: 78,
    statements: 78,
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
  throw new Error(`Unable to resolve SDK examples root for 07 spec. Tried: ${preferred}, ${fallback}`);
}

function toTailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
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

async function setPluginCapabilities(window, pluginId, capabilities) {
  const result = await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
  expect(result?.success).toBe(true);
}

async function restartPlugin(window, pluginId) {
  await window.evaluate(async ({ pluginId }) => {
    await window.electron.plugin.deactivate(pluginId);
    return await window.electron.plugin.activate(pluginId);
  }, { pluginId });
  await waitForPluginReady(window, pluginId);
  await waitForPluginSettled(window, pluginId);
}

async function get07RuntimeSnapshot(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const computed = (selector, property) => {
      const el = doc?.querySelector(selector);
      if (!el) return "";
      return String(globalThis.getComputedStyle(el)?.getPropertyValue(property) || "").trim();
    };
    const output = String(doc?.getElementById("helper-output")?.innerText || "").trim();
    const outputClass = String(doc?.getElementById("helper-output")?.className || "");
    const buttonIds = Array.from(doc?.querySelectorAll("button[id]") || []).map((el) => el.id);
    const sectionTitles = Array.from(doc?.querySelectorAll("h3") || []).map((el) => String(el.textContent || "").trim());
    const hasAceEditorElement = !!doc?.querySelector("#editor");
    const hasGutter = !!doc?.querySelector(".gutter-col-1");
    const hasHighlightedBlock = !!doc?.querySelector("pre code.hljs");
    const pureGridDisplay = computed(".pure-g", "display");
    const purePrimaryButtonBackground = computed("#show-success-btn", "background-color");
    const highlightedBlockDisplay = computed("pre code.hljs", "display");
    const highlightedBlockBackground = computed("pre code.hljs", "background-color");
    const notyfToastCount = (doc?.querySelectorAll(".notyf__toast") || []).length;
    const iframeText = String(doc?.body?.innerText || "").trim();
    return {
      output,
      outputClass,
      buttonIds,
      sectionTitles,
      hasAceEditorElement,
      hasGutter,
      hasHighlightedBlock,
      pureGridDisplay,
      purePrimaryButtonBackground,
      highlightedBlockDisplay,
      highlightedBlockBackground,
      notyfToastCount,
      iframeText,
    };
  });
}

async function waitFor07UiReady(window, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await get07RuntimeSnapshot(window);
    const hasMinimumUi = snapshot.buttonIds.includes("show-success-btn")
      && snapshot.buttonIds.includes("test-backend-req-btn")
      && snapshot.sectionTitles.some((title) => title.includes("Window Helper Functions"));
    if (hasMinimumUi) {
      return snapshot;
    }
    await window.waitForTimeout(180);
  }
  return get07RuntimeSnapshot(window);
}

async function clickButtonAndWaitFor(window, buttonId, predicateExpr, timeoutMs = 8000) {
  return await window.evaluate(async ({ buttonId, predicateExpr, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready" };
    const button = doc.getElementById(buttonId);
    if (!button) return { ok: false, reason: `button_not_found:${buttonId}` };

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const output = String(doc.getElementById("helper-output")?.innerText || "").trim();
      const notyfCount = (doc.querySelectorAll(".notyf__toast") || []).length;
      const hasDynamic = !!doc.getElementById("dynamic-element");
      const outputClass = String(doc.getElementById("helper-output")?.className || "");
      const context = { output, notyfCount, hasDynamic, outputClass };
      // eslint-disable-next-line no-new-func
      const ok = new Function("ctx", `return (${predicateExpr});`)(context);
      if (ok) {
        return { ok: true, context };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const output = String(doc.getElementById("helper-output")?.innerText || "").trim();
    const notyfCount = (doc.querySelectorAll(".notyf__toast") || []).length;
    const hasDynamic = !!doc.getElementById("dynamic-element");
    const outputClass = String(doc.getElementById("helper-output")?.className || "");
    return { ok: false, reason: "timeout", context: { output, notyfCount, hasDynamic, outputClass } };
  }, { buttonId, predicateExpr, timeoutMs });
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

test.describe("SDK example 07-injected-libraries-demo: live E2E line proof", () => {
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

  test("07 demo: all injected-library controls are wired and truthful end-to-end", async () => {
    test.setTimeout(220000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-07-injected-libraries-demo-dedicated";

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

      // Ensure clipboard actions can execute under current host policy model.
      await setPluginCapabilities(window, pluginName, [
        "system.hosts.write",
        "system.clipboard.read",
        "system.clipboard.write",
      ]);
      await restartPlugin(window, pluginName);

      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 30000);

      const diagnostics = await getPluginDiagnostics(window, pluginName, { attempts: 14 });
      expect(diagnostics).toBeTruthy();
      expect(Array.isArray(diagnostics?.capabilities?.registeredHandlers)).toBe(true);
      for (const handlerName of EXPECTED.handlers) {
        expect(diagnostics.capabilities.registeredHandlers).toContain(handlerName);
      }

      const infoResponse = await invokeHandler(window, pluginName, "demo.getPluginInfo", { id: "contract-plugin-id" });
      expect(infoResponse?.ok).toBe(true);
      expect(infoResponse?.result?.pluginId).toBe("contract-plugin-id");
      expect(infoResponse?.result?.pluginName).toBe(EXPECTED.metadataName);
      expect(infoResponse?.result?.sdkPattern).toBe("UI_MESSAGE");

      const clipboardWriteRequest = await invokeHandler(window, pluginName, "demo.getClipboardWriteRequest", { text: "hello" });
      expect(clipboardWriteRequest?.ok).toBe(true);
      expect(clipboardWriteRequest?.result?.action).toBe("system.clipboard.write");
      expect(clipboardWriteRequest?.result?.payload?.text).toBe("hello");

      const clipboardReadRequest = await invokeHandler(window, pluginName, "demo.getClipboardReadRequest", {});
      expect(clipboardReadRequest?.ok).toBe(true);
      expect(clipboardReadRequest?.result?.action).toBe("system.clipboard.read");

      const snapshotBeforeActions = await waitFor07UiReady(window, 30000);
      for (const sectionTitle of EXPECTED.uiSections) {
        expect(snapshotBeforeActions.iframeText).toContain(sectionTitle);
      }
      for (const buttonId of EXPECTED.buttons) {
        expect(snapshotBeforeActions.buttonIds).toContain(buttonId);
      }
      expect(snapshotBeforeActions.hasAceEditorElement).toBe(true);
      expect(snapshotBeforeActions.hasGutter).toBe(true);
      expect(snapshotBeforeActions.hasHighlightedBlock).toBe(true);
      expect(snapshotBeforeActions.pureGridDisplay).toBe("flex");
      expect(snapshotBeforeActions.purePrimaryButtonBackground).toBe("rgb(0, 120, 231)");
      expect(snapshotBeforeActions.highlightedBlockDisplay).toBe("block");
      expect(snapshotBeforeActions.highlightedBlockBackground).toBe("rgb(255, 255, 255)");
      expect(snapshotBeforeActions.output).toContain("Injected Libraries Demo loaded successfully");
      expect(snapshotBeforeActions.output).toContain('"Notyf": true');
      expect(snapshotBeforeActions.output).toContain('"hljs": true');
      expect(snapshotBeforeActions.output).toContain('"ace": true');
      expect(snapshotBeforeActions.output).toContain('"Split": true');

      const successToast = await clickButtonAndWaitFor(
        window,
        "show-success-btn",
        "ctx.notyfCount >= 1"
      );
      expect(successToast.ok, JSON.stringify(successToast)).toBe(true);

      const errorToast = await clickButtonAndWaitFor(
        window,
        "show-error-btn",
        "ctx.notyfCount >= 1"
      );
      expect(errorToast.ok, JSON.stringify(errorToast)).toBe(true);

      const customToast = await clickButtonAndWaitFor(
        window,
        "show-custom-btn",
        "ctx.notyfCount >= 1"
      );
      expect(customToast.ok, JSON.stringify(customToast)).toBe(true);

      const backendReq = await clickButtonAndWaitFor(
        window,
        "test-backend-req-btn",
        "ctx.output.includes('Backend Response') && ctx.output.includes('demo-plugin')"
      );
      expect(backendReq.ok, JSON.stringify(backendReq)).toBe(true);

      const waitForElement = await clickButtonAndWaitFor(
        window,
        "test-wait-for-element-btn",
        "ctx.hasDynamic === true && ctx.output.includes('dynamically created element')"
      );
      expect(waitForElement.ok, JSON.stringify(waitForElement)).toBe(true);

      const applyClass = await clickButtonAndWaitFor(
        window,
        "test-apply-class-btn",
        "ctx.outputClass.includes('pure-button-primary') && ctx.output.includes('Class \"pure-button-primary\" applied')"
      );
      expect(applyClass.ok, JSON.stringify(applyClass)).toBe(true);

      const copyEditorContent = await clickButtonAndWaitFor(
        window,
        "get-editor-content-btn",
        "ctx.output.includes('Clipboard Response') && ctx.output.includes('\"ok\": true')"
      );
      expect(copyEditorContent.ok, JSON.stringify(copyEditorContent)).toBe(true);

      const readClipboard = await clickButtonAndWaitFor(
        window,
        "read-clipboard-btn",
        "ctx.output.includes('Clipboard Read Response') && ctx.output.includes('\"ok\": true')"
      );
      expect(readClipboard.ok, JSON.stringify(readClipboard)).toBe(true);

      await window.keyboard.press("F1");
      const f1Toast = await clickButtonAndWaitFor(
        window,
        "show-success-btn",
        "ctx.notyfCount >= 1"
      );
      expect(f1Toast.ok, JSON.stringify(f1Toast)).toBe(true);

      const uiState = await getPluginUiState(window, pluginName);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Error rendering plugin/i);
      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.hostOverlayVisible).toBe(false);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 8, maxChars: 180000 });
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
