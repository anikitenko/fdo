const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
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
const proofRecords = [];

function parsePositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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

function isDiagnosticsPayload(payload) {
  return !!(payload && typeof payload === "object" && payload.apiVersion && payload.capabilities && payload.health);
}

function toHandlerFailureText(normalized) {
  const result = normalized?.result && typeof normalized.result === "object" ? normalized.result : {};
  return [
    normalized?.error || "",
    normalized?.code || "",
    result?.error || "",
    result?.code || "",
    JSON.stringify(normalized?.details || {}),
    JSON.stringify(result?.details || {}),
  ].join("\n");
}

function getDeclaredCapabilitiesFromDiagnostics(diagnostics) {
  const candidates = [
    diagnostics?.capabilities?.declaration?.declared,
    diagnostics?.capabilityIntent?.declared,
    diagnostics?.capabilityDeclaration?.declared,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter((entry) => typeof entry === "string" && entry.trim());
    }
  }
  return [];
}

function deepGet(obj, dottedPath) {
  return String(dottedPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function pickResultPayload(normalized) {
  const result = normalized?.result && typeof normalized.result === "object" ? normalized.result : {};
  const nested = result?.result && typeof result.result === "object" ? result.result : {};
  return { result, nested, merged: { ...result, ...nested } };
}

function assertBehaviorBySpec(normalized, handlerSpec = {}) {
  const { result, nested, merged } = pickResultPayload(normalized);
  const failureText = toHandlerFailureText(normalized);

  if (handlerSpec.expectSuccess === true) {
    expect(normalized?.ok).toBe(true);
  } else if (handlerSpec.expectSuccess === false) {
    const hardFailure = normalized?.ok === false || /error|exception|failed|cancelled/i.test(failureText);
    expect(hardFailure).toBe(true);
  }

  if (Array.isArray(handlerSpec.failureAnyOf) && handlerSpec.failureAnyOf.length > 0) {
    const matched = handlerSpec.failureAnyOf.some((token) => failureText.includes(String(token)));
    expect(matched).toBe(true);
  }

  if (handlerSpec.resultPathEquals && typeof handlerSpec.resultPathEquals === "object") {
    Object.entries(handlerSpec.resultPathEquals).forEach(([key, value]) => {
      expect(deepGet(merged, key)).toEqual(value);
    });
  }

  if (handlerSpec.resultPathContains && typeof handlerSpec.resultPathContains === "object") {
    Object.entries(handlerSpec.resultPathContains).forEach(([key, value]) => {
      expect(String(deepGet(merged, key) || "")).toContain(String(value));
    });
  }

  if (Array.isArray(handlerSpec.resultPathsTruthy)) {
    handlerSpec.resultPathsTruthy.forEach((key) => {
      expect(!!deepGet(merged, key)).toBe(true);
    });
  }

  if (handlerSpec.expectPrivilegedShape) {
    const hasCorrelationId = !!(normalized?.correlationId || result?.correlationId || nested?.correlationId);
    const hasCodeOnFailure = normalized?.ok === true || !!(normalized?.code || result?.code || nested?.code);
    expect(hasCorrelationId || hasCodeOnFailure).toBe(true);
  }

  if (handlerSpec.expectWorkflowShape) {
    const workflow = nested?.result || nested || result?.result || result;
    if (normalized?.ok) {
      const hasSummary = !!(workflow?.summary || merged?.summary);
      const hasSteps = Array.isArray(workflow?.steps || merged?.steps);
      expect(hasSummary || hasSteps).toBe(true);
    } else {
      expect(failureText).toMatch(/workflow|scope|capability|cancelled|denied|failed/i);
    }
  }
}

async function setCapabilities(window, pluginId, capabilities) {
  return await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
}

async function invokeHandler(window, pluginId, handler, content = {}) {
  let last = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const raw = await Promise.race([
      window.evaluate(async ({ pluginId, handler, content }) => {
        return await window.electron.plugin.uiMessage(pluginId, { handler, content });
      }, { pluginId, handler, content }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Handler timeout: ${handler}`)), 15000)),
    ]);
    const normalized = normalizeUiMessageResponse(raw);
    last = normalized;
    if (isDiagnosticsPayload(normalized?.result)) {
      await window.waitForTimeout(120);
      continue;
    }
    const failureText = toHandlerFailureText(normalized);
    if (/not ready/i.test(failureText)) {
      await waitForPluginReady(window, pluginId);
      await window.waitForTimeout(120);
      continue;
    }
    return normalized;
  }
  return last;
}

async function resolveDiagnosticsWithHandlers(window, pluginName, expectedHandlers = []) {
  const required = Array.isArray(expectedHandlers) ? expectedHandlers : [];
  let last = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const diagnostics = await getPluginDiagnostics(window, pluginName);
    last = diagnostics;
    const handlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
      ? diagnostics.capabilities.registeredHandlers
      : [];
    const allPresent = required.every((handler) => handlers.includes(handler));
    if (allPresent) {
      return diagnostics;
    }
    await window.waitForTimeout(180);
  }
  return last;
}

function tailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

async function waitForUiMarker(window, pluginName, markers = [], timeoutMs = 20000) {
  const expected = (Array.isArray(markers) ? markers : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (expected.length === 0) {
    return { matched: "", state: await getPluginUiState(window, pluginName) };
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getPluginUiState(window, pluginName);
    const combinedUi = `${String(state?.iframeText || "")}\n${String(state?.iframeHtml || "")}`;
    const matched = expected.find((marker) => combinedUi.includes(marker));
    if (matched) {
      return { matched, state };
    }
    await window.waitForTimeout(200);
  }
  return { matched: "", state: await getPluginUiState(window, pluginName) };
}

async function runUiInteractionChecks(window, pluginName, checks = []) {
  const list = Array.isArray(checks) ? checks : [];
  const results = [];
  for (const check of list) {
    const checkId = String(check?.id || "ui-check");
    const action = String(check?.action || "").trim();
    const timeoutMs = Number(check?.timeoutMs || 5000);
    const output = await window.evaluate(async ({ check, timeoutMs }) => {
      const waitUntil = Date.now() + timeoutMs;
      const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
      const doc = iframe?.contentDocument;
      if (!doc?.body) {
        return { ok: false, reason: "iframe_not_ready", text: "" };
      }

      const waitForText = async (selector, expected) => {
        while (Date.now() < waitUntil) {
          const node = doc.querySelector(selector);
          const text = String(node?.textContent || "").trim();
          if (text.includes(expected)) {
            return { ok: true, text };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const finalNode = doc.querySelector(selector);
        return { ok: false, text: String(finalNode?.textContent || "").trim() };
      };

      if (check?.action === "click") {
        const btn = doc.querySelector(check?.selector || "");
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
          const input = doc.querySelector(field?.selector || "");
          if (!input) return { ok: false, reason: "input_not_found", text: "" };
          input.value = String(field?.value || "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const form = doc.querySelector(check?.formSelector || "");
        if (!form) return { ok: false, reason: "form_not_found", text: "" };
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (check?.targetSelector && check?.expectTextContains) {
          return await waitForText(String(check.targetSelector), String(check.expectTextContains));
        }
        return { ok: true, text: "" };
      }

      return { ok: false, reason: "unknown_action", text: "" };
    }, { check, timeoutMs });

    results.push({ id: checkId, ...output });
  }
  return results;
}

const sdkExamplesRoot = resolveSdkExamplesPath();
const allEntries = discoverSdkExampleEntries(sdkExamplesRoot);
const relativeFilter = String(process.env.FDO_E2E_SDK_EXAMPLES_FILTER || "").trim();
const maxEntries = parsePositiveInt(process.env.FDO_E2E_SDK_EXAMPLES_LIMIT, 0);
const filteredEntries = allEntries.filter((entry) => !relativeFilter || entry.relativePath.includes(relativeFilter));
const contractEntries = maxEntries > 0 ? filteredEntries.slice(0, maxEntries) : filteredEntries;

if (contractEntries.length === 0) {
  throw new Error(
    `No SDK example entries selected for contract run. root=${sdkExamplesRoot}, total=${allEntries.length}, filter="${relativeFilter}", limit=${maxEntries || "none"}`
  );
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  try {
    const outDir = path.resolve(process.cwd(), "test-results");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "sdk-examples-contract-proof.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: proofRecords.length,
      passed: proofRecords.filter((item) => item.status === "passed").length,
      failed: proofRecords.filter((item) => item.status === "failed").length,
      records: proofRecords,
    }, null, 2), "utf8");
  } catch (_) {}
  await closeElectronApp(electronApp);
});

for (const entry of contractEntries) {
  test(`SDK contract: ${entry.relativePath} backend handlers are invocable`, async () => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    const pluginName = `sdk-e2e-${entry.slug}`;
    const behaviorSpec = getBehaviorSpec(entry);
    const expectedHandlers = Array.isArray(behaviorSpec?.handlers) ? behaviorSpec.handlers : [];
    const expectedUiMarkers = Array.isArray(behaviorSpec?.uiMarkerAnyOf) ? behaviorSpec.uiMarkerAnyOf : [];
    const expectedInitLogs = Array.isArray(behaviorSpec?.initLogAnyOf) ? behaviorSpec.initLogAnyOf : [];
    const handlerExpectations = behaviorSpec?.handlerExpectations || {};
    const uiInteractionChecks = Array.isArray(behaviorSpec?.uiInteractionChecks) ? behaviorSpec.uiInteractionChecks : [];
    const testRecord = {
      relativePath: entry.relativePath,
      pluginName,
      expectedHandlers,
      actualHandlers: [],
      invokedHandlers: [],
      uiInteractionChecks: [],
      matchedUiMarker: "",
      matchedInitLog: "",
      status: "running",
      error: "",
    };

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

      const uiEvidence = await waitForUiMarker(window, pluginName, expectedUiMarkers, 25000);
      testRecord.matchedUiMarker = uiEvidence.matched || "";
      if (expectedUiMarkers.length > 0) {
        expect(!!uiEvidence.matched).toBe(true);
      }

      const diagnostics = await resolveDiagnosticsWithHandlers(window, pluginName, expectedHandlers);
      expect(diagnostics).toBeTruthy();
      const actualHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      testRecord.actualHandlers = actualHandlers;

      for (const handler of expectedHandlers) {
        expect(actualHandlers).toContain(handler);
      }
      expect(actualHandlers.length).toBe(expectedHandlers.length);

      const declaredCapabilities = getDeclaredCapabilitiesFromDiagnostics(diagnostics);
      if (declaredCapabilities.length > 0) {
        const granted = await setCapabilities(window, pluginName, declaredCapabilities);
        expect(granted?.success).toBe(true);
      }

      if (expectedInitLogs.length > 0) {
        const preInvokeTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 120000 });
        const preInvokeText = tailText(preInvokeTail);
        const matchedInitLog = expectedInitLogs.find((token) => preInvokeText.includes(String(token)));
        testRecord.matchedInitLog = matchedInitLog || "";
        expect(!!matchedInitLog).toBe(true);
      }

      for (const handler of actualHandlers) {
        const handlerSpec = handlerExpectations[handler] || {};
        const payload = handlerSpec?.payload || {};
        const normalized = await invokeHandler(window, pluginName, handler, payload);
        const failureText = toHandlerFailureText(normalized);
        expect(isDiagnosticsPayload(normalized?.result)).toBe(false);
        expect(failureText).not.toMatch(/PLUGIN_BACKEND_HANDLER_NOT_REGISTERED|PLUGIN_BACKEND_EMPTY_RESPONSE/i);
        assertBehaviorBySpec(normalized, handlerSpec);
        testRecord.invokedHandlers.push({ handler, ok: !!normalized?.ok, code: normalized?.code || "" });
      }

      if (uiInteractionChecks.length > 0) {
        const interactionResults = await runUiInteractionChecks(window, pluginName, uiInteractionChecks);
        testRecord.uiInteractionChecks = interactionResults;
        for (const result of interactionResults) {
          expect(result?.ok, `UI interaction failed for ${entry.relativePath}: ${JSON.stringify(result)}`).toBe(true);
        }
      }

      const uiState = await getPluginUiState(window, pluginName);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Error rendering plugin/i);

      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 120000 });
      const combinedLog = tailText(logTail);
      expect(combinedLog).not.toMatch(/plugin\.render\.error|plugin\.init\.error|document is not defined/i);

      testRecord.status = "passed";
      proofRecords.push(testRecord);
    } catch (error) {
      testRecord.status = "failed";
      testRecord.error = error?.message || String(error);
      proofRecords.push(testRecord);
      const diagnostics = await getPluginDiagnostics(window, pluginName).catch(() => null);
      const uiState = await getPluginUiState(window, pluginName).catch(() => null);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 120000 }).catch(() => null);
      throw new Error(`${error?.message || String(error)} diagnostics=${JSON.stringify(diagnostics)} uiState=${JSON.stringify(uiState)} logTail=${JSON.stringify(logTail)}`);
    } finally {
      await removePlugin(window, pluginName);
    }
  });
}
