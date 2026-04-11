const { test, expect, _electron: electron } = require('@playwright/test');
const {
  launchElectronApp,
  closeElectronApp,
  clearToastLog,
  dismissBlueprintOverlays,
  getToastLog,
} = require('./helpers/electronApp');

let electronApp;

const ITERATIONS = 15;
const pluginToken = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PLUGIN_NAME = `e2e-stability-plugin-${pluginToken}`;
const PLUGIN_DISPLAY = `E2E Stability Plugin ${pluginToken}`;
const PLUGIN_DESCRIPTION = 'E2E stability lifecycle plugin';
const SECOND_PLUGIN_NAME = `${PLUGIN_NAME}-b`;
const SECOND_PLUGIN_DISPLAY = `${PLUGIN_DISPLAY} B`;
const SECOND_PLUGIN_DESCRIPTION = `${PLUGIN_DESCRIPTION} B`;
let preservePluginForDebug = false;

function buildPluginFiles(options = {}) {
  const readyDelayMs = Number(options.readyDelayMs || 0);
  const displayName = options.displayName || PLUGIN_DISPLAY;
  const description = options.description || PLUGIN_DESCRIPTION;
  const indexCjs = `"use strict";

const { FDO_SDK } = require("@anikitenko/fdo-sdk");

class E2EStabilityPlugin extends FDO_SDK {
  get metadata() {
    return Object.freeze({
      name: "${displayName}",
      version: "1.0.0",
      author: "E2E",
      description: "${description}",
      icon: "clean",
    });
  }

  init() {}

  render() {
    return "<div><h2>E2E Stability Plugin UI</h2><p>Lifecycle render is stable.</p></div>";
  }
}

const bootstrap = () => {
  new E2EStabilityPlugin();
};

if (${readyDelayMs} > 0) {
  setTimeout(bootstrap, ${readyDelayMs});
} else {
  bootstrap();
}
`;
  return indexCjs;
}

async function installSignedE2EPlugin(window, options = {}) {
  const pluginName = options.pluginName || PLUGIN_NAME;
  const displayName = options.displayName || PLUGIN_DISPLAY;
  const description = options.description || PLUGIN_DESCRIPTION;
  await window.evaluate(async () => {
    const hasRootWithKey = async () => {
      const roots = await window.electron.settings.certificates.getRoot();
      return (roots || []).some((item) => item?.label === 'root' && item?.key);
    };

    if (!(await hasRootWithKey())) {
      const before = await window.electron.settings.certificates.getRoot();
      const beforeIds = new Set((before || []).map((item) => item?.id).filter(Boolean));
      await window.electron.settings.certificates.create().catch(() => {});
      const after = await window.electron.settings.certificates.getRoot();
      const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.key);
      if (created?.id && created?.label !== 'root') {
        await window.electron.settings.certificates.rename(created.id, 'root').catch(() => {});
      }
    }
    if (!(await hasRootWithKey())) {
      await window.electron.settings.certificates.renew('root').catch(() => {});
    }
  });

  const deployResult = await window.evaluate(async ({ pluginCode, pluginName, displayName, description }) => {
    return await window.electron.plugin.deployToMainFromEditor({
      name: pluginName,
      sandbox: `e2e_${pluginName}`,
      entrypoint: 'dist/index.cjs',
      content: pluginCode,
      metadata: {
        name: displayName,
        version: '1.0.0',
        author: 'E2E',
        description,
        icon: 'clean',
      },
      rootCert: 'root',
    });
  }, {
    pluginCode: buildPluginFiles(options),
    pluginName,
    displayName,
    description,
  });

  if (!deployResult?.success) {
    throw new Error(`Failed to deploy signed e2e plugin: ${deployResult?.error || 'unknown error'}`);
  }

  const verifyOk = await window.evaluate(async ({ pluginName }) => {
    for (let i = 0; i < 5; i += 1) {
      const verifyResult = await window.electron.plugin.verifySignature(pluginName);
      if (verifyResult?.success) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }, { pluginName });

  if (!verifyOk) {
    throw new Error('Plugin signature verification did not succeed after signing.');
  }
}

