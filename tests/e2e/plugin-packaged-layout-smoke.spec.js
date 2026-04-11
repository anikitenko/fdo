const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
} = require("./helpers/electronApp");

let electronApp;
let launchError = null;

const PACKAGED_EXECUTABLE = process.env.FDO_E2E_PACKAGED_EXECUTABLE || "";
const TOKEN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PLUGIN_ID = `e2e-packaged-layout-${TOKEN}`;
const PLUGIN_DISPLAY = `E2E Packaged Layout ${TOKEN}`;

function buildPluginCjs() {
  return `"use strict";
const { FDO_SDK } = require("@anikitenko/fdo-sdk");
class E2EPackagedLayoutPlugin extends FDO_SDK {
  get metadata() {
    return Object.freeze({
      name: "${PLUGIN_DISPLAY}",
      version: "1.0.0",
      author: "E2E",
      description: "Packaged iframe layout smoke fixture",
      icon: "clean"
    });
  }
  init() {}
  render() {
    return "<div><h2>${PLUGIN_DISPLAY}</h2><p>Packaged layout smoke.</p></div>";
  }
}
new E2EPackagedLayoutPlugin();
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

async function deployPlugin(window) {
  const result = await window.evaluate(async ({ pluginId, content, displayName }) => {
    return await window.electron.plugin.deployToMainFromEditor({
      name: pluginId,
      sandbox: `e2e_packaged_layout_${pluginId}`,
      entrypoint: "dist/index.cjs",
      content,
      metadata: {
        name: displayName,
        version: "1.0.0",
        author: "E2E",
        description: "Packaged iframe layout smoke fixture",
        icon: "clean",
      },
      rootCert: "root",
    });
  }, {
    pluginId: PLUGIN_ID,
    content: buildPluginCjs(),
    displayName: PLUGIN_DISPLAY,
  });
  if (!result?.success) {
    throw new Error(`Failed to deploy packaged smoke plugin: ${result?.error || "unknown error"}`);
  }
}

async function waitForPluginRegistered(window) {
  await window.waitForFunction(async ({ pluginId }) => {
    const all = await window.electron.plugin.getAll();
    return (all?.plugins || []).some((plugin) => plugin?.id === pluginId);
  }, { pluginId: PLUGIN_ID }, { timeout: 20000 });
}

async function selectPlugin(window) {
  const result = await window.evaluate(({ pluginId }) => {
    if (!window.__homeTestApi?.selectPluginById) {
      return { ok: false, reason: "homeTestApi_missing" };
    }
    return { ok: !!window.__homeTestApi.selectPluginById(pluginId, { open: true }) };
  }, { pluginId: PLUGIN_ID });
  if (!result?.ok) {
    throw new Error(`Failed to select packaged smoke plugin: ${result?.reason || "unknown reason"}`);
  }
}

async function removePlugin(window) {
  await window.evaluate(async ({ pluginId }) => {
    try { await window.electron.plugin.deactivate(pluginId); } catch (_) {}
    try { await window.electron.plugin.remove(pluginId); } catch (_) {}
  }, { pluginId: PLUGIN_ID });
}

test.describe("packaged plugin iframe layout smoke", () => {
  test.skip(!PACKAGED_EXECUTABLE, "Set FDO_E2E_PACKAGED_EXECUTABLE to run packaged smoke.");

  test.beforeAll(async () => {
    try {
      electronApp = await launchElectronApp(electron, {
        packagedExecutablePath: PACKAGED_EXECUTABLE,
      });
    } catch (error) {
      launchError = error;
    }
  });

  test.afterAll(async () => {
    if (electronApp) {
      const window = electronApp.windows()?.[0];
      if (window && !window.isClosed()) {
        await removePlugin(window).catch(() => {});
      }
    }
    await closeElectronApp(electronApp);
  }, 120000);

  test("packaged build renders plugin iframe with non-zero layout geometry", async () => {
    test.skip(!!launchError, `Packaged Electron launch failed: ${launchError?.message || "unknown error"}`);
    test.setTimeout(180000);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
    });
    await dismissBlueprintOverlays(window);
    await removePlugin(window);
    await ensureRootCertificate(window);
    await deployPlugin(window);
    await waitForPluginRegistered(window);
    await selectPlugin(window);

    const geometry = await window.waitForFunction(() => {
      const iframe = document.querySelector("iframe[title='Plugin Container ID']");
      const doc = iframe?.contentDocument;
      if (!iframe || !doc?.body) return null;
      const iframeRect = iframe.getBoundingClientRect();
      const docElRect = doc.documentElement?.getBoundingClientRect?.();
      const bodyRect = doc.body?.getBoundingClientRect?.();
      const root = doc.querySelector("#plugin-root, [data-plugin-root='true'], #root");
      const rootRect = root?.getBoundingClientRect?.();
      const ready = (
        (iframeRect?.width || 0) > 0
        && (iframeRect?.height || 0) > 0
        && (docElRect?.width || 0) > 0
        && (docElRect?.height || 0) > 0
        && (bodyRect?.width || 0) > 0
        && (bodyRect?.height || 0) > 0
        && (rootRect?.width || 0) > 0
        && (rootRect?.height || 0) > 0
      );
      if (!ready) return null;
      return {
        iframe: { width: iframeRect.width, height: iframeRect.height },
        docEl: { width: docElRect.width, height: docElRect.height },
        body: { width: bodyRect.width, height: bodyRect.height },
        root: { width: rootRect.width, height: rootRect.height },
      };
    }, {}, { timeout: 12000 });

    const value = await geometry.jsonValue();
    expect(value.iframe.width).toBeGreaterThan(0);
    expect(value.iframe.height).toBeGreaterThan(0);
    expect(value.docEl.width).toBeGreaterThan(0);
    expect(value.docEl.height).toBeGreaterThan(0);
    expect(value.body.width).toBeGreaterThan(0);
    expect(value.body.height).toBeGreaterThan(0);
    expect(value.root.width).toBeGreaterThan(0);
    expect(value.root.height).toBeGreaterThan(0);
  });
});
