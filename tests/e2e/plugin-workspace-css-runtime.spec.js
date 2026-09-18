const {test, expect, _electron: electron} = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const {
  activatePlugin,
  removePlugin,
  selectPluginOpen,
  waitForPluginReady,
  waitForPluginRegistered,
  waitForPluginUiRendered,
} = require("./helpers/sdkExamples.js");
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require("./helpers/electronApp.js");

const workspace = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../fixtures/ai/json-inspector-workspace.json"),
  "utf8",
));
const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pluginName = `e2e-json-inspector-workspace-${token}`;

let electronApp;

async function ensureRootCertificate(window) {
  await window.evaluate(async () => {
    const roots = await window.electron.settings.certificates.getRoot();
    if ((roots || []).some((item) => item?.label === "root" && item?.key)) return;
    const known = new Set((roots || []).map((item) => item?.id).filter(Boolean));
    await window.electron.settings.certificates.create();
    const updated = await window.electron.settings.certificates.getRoot();
    const created = (updated || []).find((item) => item?.id && !known.has(item.id) && item?.key);
    if (created?.id && created.label !== "root") {
      await window.electron.settings.certificates.rename(created.id, "root");
    }
  });
}

test.describe("plugin workspace CSS runtime", () => {
  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true});
  });

  test.afterAll(async () => {
    if (electronApp) {
      const window = electronApp.windows()?.[0];
      if (window && !window.isClosed()) await removePlugin(window, pluginName);
    }
    await closeElectronApp(electronApp);
  }, 120000);

  test("builds, deploys, and renders a stylesheet-importing workspace", async ({}, testInfo) => {
    test.setTimeout(120000);
    const window = await electronApp.firstWindow();
    await window.evaluate(() => {
      window.__E2E__ = true;
      localStorage.setItem("fdo:plugin-stage-debug-ui", "1");
      window.__FDO_PLUGIN_METRICS__ = [];
    });
    await dismissBlueprintOverlays(window);
    await ensureRootCertificate(window);

    const compiled = await window.evaluate((latestContent) => window.electron.plugin.build({latestContent}), workspace);
    expect(compiled.success, compiled.error || "The JSON Inspector fixture did not compile").toBe(true);
    const outputFiles = Array.isArray(compiled.files) ? compiled.files : (compiled.files?.outputFiles || compiled.outputFiles || []);
    const content = outputFiles.find((file) => typeof file?.text === "string")?.text || "";
    expect(content).not.toBe("");

    const deployed = await window.evaluate(async ({name, content}) => window.electron.plugin.deployToMainFromEditor({
      name,
      sandbox: `e2e_json_inspector_${name}`,
      entrypoint: "dist/index.cjs",
      content,
      metadata: {
        name: "JSON Inspector Runtime Fixture",
        version: "1.0.0",
        author: "FDO E2E",
        description: "Verifies compiled CSS imports in a rendered plugin workspace.",
        icon: "search",
      },
      rootCert: "root",
    }), {name: pluginName, content});
    expect(deployed.success, deployed.error || "The JSON Inspector fixture did not deploy").toBe(true);

    await waitForPluginRegistered(window, pluginName);
    expect((await activatePlugin(window, pluginName)).success).toBe(true);
    await waitForPluginReady(window, pluginName);
    await selectPluginOpen(window, pluginName);
    await waitForPluginUiRendered(window, pluginName, 30000);

    const state = await window.evaluate((id) => {
      const iframe = Array.from(document.querySelectorAll("iframe[data-plugin-id]"))
        .find((node) => node.dataset.pluginId === id && node.getAttribute("aria-hidden") !== "true");
      const doc = iframe?.contentDocument;
      return {
        text: String(doc?.body?.innerText || "").trim(),
        styleText: Array.from(doc?.querySelectorAll("style") || []).map((node) => node.textContent || "").join("\n"),
        styledElements: Array.from(doc?.querySelectorAll("[class]") || [])
          .filter((node) => /\bgo\d+/.test(node.className || "")).length,
      };
    }, pluginName);
    expect(state.text).toContain("JSON Inspector");
    expect(state.styledElements).toBeGreaterThan(0);
    expect(state.styleText).toMatch(/@keyframes/i);
    expect(state.styleText).toMatch(/prefers-reduced-motion/i);

    const frame = window.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
    const input = frame.locator('[data-role="json-input"]');
    const action = frame.locator('[data-role="inspect-json"]');
    const result = frame.locator('[data-role="result"]');
    await input.fill('{"service":"payments-api","environment":"production","latencyMs":127,"healthy":true}');
    await action.click();
    await expect(result).toHaveAttribute("data-state", "success", {timeout: 10000});
    await expect(result).toContainText("Top-level item count: 4");

    await input.fill('[{"id":"INC-1042"},{"id":"INC-1043"},{"id":"INC-1044"}]');
    await action.click();
    await expect(result).toHaveAttribute("data-state", "success", {timeout: 10000});
    await expect(result).toContainText("Top-level item count: 3");

    await input.fill('{"service":"payments-api",}');
    await action.click();
    await expect(result).toHaveAttribute("data-state", "error", {timeout: 10000});
    await expect(result).toContainText("Invalid JSON");

    const screenshotPath = testInfo.outputPath("json-inspector-workspace.png");
    await window.locator(`iframe[data-plugin-id="${pluginName}"]`).screenshot({path: screenshotPath});
    await testInfo.attach("json-inspector-workspace.png", {path: screenshotPath, contentType: "image/png"});
  });
});
