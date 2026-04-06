const { test, expect, _electron: electron } = require('@playwright/test');
const {
  launchElectronApp,
  closeElectronApp,
  dismissBlueprintOverlays,
} = require('./helpers/electronApp');

let electronApp;

const pluginToken = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PLUGIN_NAME = `e2e-cap-manage-${pluginToken}`;
const PLUGIN_DISPLAY = `E2E Capability Manage ${pluginToken}`;

function buildPluginCode() {
  return `"use strict";
const metadata = Object.freeze({
  name: "${PLUGIN_DISPLAY}",
  version: "1.0.0",
  author: "E2E",
  description: "Capability management UX test plugin",
  icon: "cog",
});

const parentPort = process && process.parentPort ? process.parentPort : null;
const send = (payload) => {
  if (parentPort && typeof parentPort.postMessage === "function") {
    parentPort.postMessage(payload);
    return;
  }
  if (process && typeof process.send === "function") {
    process.send(payload);
  }
};

const onMessage = (handler) => {
  if (parentPort && typeof parentPort.on === "function") {
    parentPort.on("message", handler);
    return;
  }
  if (process && typeof process.on === "function") {
    process.on("message", handler);
  }
};

onMessage((incoming) => {
  const payload = incoming && typeof incoming === "object" && incoming.data ? incoming.data : incoming;
  if (payload?.message === "PLUGIN_READY") {
    send({ type: "PLUGIN_READY", response: { metadata } });
    return;
  }
  if (payload?.message === "PLUGIN_INIT") {
    send({ type: "PLUGIN_INIT", response: {} });
    return;
  }
  if (payload?.message === "PLUGIN_RENDER") {
    send({
      type: "PLUGIN_RENDER",
      response: {
        render: JSON.stringify("<div><h3>Capability Management E2E</h3></div>"),
        onLoad: JSON.stringify("() => {}"),
      },
    });
  }
});
`;
}

async function ensureRootCertificate(window) {
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
}

async function installPlugin(window) {
  await ensureRootCertificate(window);
  const pluginCode = buildPluginCode();
  const result = await window.evaluate(async ({ pluginCode, pluginName, displayName }) => {
    return await window.electron.plugin.deployToMainFromEditor({
      name: pluginName,
      sandbox: `e2e_${pluginName}`,
      entrypoint: 'dist/index.cjs',
      content: pluginCode,
      metadata: {
        name: displayName,
        version: '1.0.0',
        author: 'E2E',
        description: 'Capability management UX test',
        icon: 'cog',
      },
      rootCert: 'root',
    });
  }, { pluginCode, pluginName: PLUGIN_NAME, displayName: PLUGIN_DISPLAY });

  if (!result?.success) {
    throw new Error(`Failed to deploy plugin: ${result?.error || 'unknown error'}`);
  }
}

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron);
});

test.afterAll(async () => {
  if (electronApp) {
    const window = electronApp.windows()?.[0];
    if (window && !window.isClosed()) {
      await window.evaluate(async ({ pluginName }) => {
        try { await window.electron.plugin.deactivate(pluginName); } catch (_) {}
        try { await window.electron.plugin.remove(pluginName); } catch (_) {}
      }, { pluginName: PLUGIN_NAME });
    }
  }
  await closeElectronApp(electronApp);
}, 120000);

test('manage plugins shows friendly capability labels and dependency recovery', async () => {
  test.setTimeout(120000);

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await dismissBlueprintOverlays(window);

  await installPlugin(window);
  await window.evaluate(async ({ pluginName }) => {
    await window.electron.plugin.setCapabilities(pluginName, ["system.fs.scope.etc-hosts"]);
  }, { pluginName: PLUGIN_NAME });
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await dismissBlueprintOverlays(window);

  await window.getByRole('button', { name: /Plugins Activated:/i }).click();
  await window.getByRole('button', { name: 'Manage plugins' }).click();

  await expect(window.getByRole('heading', { name: /Manage Plugins/i })).toBeVisible({ timeout: 10000 });
  await expect(window.locator(`text=${PLUGIN_DISPLAY}`).first()).toBeVisible({ timeout: 10000 });

  await expect(window.locator('text=Capabilities & Privileged Access')).toBeVisible();
  await expect(window.locator('text=Privileged host actions')).toBeVisible();
  await expect(window.locator('text=Scoped filesystem access: etc-hosts')).toBeVisible();
  await expect(window.locator('text=Scoped capabilities are present, but base privileged access is disabled.')).toBeVisible();

  await window.getByRole('button', { name: 'Enable required base permission' }).click();
  await window.getByRole('button', { name: 'Save Capabilities' }).click();

  await expect(window.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 10000 });
});
