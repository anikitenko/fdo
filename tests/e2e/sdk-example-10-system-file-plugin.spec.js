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

const EXAMPLE_RELATIVE_PATH = "10-system-file-plugin.ts";
const EXPECTED = {
  metadata: {
    name: "SystemFilePlugin",
    version: "1.0.0",
    author: "FDO Team",
    description: "Demonstrates low-level scoped filesystem mutation for a system file other than /etc/hosts.",
    icon: "document-share",
  },
  handler: "systemFile.v1.buildMotdDryRunRequest",
  uiMarkers: [
    "Generic System File Mutation Demo",
    "This example is the next logical step after",
    "08-privileged-actions-plugin.ts",
    "system.fs.mutate",
    "/etc/motd",
    "system.fs.scope.etc-motd",
    "Preview MOTD Update",
  ],
  coverageMinimums: {
    lines: 80,
    statements: 80,
    functions: 65,
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
  throw new Error(`Unable to resolve SDK examples root for 10 spec. Tried: ${preferred}, ${fallback}`);
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

async function invokePrivilegedAction(window, pluginId, request = {}) {
  return invokeHandler(window, pluginId, "requestPrivilegedAction", request);
}

async function setPluginCapabilities(window, pluginId, capabilities) {
  const result = await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
  expect(result?.success).toBe(true);
}

async function upsertEtcMotdScope(window, pluginId) {
  const result = await window.evaluate(async ({ pluginId }) => {
    if (typeof window.electron?.plugin?.upsertPluginCustomFilesystemScope !== "function") {
      return { success: false, error: "upsertPluginCustomFilesystemScope is unavailable" };
    }
    return await window.electron.plugin.upsertPluginCustomFilesystemScope(pluginId, {
      scope: "etc-motd",
      title: "Etc MOTD Scope",
      allowedRoots: ["/etc"],
      allowedOperationTypes: ["writeFile", "appendFile", "mkdir", "rename", "remove"],
      requireConfirmation: true,
      description: "Controlled mutations under /etc for MOTD-related workflows.",
    });
  }, { pluginId });
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

async function get10UiSnapshot(window) {
  return await window.evaluate(() => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    const output = String(doc?.getElementById("system-file-result")?.innerText || "").trim();
    const runButton = doc?.getElementById("run-system-file-action");
    const iframeText = String(doc?.body?.innerText || "").trim();
    return {
      iframeText,
      output,
      hasRunButton: !!runButton,
    };
  });
}

async function waitFor10UiReady(window, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await get10UiSnapshot(window);
    const ready = snapshot.hasRunButton && snapshot.iframeText.includes("Generic System File Mutation Demo");
    if (ready) {
      return snapshot;
    }
    await window.waitForTimeout(180);
  }
  return get10UiSnapshot(window);
}

async function clickRunAndWait(window, matcherExpr, timeoutMs = 10000) {
  return await window.evaluate(async ({ matcherExpr, timeoutMs }) => {
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const doc = iframe?.contentDocument;
    if (!doc?.body) return { ok: false, reason: "iframe_not_ready", text: "" };
    const runButton = doc.getElementById("run-system-file-action");
    const resultBox = doc.getElementById("system-file-result");
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

test.describe("SDK example 10-system-file-plugin: live E2E line proof", () => {
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

  test("10 demo: generic system.fs.mutate envelope + denied/success dry-run path", async () => {
    test.setTimeout(200000);
    const window = await electronApp.firstWindow();
    const pluginName = "sdk-e2e-10-system-file-plugin-dedicated";

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
      expect(diagnostics?.metadata?.name).toBe(EXPECTED.metadata.name);
      expect(diagnostics?.metadata?.version).toBe(EXPECTED.metadata.version);
      expect(diagnostics?.metadata?.author).toBe(EXPECTED.metadata.author);
      expect(diagnostics?.metadata?.description).toBe(EXPECTED.metadata.description);
      expect(diagnostics?.metadata?.icon).toBe(EXPECTED.metadata.icon);
      expect(diagnostics?.capabilities?.registeredHandlers || []).toContain(EXPECTED.handler);

      const envelopeResponse = await invokeHandler(window, pluginName, EXPECTED.handler, {});
      expect(envelopeResponse?.ok).toBe(true);
      expect(envelopeResponse?.result?.request?.action).toBe("system.fs.mutate");
      expect(envelopeResponse?.result?.request?.payload?.scope).toBe("etc-motd");
      expect(envelopeResponse?.result?.request?.payload?.dryRun).toBe(true);
      expect(envelopeResponse?.result?.request?.payload?.reason).toBe("preview managed motd banner update");
      expect(envelopeResponse?.result?.request?.payload?.operations).toEqual([
        {
          type: "appendFile",
          path: "/etc/motd",
          content: "\nManaged by FDO SDK example plugin\n",
          encoding: "utf8",
        },
      ]);
      expect(String(envelopeResponse?.result?.correlationId || "")).toMatch(/^etc-motd-/);

      // Denied path first (before explicit capability grants).
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 30000);
      const baseSnapshot = await waitFor10UiReady(window, 30000);
      expect(baseSnapshot.hasRunButton).toBe(true);
      for (const marker of EXPECTED.uiMarkers) {
        expect(baseSnapshot.iframeText).toContain(marker);
      }
      const deniedResult = await clickRunAndWait(
        window,
        "text.includes('\"status\": \"error\"') && (text.includes('CAPABILITY_DENIED') || text.includes('Missing required capability'))"
      );
      expect(deniedResult.ok, JSON.stringify(deniedResult)).toBe(true);

      // Grant required custom scope and capabilities.
      await upsertEtcMotdScope(window, pluginName);
      await setPluginCapabilities(window, pluginName, [
        "system.host.write",
        "system.fs.scope.etc-motd",
      ]);
      await restartPlugin(window, pluginName);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);
      await waitFor10UiReady(window, 20000);

      // After grants, UI path should execute requestPrivilegedAction with the validated request shape.
      const uiSuccessResult = await clickRunAndWait(
        window,
        "text.includes('\"status\": \"ok\"') && text.includes('\"correlationId\"')"
      );
      expect(uiSuccessResult.ok, JSON.stringify(uiSuccessResult)).toBe(true);

      // Keep explicit direct transport assertion too.
      const privilegedSuccess = await invokePrivilegedAction(window, pluginName, envelopeResponse?.result?.request || {});
      expect(privilegedSuccess?.ok).toBe(true);
      expect(privilegedSuccess?.result?.dryRun).toBe(true);
      expect(privilegedSuccess?.result?.scope).toBe("etc-motd");

      const uiState = await getPluginUiState(window, pluginName);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 4, maxChars: 30000 });
      const tailText = toTailText(logTail);

      expect(uiState?.runtimeStatus?.loaded).toBe(true);
      expect(uiState?.runtimeStatus?.ready).toBe(true);
      expect(uiState?.runtimeStatus?.inited).toBe(true);
      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.hostOverlayVisible).toBe(false);

      const combinedUi = `${String(uiState?.iframeText || "")}\n${String(uiState?.iframeHtml || "")}`;
      for (const marker of EXPECTED.uiMarkers) {
        expect(combinedUi).toContain(marker);
      }

      // Example 10 currently runs against SDK/runtime combinations where init capability aliases
      // may be reported differently. Do not require a clean init log signature here.
      expect(String(tailText)).not.toContain("plugin.render.error");

      const coverage = await getSourceCoverageMetrics(window, pluginName, entry.absPath);
      expect(coverage.lines).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.lines);
      expect(coverage.statements).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.statements);
      expect(coverage.functions).toBeGreaterThanOrEqual(EXPECTED.coverageMinimums.functions);
    } finally {
      await removePlugin(window, pluginName);
    }
  });
});
