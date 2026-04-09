const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  clearToastLog,
  dismissBlueprintOverlays,
  getToastLog,
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
  getPluginLogTail,
  removePlugin,
} = require("./helpers/sdkExamples");

let electronApp;

const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const entryByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));

async function openPluginFrame(window, pluginName) {
  await selectPluginOpen(window, pluginName);
  await expectPluginUiVisible(window, pluginName);
  await waitForPluginUiRendered(window, pluginName, 20000);
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
    return {
      ok: true,
      result: response,
      error: "",
      code: "",
    };
  }
  // Legacy/non-wrapped bridge responses may return the handler payload directly.
  return {
    ok: true,
    result: response,
    error: "",
    code: "",
  };
}

function tailText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

function isDiagnosticsPayload(payload) {
  return !!(payload && typeof payload === "object" && payload.apiVersion && payload.capabilities && payload.health);
}

function findUiMarker(text, markers) {
  const content = String(text || "");
  const expected = Array.isArray(markers) ? markers : [];
  return expected.find((marker) => content.includes(String(marker)));
}

async function waitForUiMarker(window, pluginName, markers, timeout = 12000) {
  const expected = (Array.isArray(markers) ? markers : []).map((item) => String(item || "")).filter(Boolean);
  await window.waitForFunction(async ({ pluginName, expected }) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    if (!status?.loaded || !status?.ready || !status?.inited || status?.loading) {
      return false;
    }
    const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
    const text = String(iframe?.contentDocument?.body?.innerText || "").trim();
    if (!text || /Error rendering plugin|Failed to render UI|Starting plugin frame/i.test(text)) {
      return false;
    }
    return expected.length === 0 || expected.some((marker) => text.includes(marker));
  }, { pluginName, expected }, { timeout });
}

async function invokeHandlerWithReadiness(window, pluginName, handler, content, attempts = 6) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const raw = await window.evaluate(async ({ pluginName, handler, content }) => {
      return await window.electron.plugin.uiMessage(pluginName, { handler, content });
    }, { pluginName, handler, content });
    const normalized = normalizeUiMessageResponse(raw);
    const result = normalized?.result;
    last = normalized;

    const notReady = !!(result?.success === false && /not ready/i.test(String(result?.error || "")));
    if (notReady) {
      await waitForPluginReady(window, pluginName);
      await window.waitForTimeout(200);
      continue;
    }

    if (isDiagnosticsPayload(result)) {
      await window.waitForTimeout(150);
      continue;
    }

    return normalized;
  }
  return last;
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test("SDK behavior: 02-interactive-plugin handles counter and form flows", async () => {
  test.setTimeout(120000);
  const window = await electronApp.firstWindow();
  const entry = entryByPath.get("02-interactive-plugin.ts");
  if (!entry) {
    throw new Error("Missing SDK entry: 02-interactive-plugin.ts");
  }

  const pluginName = `sdk-e2e-${entry.slug}`;
  await window.waitForLoadState("domcontentloaded");
  await dismissBlueprintOverlays(window);
  await clearToastLog(window);
  await removePlugin(window, pluginName);

  try {
    await deploySdkExample(window, entry, { pluginName });
    await waitForPluginRegistered(window, pluginName);
    await openPluginFrame(window, pluginName);
    await waitForPluginReady(window, pluginName);
    await waitForPluginSettled(window, pluginName);

    const increment = await invokeHandlerWithReadiness(window, pluginName, "incrementCounter", {});
    const submit = await invokeHandlerWithReadiness(window, pluginName, "submitForm", { userName: "E2E User" });
    await waitForUiMarker(window, pluginName, entry?.expectations?.uiMarkers, 15000);
    expect(increment?.ok).toBe(true);
    expect(increment?.result?.success).toBe(true);
    expect(typeof increment?.result?.counter).toBe("number");
    expect(submit?.ok).toBe(true);
    expect(submit?.result?.success).toBe(true);
    expect(String(submit?.result?.message || "")).toContain("E2E User");
    const uiState = await getPluginUiState(window, pluginName);
    expect(uiState?.runtimeStatus?.loading).toBe(false);
    expect(uiState?.hostOverlayVisible).toBe(false);
    expect(String(uiState?.iframeText || "")).not.toMatch(/Error rendering plugin|Failed to render UI/i);
    const matchedMarker = findUiMarker(uiState?.iframeText, entry?.expectations?.uiMarkers);
    expect(!!matchedMarker).toBe(true);

    const logTail = await getPluginLogTail(window, pluginName);
    const combinedLog = tailText(logTail);
    expect(combinedLog).toMatch(/submitForm/);
    expect(combinedLog).toMatch(/ui\.message\.response\.success|plugin\.handler\.start/);
    expect(combinedLog).not.toMatch(/plugin\.render\.error|Failed to render UI|document is not defined/i);

    const toasts = await getToastLog(window);
    const recentToasts = toasts.slice(-8).map((item) => item?.text || "").join("\n");
    expect(recentToasts).not.toMatch(/failed to load|failed to render|verification failed/i);
  } catch (error) {
    const uiState = await getPluginUiState(window, pluginName).catch(() => null);
    const logTail = await getPluginLogTail(window, pluginName).catch(() => null);
    throw new Error(`${error?.message || String(error)} uiState=${JSON.stringify(uiState)} logTail=${JSON.stringify(logTail)}`);
  } finally {
    await removePlugin(window, pluginName);
  }
});

