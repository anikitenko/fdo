const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
  clearToastLog,
  getToastLog,
} = require("./helpers/electronApp");

let electronApp;
let launchError = null;

const TOKEN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PRIMARY_PLUGIN_ID = `e2e-iframe-stress-a-${TOKEN}`;
const SECONDARY_PLUGIN_ID = `e2e-iframe-stress-b-${TOKEN}`;
const SWITCH_ITERATIONS = 30;

function buildPluginCjs(label) {
  return `"use strict";
const { FDO_SDK } = require("@anikitenko/fdo-sdk");
class E2EIframeStressPlugin extends FDO_SDK {
  get metadata() {
    return Object.freeze({
      name: "${label}",
      version: "1.0.0",
      author: "E2E",
      description: "Iframe switch stress fixture",
      icon: "clean"
    });
  }
  init() {}
  render() {
    return "<div><h2>${label}</h2><p>Plugin iframe stress fixture.</p><pre>" + "x".repeat(280) + "</pre></div>";
  }
}
new E2EIframeStressPlugin();
`;
}

async function ensureRootCertificate(window) {
  await window.evaluate(async () => {
    const hasRootWithKey = async () => {
      const roots = await window.electron.settings.certificates.getRoot();
      return (roots || []).some((item) => item?.label === "root" && item?.key);
    };

    if (!(await hasRootWithKey())) {
      const before = await window.electron.settings.certificates.getRoot();
      const beforeIds = new Set((before || []).map((item) => item?.id).filter(Boolean));
      await window.electron.settings.certificates.create().catch(() => {});
      const after = await window.electron.settings.certificates.getRoot();
      const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.key);
      if (created?.id && created?.label !== "root") {
        await window.electron.settings.certificates.rename(created.id, "root").catch(() => {});
      }
    }
    if (!(await hasRootWithKey())) {
      await window.electron.settings.certificates.renew("root").catch(() => {});
    }
  });
}

async function deployPlugin(window, pluginId, displayName) {
  const result = await window.evaluate(async ({ pluginId, displayName, content }) => {
    return await window.electron.plugin.deployToMainFromEditor({
      name: pluginId,
      sandbox: `e2e_iframe_stress_${pluginId}`,
      entrypoint: "dist/index.cjs",
      content,
      metadata: {
        name: displayName,
        version: "1.0.0",
        author: "E2E",
        description: "Iframe stress fixture",
        icon: "clean",
      },
      rootCert: "root",
    });
  }, { pluginId, displayName, content: buildPluginCjs(displayName) });

  if (!result?.success) {
    throw new Error(`Failed to deploy ${pluginId}: ${result?.error || "unknown error"}`);
  }
}

async function removePlugins(window) {
  await window.evaluate(async ({ ids }) => {
    for (const id of ids) {
      try { await window.electron.plugin.deactivate(id); } catch (_) {}
      try { await window.electron.plugin.remove(id); } catch (_) {}
    }
  }, { ids: [PRIMARY_PLUGIN_ID, SECONDARY_PLUGIN_ID] });
}

async function waitForPluginRegistered(window, pluginId) {
  await window.waitForFunction(async (id) => {
    const all = await window.electron.plugin.getAll();
    return (all?.plugins || []).some((plugin) => plugin?.id === id);
  }, pluginId, { timeout: 20000 });
}

async function selectPlugin(window, pluginId) {
  const result = await window.evaluate(({ pluginId }) => {
    if (!window.__homeTestApi?.selectPluginById) {
      return { ok: false, reason: "homeTestApi_missing" };
    }
    return { ok: !!window.__homeTestApi.selectPluginById(pluginId, { open: true }) };
  }, { pluginId });

  if (!result?.ok) {
    throw new Error(`Failed to select plugin ${pluginId}: ${result?.reason || "unknown reason"}`);
  }
}

async function waitForSelectedPluginVisibleWithNonZeroLayout(window, pluginId) {
  await window.waitForFunction(async ({ pluginId }) => {
    const selected = window.__homeTestApi?.getSelectedPlugin?.() || "";
    if (selected !== pluginId) return false;

    const iframe = document.querySelector("iframe[title='Plugin Container ID']");
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return false;

    const iframeRect = iframe.getBoundingClientRect();
    if (!(iframeRect.width > 0 && iframeRect.height > 0)) return false;

    const docElRect = doc.documentElement?.getBoundingClientRect?.();
    const bodyRect = doc.body?.getBoundingClientRect?.();
    const root = doc.querySelector("#plugin-root, [data-plugin-root='true'], #root");
    const rootRect = root?.getBoundingClientRect?.();
    const text = String(doc.body.innerText || "").trim();

    return (
      (docElRect?.width || 0) > 0
      && (docElRect?.height || 0) > 0
      && (bodyRect?.width || 0) > 0
      && (bodyRect?.height || 0) > 0
      && (rootRect?.width || 0) > 0
      && (rootRect?.height || 0) > 0
      && text.length > 0
    );
  }, { pluginId }, { timeout: 10000 });
}

test.describe("plugin iframe rapid-switch stress", () => {
  test.beforeAll(async () => {
    try {
      electronApp = await launchElectronApp(electron);
    } catch (error) {
      launchError = error;
    }
  });

  test.afterAll(async () => {
    if (electronApp) {
      const window = electronApp.windows()?.[0];
      if (window && !window.isClosed()) {
        await removePlugins(window).catch(() => {});
      }
    }
    await closeElectronApp(electronApp);
  }, 120000);

  test("rapid switching keeps iframe layout non-zero and avoids terminal failures", async () => {
    test.skip(!!launchError, `Electron launch unavailable in this environment: ${launchError?.message || "unknown error"}`);
    test.setTimeout(240000);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
      window.__FDO_PLUGIN_METRICS__ = [];
    });
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugins(window);
    await ensureRootCertificate(window);

    await deployPlugin(window, PRIMARY_PLUGIN_ID, "E2E Iframe Stress A");
    await deployPlugin(window, SECONDARY_PLUGIN_ID, "E2E Iframe Stress B");
    await waitForPluginRegistered(window, PRIMARY_PLUGIN_ID);
    await waitForPluginRegistered(window, SECONDARY_PLUGIN_ID);

    for (let i = 0; i < SWITCH_ITERATIONS; i += 1) {
      await selectPlugin(window, i % 2 === 0 ? PRIMARY_PLUGIN_ID : SECONDARY_PLUGIN_ID);
      await waitForSelectedPluginVisibleWithNonZeroLayout(window, i % 2 === 0 ? PRIMARY_PLUGIN_ID : SECONDARY_PLUGIN_ID);
    }

    const metrics = await window.evaluate(() => window.__FDO_PLUGIN_METRICS__ || []);
    const terminalFailures = metrics.filter((entry) => entry?.metric === "plugin_iframe_terminal_failure");
    expect(terminalFailures).toEqual([]);

    const toasts = await getToastLog(window);
    const badToast = toasts.find((entry) => /plugin ui failed to load|failed to render plugin ui/i.test(entry?.text || ""));
    expect(badToast).toBeFalsy();
  });
});
