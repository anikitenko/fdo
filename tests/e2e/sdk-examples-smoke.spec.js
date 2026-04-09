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
  getPluginIframeText,
  getPluginDiagnostics,
  getPluginLogTail,
  removePlugin,
} = require("./helpers/sdkExamples");

let electronApp;

const INITIAL_SMOKE_RELATIVE_PATHS = new Set([
  "01-basic-plugin.ts",
]);

function parsePositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const sdkExamplesRoot = resolveSdkExamplesPath();
const allEntries = discoverSdkExampleEntries(sdkExamplesRoot);
const relativeFilter = String(process.env.FDO_E2E_SDK_EXAMPLES_FILTER || "").trim();
const maxEntries = parsePositiveInt(process.env.FDO_E2E_SDK_EXAMPLES_LIMIT, 0);
const useInitialSubset = process.env.FDO_E2E_SDK_EXAMPLES_ALL === "0";

const filteredEntries = allEntries.filter((entry) => {
  if (useInitialSubset) {
    return INITIAL_SMOKE_RELATIVE_PATHS.has(entry.relativePath);
  }
  if (!relativeFilter) {
    return true;
  }
  return entry.relativePath.includes(relativeFilter);
});

const smokeEntries = maxEntries > 0 ? filteredEntries.slice(0, maxEntries) : filteredEntries;

if (smokeEntries.length === 0) {
  throw new Error(
    `No SDK example entries selected for smoke run. root=${sdkExamplesRoot}, total=${allEntries.length}, filter="${relativeFilter}", limit=${maxEntries || "none"}`
  );
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

for (const entry of smokeEntries) {
  test(`SDK smoke: ${entry.relativePath} loads and renders live`, async () => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    const pluginName = `sdk-e2e-${entry.slug}`;

    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, pluginName);

    try {
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
      await window.waitForTimeout(400);
      await selectPluginOpen(window, pluginName);
      await expectPluginUiVisible(window, pluginName);
      await waitForPluginUiRendered(window, pluginName, 20000);

      const toastLog = await getToastLog(window);
      const recentToasts = toastLog.slice(-8).map((item) => item?.text || "");
      const uiText = await getPluginIframeText(window);
      const runtimeStatus = await window.evaluate(async ({ pluginName }) => {
        return await window.electron.plugin.getRuntimeStatus([pluginName]);
      }, { pluginName });
      const status = runtimeStatus?.statuses?.[0];
      const diagnostics = await getPluginDiagnostics(window, pluginName);
      const uiState = await getPluginUiState(window, pluginName);
      const logTail = await getPluginLogTail(window, pluginName, { maxFiles: 3, maxChars: 20000 });
      const logJson = JSON.stringify(logTail || {});
      const combinedLog = String(logTail?.combined || "");

      expect(status?.loaded).toBe(true);
      expect(status?.ready).toBe(true);
      expect(status?.inited).toBe(true);
      expect(status?.loading).toBe(false);
      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.iframePresent).toBe(true);
      expect(uiState?.hostOverlayVisible).toBe(false);
      if (String(uiState?.iframeHtml || "").includes("plugin-page-loader")) {
        throw new Error(`PLUGIN_IFRAME_STUCK_LOADER: ${entry.relativePath}`);
      }
      expect(recentToasts.join("\n")).not.toMatch(/failed to load|failed to render|verification failed|plugin closed/i);
      expect(logJson).not.toContain("plugin.render.error");
      expect(logJson).not.toContain("plugin.init.error");
      expect(logJson).not.toMatch(/document is not defined/i);

      expect(diagnostics).toBeTruthy();
      const expectedHandlers = Array.isArray(entry?.expectations?.handlers) ? entry.expectations.handlers : [];
      const actualHandlers = Array.isArray(diagnostics?.capabilities?.registeredHandlers)
        ? diagnostics.capabilities.registeredHandlers
        : [];
      for (const handler of expectedHandlers) {
        expect(actualHandlers).toContain(handler);
      }

      const uiMarkers = Array.isArray(entry?.expectations?.uiMarkers) ? entry.expectations.uiMarkers : [];
      if (uiMarkers.length > 0) {
        const uiBodyText = String(uiText || "");
        const iframeText = String(uiState?.iframeText || "");
        const iframeHtml = String(uiState?.iframeHtml || "");
        const searchableUi = `${uiBodyText}\n${iframeText}\n${iframeHtml}`;
        const markerFound = uiMarkers.some((marker) => searchableUi.includes(String(marker)));
        expect(markerFound).toBe(true);
      }

      const initMessages = Array.isArray(entry?.expectations?.initMessages) ? entry.expectations.initMessages : [];
      if (initMessages.length > 0) {
        const hasInitSignal = initMessages.some((message) => logJson.includes(message))
          || /plugin\.init\.success/.test(logJson)
          || /plugin\.init\.response\.success/.test(logJson)
          || /plugin\.registered/.test(logJson)
          || status?.inited === true;
        expect(hasInitSignal).toBe(true);
      }
      expect(combinedLog).not.toMatch(/Failed to render UI/i);
      expect(uiState?.iframeText || "").not.toMatch(/Failed to render UI|Plugin UI failed to load/i);
    } catch (error) {
      const uiState = await getPluginUiState(window, pluginName).catch(() => null);
      const logTail = await getPluginLogTail(window, pluginName).catch(() => null);
      throw new Error(`${error?.message || String(error)} uiState=${JSON.stringify(uiState)} logTail=${JSON.stringify(logTail)}`);
    } finally {
      await removePlugin(window, pluginName);
    }
  });
}