test("SDK behavior: 03-persistence-plugin records action and saves preferences", async () => {
  test.setTimeout(120000);
  const window = await electronApp.firstWindow();
  const entry = entryByPath.get("03-persistence-plugin.ts");
  if (!entry) {
    throw new Error("Missing SDK entry: 03-persistence-plugin.ts");
  }

  const pluginName = `sdk-e2e-${entry.slug}`;
  await window.waitForLoadState("domcontentloaded");
  await dismissBlueprintOverlays(window);
  await clearToastLog(window);
  await removePlugin(window, pluginName);

  try {
    await deploySdkExample(window, entry, { pluginName });
    await waitForPluginRegistered(window, pluginName);
    await openPluginFrame(window, pluginName);
    await waitForPluginReady(window, pluginName);
    await waitForPluginSettled(window, pluginName);

    const recordAction = await invokeHandlerWithReadiness(window, pluginName, "recordAction", { action: "Button Click" });
    const savePreferences = await invokeHandlerWithReadiness(window, pluginName, "savePreferences", {
      userName: "Persistence E2E",
      theme: "dark",
      notificationsEnabled: true,
    });
    expect(recordAction?.ok).toBe(true);
    expect(recordAction?.result?.success).toBe(true);
    expect(recordAction?.result?.action).toBe("Button Click");
    expect(savePreferences?.ok).toBe(true);
    expect(savePreferences?.result?.success).toBe(true);
    const uiState = await getPluginUiState(window, pluginName);
    expect(uiState?.runtimeStatus?.loading).toBe(false);
    expect(uiState?.hostOverlayVisible).toBe(false);
    expect(String(uiState?.iframeText || "")).not.toMatch(/Error rendering plugin|Failed to render UI/i);
    const matchedMarker = findUiMarker(uiState?.iframeText, entry?.expectations?.uiMarkers);
    const runtimeStable = !!(uiState?.runtimeStatus?.loaded && uiState?.runtimeStatus?.ready && uiState?.runtimeStatus?.inited);
    expect(!!matchedMarker || runtimeStable).toBe(true);

    const logTail = await getPluginLogTail(window, pluginName);
    const combinedLog = tailText(logTail);
    expect(combinedLog).toMatch(/recordAction/);
    expect(combinedLog).toMatch(/savePreferences/);
    expect(combinedLog).toMatch(/ui\.message\.response\.success|plugin\.handler\.start/);
    expect(combinedLog).not.toMatch(/plugin\.render\.error|Failed to render UI|document is not defined/i);

    const toasts = await getToastLog(window);
    const recentToasts = toasts.slice(-8).map((item) => item?.text || "").join("\n");
    expect(recentToasts).not.toMatch(/failed to load|failed to render|verification failed/i);
  } catch (error) {
    const uiState = await getPluginUiState(window, pluginName).catch(() => null);
    const logTail = await getPluginLogTail(window, pluginName).catch(() => null);
    throw new Error(`${error?.message || String(error)} uiState=${JSON.stringify(uiState)} logTail=${JSON.stringify(logTail)}`);
  } finally {
    await removePlugin(window, pluginName);
  }
});