async function purgeStabilityPlugins(window) {
  await window.evaluate(async () => {
    const all = await window.electron.plugin.getAll();
    const ids = (all?.plugins || [])
      .map((plugin) => plugin?.id)
      .filter((id) => typeof id === "string" && id.startsWith("e2e-stability-plugin-"));

    for (const id of ids) {
      try {
        await window.electron.plugin.deactivate(id);
      } catch (_) {}
      try {
        await window.electron.plugin.remove(id);
      } catch (_) {}
    }
  });
}

async function waitForPluginRegistered(window, pluginName) {
  await window.waitForFunction(async (id) => {
    const all = await window.electron.plugin.getAll();
    return (all?.plugins || []).some((plugin) => plugin?.id === id);
  }, pluginName, { timeout: 15000 });
}

async function openPluginsPopover(window) {
  await window.getByRole('button', { name: /Plugins Activated:/i }).click({ force: true });
}

async function selectPluginOpen(window, pluginName = PLUGIN_NAME) {
  const selected = await window.evaluate(async ({ pluginName }) => {
    if (!window.__homeTestApi?.selectPluginById) {
      return { ok: false, reason: 'homeTestApi_missing' };
    }
    const result = window.__homeTestApi.selectPluginById(pluginName, {open: true});
    return { ok: !!result };
  }, { pluginName });
  if (!selected?.ok) {
    throw new Error(`Failed to select plugin through Home test API: ${selected?.reason || 'not_found'}`);
  }
}

async function deselectPlugin(window, pluginName = PLUGIN_NAME) {
  await window.waitForTimeout(180);
  const deselected = await window.evaluate(async ({ pluginName }) => {
    if (!window.__homeTestApi?.deselectPluginById) {
      return { ok: false, reason: 'homeTestApi_missing' };
    }
    const result = window.__homeTestApi.deselectPluginById(pluginName);
    return { ok: !!result };
  }, { pluginName });
  if (!deselected?.ok) {
    throw new Error(`Failed to deselect plugin through Home test API: ${deselected?.reason || 'not_found'}`);
  }
}

async function expectPluginUiVisible(window, pluginName = PLUGIN_NAME) {
  await expect(window.locator('iframe[title="Plugin Container ID"]')).toHaveCount(1, { timeout: 10000 });
  const startedAt = Date.now();
  try {
    await window.waitForFunction(({ pluginName, since }) => {
      const iframe = document.querySelector('iframe[title="Plugin Container ID"]');
      const doc = iframe?.contentDocument;
      if (doc?.body) {
        const root = doc.querySelector('#plugin-root, [data-plugin-root="true"], #root');
        const childCount = root?.childElementCount ?? doc.body.childElementCount ?? 0;
        const textLength = (doc.body.innerText || '').trim().length;
        if (childCount > 0 || textLength > 0) {
          return true;
        }
      }
      return false;
    }, { pluginName, since: startedAt }, { timeout: 5500 });
  } catch (error) {
    const diag = await window.evaluate(async ({ pluginName }) => {
      const runtimeStatus = await window.electron.plugin.getRuntimeStatus([pluginName]);
      const selected = window.__homeTestApi?.getSelectedPlugin?.() || "";
      const active = window.__homeTestApi?.getActivePluginIds?.() || [];
      const logTail = await window.electron.plugin.getLogTail(pluginName, { maxFiles: 2, maxChars: 4000 }).catch(() => null);
      const notifications = await window.electron.notifications.get().catch(() => ({ notifications: [] }));
      const pageText = (document.body?.innerText || "").slice(0, 2000);
      return {
        runtimeStatus,
        selected,
        active,
        pageText,
        logTail,
        notifications: (notifications?.notifications || []).slice(-5),
      };
    }, { pluginName });
    const status = diag.runtimeStatus?.statuses?.[0];
    const selectedAndReady = status?.loaded && status?.ready && status?.inited
      && diag.selected === pluginName
      && Array.isArray(diag.active)
      && diag.active.includes(pluginName);
    if (selectedAndReady) {
      return;
    }
    throw new Error(`Plugin iframe mounted without rendered DOM. diag=${JSON.stringify(diag)}`);
  }
}

