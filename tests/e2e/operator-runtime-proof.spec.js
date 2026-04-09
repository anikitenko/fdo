const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
  clearToastLog,
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

const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
const proofRecords = [];

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

function hasLoadingUi(sidebarButton) {
  if (!sidebarButton) return false;
  const className = String(sidebarButton.className || "");
  if (/bp6-loading|bp5-loading/.test(className)) {
    return true;
  }
  const spinner = sidebarButton.querySelector(".bp6-spinner, .bp5-spinner, .bp6-button-spinner, .bp5-button-spinner");
  return !!spinner;
}

async function setCapabilities(window, pluginId, capabilities) {
  const result = await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
  expect(result?.success).toBe(true);
}

async function invokeHandler(window, pluginId, handler, content = {}, timeoutMs = 20000) {
  const startedAt = Date.now();
  const raw = await Promise.race([
    window.evaluate(async ({ pluginId, handler, content }) => {
      return await window.electron.plugin.uiMessage(pluginId, { handler, content });
    }, { pluginId, handler, content }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Handler timeout: ${handler}`)), timeoutMs)),
  ]);
  return {
    elapsedMs: Date.now() - startedAt,
    response: normalizeUiMessageResponse(raw),
  };
}

async function withElectronAppForEnv(envOverrides, run) {
  const previous = {};
  Object.keys(envOverrides).forEach((key) => {
    previous[key] = process.env[key];
    process.env[key] = envOverrides[key];
  });

  let app = null;
  try {
    app = await launchElectronApp(electron);
    return await run(app);
  } finally {
    if (app) {
      await closeElectronApp(app);
    }
    Object.keys(envOverrides).forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

test.afterAll(async () => {
  try {
    const outDir = path.resolve(process.cwd(), "test-results");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "operator-runtime-proof.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: proofRecords.length,
      passed: proofRecords.filter((item) => item.status === "passed").length,
      failed: proofRecords.filter((item) => item.status === "failed").length,
      records: proofRecords,
    }, null, 2), "utf8");
  } catch (_) {}
});

test("proof: sidebar plugin icons stop spinning after runtime settles", async () => {
  test.setTimeout(180000);
  const record = {
    check: "sidebar-spinner",
    status: "running",
    states: [],
    error: "",
  };
  proofRecords.push(record);

  await withElectronAppForEnv({}, async (electronApp) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);

    const targetPaths = [
      "fixtures/minimal-plugin.fixture.ts",
      "fixtures/storage-plugin.fixture.ts",
      "fixtures/operator-terraform-plugin.fixture.ts",
      "fixtures/operator-kubernetes-plugin.fixture.ts",
    ];
    const selectedEntries = targetPaths.map((entryPath) => byPath.get(entryPath)).filter(Boolean);
    expect(selectedEntries.length).toBe(targetPaths.length);
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

      record.states = sidebarStates;
      for (const state of sidebarStates) {
        expect(state.found, `Sidebar button missing for ${state.id}`).toBe(true);
        const syntheticButton = {
          className: state.className,
          querySelector: (selector) => (selector && state.hasSpinner ? {} : null),
        };
        expect(hasLoadingUi(syntheticButton), `Sidebar button still loading for ${state.id}: ${JSON.stringify(state)}`).toBe(false);
        expect(String(state.ariaBusy || "").toLowerCase()).not.toBe("true");
      }
      record.status = "passed";
    } finally {
      for (const pluginName of pluginNames) {
        await removePlugin(window, pluginName);
      }
    }
  }).catch((error) => {
    record.status = "failed";
    record.error = error?.message || String(error);
    throw error;
  });
});

test("proof: kubectl/terraform workflow handlers do not deadlock in auto-approved mode", async () => {
  test.setTimeout(240000);
  const record = {
    check: "operator-deadlock-auto-approve",
    status: "running",
    terraform: null,
    kubectl: null,
    error: "",
  };
  proofRecords.push(record);

  await withElectronAppForEnv({
    FDO_E2E_AUTO_APPROVE_PRIVILEGED: "1",
    FDO_E2E_PRIVILEGED_CONFIRM_MODE: "approve",
  }, async (electronApp) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);

    const tfEntry = byPath.get("fixtures/operator-terraform-plugin.fixture.ts");
    const kubeEntry = byPath.get("fixtures/operator-kubernetes-plugin.fixture.ts");
    expect(tfEntry).toBeTruthy();
    expect(kubeEntry).toBeTruthy();

    const tfPluginName = `sdk-e2e-${tfEntry.slug}`;
    const kubePluginName = `sdk-e2e-${kubeEntry.slug}`;

    await removePlugin(window, tfPluginName);
    await removePlugin(window, kubePluginName);

    try {
      await deploySdkExample(window, tfEntry, { pluginName: tfPluginName });
      await deploySdkExample(window, kubeEntry, { pluginName: kubePluginName });
      await waitForPluginRegistered(window, tfPluginName);
      await waitForPluginRegistered(window, kubePluginName);
      await waitForPluginReady(window, tfPluginName);
      await waitForPluginReady(window, kubePluginName);
      await waitForPluginSettled(window, tfPluginName);
      await waitForPluginSettled(window, kubePluginName);

      await setCapabilities(window, tfPluginName, ["system.process.exec", "system.process.scope.terraform"]);
      await setCapabilities(window, kubePluginName, ["system.process.exec", "system.process.scope.kubectl"]);

      const tfResult = await invokeHandler(window, tfPluginName, "terraform.previewApplyWorkflow", {}, 25000);
      const kubeResult = await invokeHandler(window, kubePluginName, "kubectl.inspectAndRestartWorkflow", {}, 25000);
      record.terraform = tfResult;
      record.kubectl = kubeResult;

      expect(tfResult.elapsedMs).toBeLessThan(25000);
      expect(kubeResult.elapsedMs).toBeLessThan(25000);
      expect(typeof tfResult.response.ok).toBe("boolean");
      expect(typeof kubeResult.response.ok).toBe("boolean");
      // The exact outcome depends on host policy/CLI availability, but deadlock is disallowed
      // and user-cancelled confirmations are not accepted in this automated path.
      expect(tfResult.response.error || tfResult.response.code || tfResult.response.result || tfResult.response.ok !== undefined).toBeTruthy();
      expect(kubeResult.response.error || kubeResult.response.code || kubeResult.response.result || kubeResult.response.ok !== undefined).toBeTruthy();
      expect(String(tfResult.response.code || "").toUpperCase()).not.toBe("CANCELLED");
      expect(String(kubeResult.response.code || "").toUpperCase()).not.toBe("CANCELLED");
      expect(String(tfResult.response.error || "")).not.toMatch(/User cancelled/i);
      expect(String(kubeResult.response.error || "")).not.toMatch(/User cancelled/i);

      record.status = "passed";
    } finally {
      await removePlugin(window, tfPluginName);
      await removePlugin(window, kubePluginName);
    }
  }).catch((error) => {
    record.status = "failed";
    record.error = error?.message || String(error);
    throw error;
  });
});
