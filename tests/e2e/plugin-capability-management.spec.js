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
  // Use the real SDK lifecycle and diagnostics bridge. A hand-written worker
  // that ignores UI_MESSAGE stalls host diagnostics during capability refresh.
  return `"use strict";
const { FDO_SDK } = require("@anikitenko/fdo-sdk");
class CapabilityManagementPlugin extends FDO_SDK {
  get metadata() {
    return Object.freeze({
      name: "${PLUGIN_DISPLAY}",
      version: "1.0.0",
      author: "E2E",
      description: "Capability management UX test plugin",
      icon: "cog",
    });
  }
  init() {}
  render() {
    return "<div><h3>Capability Management E2E</h3></div>";
  }
}
new CapabilityManagementPlugin();
`;
}

async function ensureRootCertificate(window) {
  await window.evaluate(async () => {
    const hasRootWithKey = async () => {
      const roots = await window.electron.settings.certificates.getRoot();
      return (roots || []).some((item) => item?.label === 'root' && item?.hasPrivateKey);
    };

    if (!(await hasRootWithKey())) {
      const before = await window.electron.settings.certificates.getRoot();
      const beforeIds = new Set((before || []).map((item) => item?.id).filter(Boolean));
      await window.electron.settings.certificates.create().catch(() => {});
      const after = await window.electron.settings.certificates.getRoot();
      const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.hasPrivateKey);
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
  electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true});
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
    const result = await window.electron.plugin.setCapabilities(pluginName, ["system.fs.scope.etc-hosts"]);
    if (!result?.success) throw new Error(result?.error || 'Failed to seed scope grant');
  }, { pluginName: PLUGIN_NAME });
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await dismissBlueprintOverlays(window);

  await window.getByRole('button', { name: /Plugins Activated:/i }).click();
  await window.getByRole('button', { name: 'Manage plugins' }).click();

  await expect(window.getByRole('heading', { name: /Manage Plugins/i })).toBeVisible({ timeout: 10000 });
  await expect(window.locator(`text=${PLUGIN_DISPLAY}`).first()).toBeVisible({ timeout: 10000 });
  const installed = await window.evaluate(id => window.electron.plugin.get(id), PLUGIN_NAME);
  await window.getByRole('button', {name: 'Copy plugin path', exact: true}).click();
  await expect(window.getByRole('status')).toContainText('Path copied to clipboard.');
  const pathLayout = await window.getByRole('button', {name:'Copy plugin path'}).evaluate(button => {
    const code = button.querySelector('code');
    return {whiteSpace:getComputedStyle(code).whiteSpace,overflow:getComputedStyle(code).textOverflow,height:code.getBoundingClientRect().height};
  });
  expect(pathLayout).toMatchObject({whiteSpace:'nowrap',overflow:'ellipsis'});
  expect(pathLayout.height).toBeLessThan(24);
  await expect.poll(() => electronApp.evaluate(({clipboard}) => clipboard.readText())).toBe(installed.plugin.home);
  await window.screenshot({path: test.info().outputPath('manage-plugin-copy-path.png'), animations: 'disabled'});

  await expect(window.locator('text=Capabilities & Privileged Access')).toBeVisible();
  await window.getByRole('button', {name: 'Expand', exact: true}).click();
  await expect(window.locator('text=Privileged host actions')).toBeVisible();
  await expect(window.getByRole('checkbox', {name: 'Filesystem Scope: etc-hosts', exact: true})).toBeChecked();
  await expect(window.getByText('Child capabilities/scopes are present, but base privileged access is disabled.', {exact: true})).toBeVisible();

  await window.getByRole('button', { name: 'Enable required base permission' }).click();
  await window.getByRole('button', { name: 'Save Capabilities' }).click();

  await expect(window.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 10000 });
  const persisted = await window.evaluate(id => window.electron.plugin.get(id), PLUGIN_NAME);
  expect(persisted.plugin.capabilities).toEqual(expect.arrayContaining(['system.host.write', 'system.fs.scope.etc-hosts']));
});