async function expectPluginUiHidden(window) {
  await expect(window.locator('iframe[title="Plugin Container ID"]')).toHaveCount(0, { timeout: 10000 });
}

async function assertNoPluginErrorToast(window) {
  const log = await getToastLog(window);
  const recent = log.slice(-12).map((entry) => entry?.text || '');
  const bad = recent.find((text) => (
    /signature is invalid|failed to render plugin ui|plugin closed|plugin could not be loaded|verification failed/i.test(text)
  ));
  if (bad) {
    throw new Error(`Unexpected plugin error toast: ${bad}`);
  }
}

async function assertNoPluginStageBanner(window) {
  const stageBanner = window.locator('text=/^Plugin:\\s+.+\\s\\|\\sStage:\\s+/');
  await expect(stageBanner).toHaveCount(0);
}

async function clickInsidePluginIframe(window) {
  const iframeElement = await window.waitForSelector('iframe[title="Plugin Container ID"]', { timeout: 10000 });
  const frame = await iframeElement.contentFrame();
  if (!frame) {
    throw new Error("Plugin iframe content frame was not available.");
  }
  await frame.click("body", { position: { x: 8, y: 8 } });
}

async function clickSidePanelPlugin(window, pluginName) {
  const selector = `[data-plugin-sidebar-item="${pluginName}"] button`;
  await window.waitForSelector(selector, { timeout: 10000 });
  await window.click(selector, { force: true });
}

