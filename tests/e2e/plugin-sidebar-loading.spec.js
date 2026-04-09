const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
} = require("./helpers/electronApp");
const {
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
  deploySdkExample,
  waitForPluginRegistered,
  waitForPluginReady,
  waitForPluginSettled,
  removePlugin,
} = require("./helpers/sdkExamples");

let electronApp;

const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));

const TARGETS = [
  "fixtures/minimal-plugin.fixture.ts",
  "fixtures/storage-plugin.fixture.ts",
  "fixtures/operator-terraform-plugin.fixture.ts",
  "fixtures/operator-kubernetes-plugin.fixture.ts",
];

function hasLoadingUi(sidebarButton) {
  if (!sidebarButton) return false;
  const className = String(sidebarButton.className || "");
  if (/bp6-loading|bp5-loading/.test(className)) {
    return true;
  }
  const spinner = sidebarButton.querySelector(".bp6-spinner, .bp5-spinner, .bp6-button-spinner, .bp5-button-spinner");
  return !!spinner;
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test("sidebar plugin buttons do not stay spinning after runtime settles", async () => {
  test.setTimeout(180000);
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await dismissBlueprintOverlays(window);

  const selectedEntries = TARGETS
    .map((path) => byPath.get(path))
    .filter(Boolean);
  if (selectedEntries.length < 3) {
    throw new Error("Not enough SDK fixture entries found for spinner regression test.");
  }

  const pluginNames = selectedEntries.map((entry) => `sdk-e2e-${entry.slug}`);

  for (const pluginName of pluginNames) {
    await removePlugin(window, pluginName);
  }

  try {
    for (const entry of selectedEntries) {
      const pluginName = `sdk-e2e-${entry.slug}`;
      await deploySdkExample(window, entry, { pluginName });
      await waitForPluginRegistered(window, pluginName);
      await waitForPluginReady(window, pluginName);
      await waitForPluginSettled(window, pluginName);
    }

    await window.waitForTimeout(1200);

    const sidebarStates = await window.evaluate(({ pluginNames }) => {
      return pluginNames.map((id) => {
        const root = document.querySelector(`[data-plugin-sidebar-item="${id}"]`);
        const button = root?.querySelector("button");
        const className = String(button?.className || "");
        const hasSpinner = !!button?.querySelector(".bp6-spinner, .bp5-spinner, .bp6-button-spinner, .bp5-button-spinner");
        const ariaBusy = button?.getAttribute("aria-busy") || "";
        return { id, found: !!button, className, hasSpinner, ariaBusy };
      });
    }, { pluginNames });

    for (const state of sidebarStates) {
      expect(state.found, `Sidebar button missing for ${state.id}`).toBe(true);
      const syntheticButton = {
        className: state.className,
        querySelector: (selector) => (selector && state.hasSpinner ? {} : null),
      };
      expect(hasLoadingUi(syntheticButton), `Sidebar button still loading for ${state.id}: ${JSON.stringify(state)}`).toBe(false);
      expect(String(state.ariaBusy || "").toLowerCase()).not.toBe("true");
    }
  } finally {
    for (const pluginName of pluginNames) {
      await removePlugin(window, pluginName);
    }
  }
});
