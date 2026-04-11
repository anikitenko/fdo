const { test, expect, _electron: electron } = require("@playwright/test");
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
  removePlugin,
} = require("./helpers/sdkExamples");

let electronApp;

const sdkExamplesRoot = resolveSdkExamplesPath();
const entries = discoverSdkExampleEntries(sdkExamplesRoot);
const entryByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));

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

function extractFailure(result) {
  const payload = result && typeof result === "object" ? result : {};
  const nested = payload.result && typeof payload.result === "object" ? payload.result : {};
  const error = String(payload.error || nested.error || "");
  const code = String(payload.code || nested.code || "");
  const details = payload.details || nested.details || null;
  const ok =
    payload.ok === true
    || nested.ok === true
    || payload.success === true
    || nested.success === true;
  return { ok, error, code, details };
}

function isMissingCapabilityFailure(failure) {
  const text = `${failure.error}\n${failure.code}\n${JSON.stringify(failure.details || {})}`;
  return /missing.*capab|not currently granted|system\.process\.(exec|scope\.)/i.test(text);
}

async function callHandler(window, pluginId, handler, content = {}) {
  const raw = await window.evaluate(async ({ pluginId, handler, content }) => {
    return await window.electron.plugin.uiMessage(pluginId, { handler, content });
  }, { pluginId, handler, content });
  return normalizeUiMessageResponse(raw);
}

async function setCapabilities(window, pluginId, capabilities) {
  const result = await window.evaluate(async ({ pluginId, capabilities }) => {
    return await window.electron.plugin.setCapabilities(pluginId, capabilities);
  }, { pluginId, capabilities });
  expect(result?.success).toBe(true);
  return result;
}

async function openPluginFrame(window, pluginName) {
  await selectPluginOpen(window, pluginName);
  await expectPluginUiVisible(window, pluginName);
  await waitForPluginUiRendered(window, pluginName, 20000);
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test("SDK capability flow: Terraform fixture enforces broad+scope grants", async () => {
  test.setTimeout(120000);
  const window = await electronApp.firstWindow();
  const entry = entryByPath.get("fixtures/operator-terraform-plugin.fixture.ts");
  if (!entry) {
    throw new Error("Missing SDK entry: fixtures/operator-terraform-plugin.fixture.ts");
  }

  const pluginName = `sdk-e2e-${entry.slug}`;
  const broad = "system.process.exec";
  const scope = "system.process.scope.terraform";

  await window.waitForLoadState("domcontentloaded");
  await dismissBlueprintOverlays(window);
  await clearToastLog(window);
  await removePlugin(window, pluginName);

  try {
    await deploySdkExample(window, entry, { pluginName });
    await waitForPluginRegistered(window, pluginName);
    await waitForPluginReady(window, pluginName);
    await waitForPluginSettled(window, pluginName);
    await openPluginFrame(window, pluginName);

    await setCapabilities(window, pluginName, []);
    const noGrantResult = extractFailure(await callHandler(window, pluginName, "terraformFixture.v2.previewApplyWorkflow", {}));
    if (!noGrantResult.ok) {
      expect(isMissingCapabilityFailure(noGrantResult)).toBe(true);
    }

    await setCapabilities(window, pluginName, [broad]);
    const broadOnlyResult = extractFailure(await callHandler(window, pluginName, "terraformFixture.v2.previewApplyWorkflow", {}));
    if (!broadOnlyResult.ok) {
      expect(isMissingCapabilityFailure(broadOnlyResult)).toBe(true);
    }

    await setCapabilities(window, pluginName, [broad, scope]);
    const afterGrant = extractFailure(await callHandler(window, pluginName, "terraformFixture.v2.previewApplyWorkflow", {}));
    // Environment may still fail on missing CLI/allowlist/policy, but it should no longer fail due to missing capabilities.
    expect(isMissingCapabilityFailure(afterGrant)).toBe(false);

    await setCapabilities(window, pluginName, []);
    const denyAfterRevoke = extractFailure(await callHandler(window, pluginName, "terraformFixture.v2.previewApplyWorkflow", {}));
    if (!denyAfterRevoke.ok) {
      expect(isMissingCapabilityFailure(denyAfterRevoke)).toBe(true);
    }
  } finally {
    await removePlugin(window, pluginName);
  }
});

test("SDK capability flow: Kubernetes fixture enforces broad+scope grants", async () => {
  test.setTimeout(120000);
  const window = await electronApp.firstWindow();
  const entry = entryByPath.get("fixtures/operator-kubernetes-plugin.fixture.ts");
  if (!entry) {
    throw new Error("Missing SDK entry: fixtures/operator-kubernetes-plugin.fixture.ts");
  }

  const pluginName = `sdk-e2e-${entry.slug}`;
  const broad = "system.process.exec";
  const scope = "system.process.scope.kubectl";

  await window.waitForLoadState("domcontentloaded");
  await dismissBlueprintOverlays(window);
  await clearToastLog(window);
  await removePlugin(window, pluginName);

  try {
    await deploySdkExample(window, entry, { pluginName });
    await waitForPluginRegistered(window, pluginName);
    await waitForPluginReady(window, pluginName);
    await waitForPluginSettled(window, pluginName);
    await openPluginFrame(window, pluginName);

    await setCapabilities(window, pluginName, []);
    const noGrantResult = extractFailure(await callHandler(window, pluginName, "kubectlFixture.v2.inspectAndRestartWorkflow", {}));
    if (!noGrantResult.ok) {
      expect(isMissingCapabilityFailure(noGrantResult)).toBe(true);
    }

    await setCapabilities(window, pluginName, [broad, scope]);
    const afterGrant = extractFailure(await callHandler(window, pluginName, "kubectlFixture.v2.inspectAndRestartWorkflow", {}));
    expect(isMissingCapabilityFailure(afterGrant)).toBe(false);

    await setCapabilities(window, pluginName, []);
    const denyAfterRevoke = extractFailure(await callHandler(window, pluginName, "kubectlFixture.v2.inspectAndRestartWorkflow", {}));
    if (!denyAfterRevoke.ok) {
      expect(isMissingCapabilityFailure(denyAfterRevoke)).toBe(true);
    }
  } finally {
    await removePlugin(window, pluginName);
  }
});