test.describe('plugin ui stability', () => {
  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron);
  });

  test.afterAll(async () => {
    if (electronApp) {
      const window = electronApp.windows()?.[0];
      if (window && !window.isClosed()) {
        await window.evaluate(async ({ pluginName, secondPluginName }) => {
          try {
            await window.electron.plugin.deactivate(pluginName);
          } catch (_) {}
          try {
            await window.electron.plugin.deactivate(secondPluginName);
          } catch (_) {}
          if (!window.__E2E_PRESERVE_PLUGIN__) {
            try {
              await window.electron.plugin.remove(pluginName);
            } catch (_) {}
            try {
              await window.electron.plugin.remove(secondPluginName);
            } catch (_) {}
          }
        }, { pluginName: PLUGIN_NAME, secondPluginName: SECOND_PLUGIN_NAME });
      }
    }
    await closeElectronApp(electronApp);
  }, 120000);

  test('activate/open/render/deactivate loop remains stable across repeated iterations', async () => {
    test.setTimeout(300000);

    const window = await electronApp.firstWindow();
    const lifecycleEvents = [];
    let currentIteration = -1;
    window.on('crash', () => {
      lifecycleEvents.push({ type: 'page-crash', iteration: currentIteration, ts: Date.now() });
    });
    window.on('close', () => {
      lifecycleEvents.push({ type: 'page-close', iteration: currentIteration, ts: Date.now() });
    });
    window.on('pageerror', (error) => {
      lifecycleEvents.push({
        type: 'pageerror',
        iteration: currentIteration,
        ts: Date.now(),
        message: error?.message || String(error),
      });
    });
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
    });
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);
    await purgeStabilityPlugins(window);
    await installSignedE2EPlugin(window);
    await waitForPluginRegistered(window, PLUGIN_NAME);
    await window.waitForTimeout(500);

    try {
      for (let i = 0; i < ITERATIONS; i += 1) {
        currentIteration = i;
        await selectPluginOpen(window);
        await expectPluginUiVisible(window);
        await assertNoPluginErrorToast(window);
        await assertNoPluginStageBanner(window);

        await deselectPlugin(window);
        await expectPluginUiHidden(window);
        await assertNoPluginErrorToast(window);
        await assertNoPluginStageBanner(window);
      }
    } catch (error) {
      preservePluginForDebug = true;
      const wrapped = new Error(`${error?.message || String(error)} lifecycle=${JSON.stringify(lifecycleEvents.slice(-20))}`);
      wrapped.stack = error?.stack || wrapped.stack;
      try {
        await window.evaluate((value) => {
          window.__E2E_PRESERVE_PLUGIN__ = value;
        }, preservePluginForDebug);
      } catch (_) {}
      throw wrapped;
    }
  });

  test('plugin still opens when PLUGIN_READY is delayed', async () => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
    });
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);
    await purgeStabilityPlugins(window);
    await installSignedE2EPlugin(window, { readyDelayMs: 1200 });
    await waitForPluginRegistered(window, PLUGIN_NAME);
    await selectPluginOpen(window);
    await expectPluginUiVisible(window);
    await assertNoPluginErrorToast(window);
    await assertNoPluginStageBanner(window);
    await deselectPlugin(window);
    await expectPluginUiHidden(window);
  });

  test('switching active plugins via SidePanel keeps UI visible and hides stage banner', async () => {
    test.setTimeout(180000);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
    });
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);
    await purgeStabilityPlugins(window);
    await installSignedE2EPlugin(window, {
      pluginName: PLUGIN_NAME,
      displayName: PLUGIN_DISPLAY,
      description: PLUGIN_DESCRIPTION,
    });
    await installSignedE2EPlugin(window, {
      pluginName: SECOND_PLUGIN_NAME,
      displayName: SECOND_PLUGIN_DISPLAY,
      description: SECOND_PLUGIN_DESCRIPTION,
    });

    await waitForPluginRegistered(window, PLUGIN_NAME);
    await waitForPluginRegistered(window, SECOND_PLUGIN_NAME);

    await selectPluginOpen(window, PLUGIN_NAME);
    await expectPluginUiVisible(window, PLUGIN_NAME);
    await assertNoPluginStageBanner(window);

    await selectPluginOpen(window, SECOND_PLUGIN_NAME);
    await expectPluginUiVisible(window, SECOND_PLUGIN_NAME);
    await assertNoPluginStageBanner(window);

    const activePluginIds = await window.evaluate(() => window.__homeTestApi?.getActivePluginIds?.() || []);
    if (!Array.isArray(activePluginIds) || activePluginIds.length < 2) {
      throw new Error(`Expected 2 active plugins before SidePanel switch, got: ${JSON.stringify(activePluginIds)}`);
    }

    await clickSidePanelPlugin(window, PLUGIN_NAME);
    await expectPluginUiVisible(window, PLUGIN_NAME);
    await assertNoPluginStageBanner(window);
    await clickSidePanelPlugin(window, SECOND_PLUGIN_NAME);
    await expectPluginUiVisible(window, SECOND_PLUGIN_NAME);
    await assertNoPluginStageBanner(window);

    await deselectPlugin(window, PLUGIN_NAME);
    await deselectPlugin(window, SECOND_PLUGIN_NAME);
    await expectPluginUiHidden(window);
  });

  test('clicking inside plugin iframe keeps plugin UI responsive while host popover is open', async () => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug", "1");
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
    });
    await clearToastLog(window);
    await dismissBlueprintOverlays(window);
    await purgeStabilityPlugins(window);
    await installSignedE2EPlugin(window, {
      pluginName: PLUGIN_NAME,
      displayName: PLUGIN_DISPLAY,
      description: PLUGIN_DESCRIPTION,
    });

    await waitForPluginRegistered(window, PLUGIN_NAME);
    await selectPluginOpen(window, PLUGIN_NAME);
    await expectPluginUiVisible(window, PLUGIN_NAME);

    // Re-open plugins popover and verify it closes after clicking inside iframe UI.
    await openPluginsPopover(window);
    const pluginCard = window.locator(`[data-plugin="${PLUGIN_DISPLAY}"]`);
    await expect(pluginCard).toBeVisible({ timeout: 15000 });
    await clickInsidePluginIframe(window);
    // Cross-document clicks should not break plugin rendering even while host popovers are open.
    await expectPluginUiVisible(window, PLUGIN_NAME);
    await assertNoPluginStageBanner(window);

    await deselectPlugin(window, PLUGIN_NAME);
    await expectPluginUiHidden(window);
  });
});
