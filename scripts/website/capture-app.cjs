"use strict";
// Genuine app UI, a disposable profile and a built-in template. No mocked IPC.
// Run from the repository root after npm run build.
const path = require("node:path");
const { _electron: electron, expect } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
} = require("../../tests/e2e/helpers/electronApp");
const {
  ensureRootSigningCertificate,
} = require("../../tests/e2e/helpers/rootCertificate");
const output = path.resolve("website/assets");
const shot = async (page, name) => {
  await page.screenshot({
    path: path.join(output, name),
    animations: "disabled",
    scale: "css",
  });
  console.log("Captured " + name);
};
(async () => {
  const app = await launchElectronApp(electron, { isolatedUserDataDir: true });
  try {
    const home = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
    );
    await home.getByLabel("Open command search").click();
    await home.locator(".bp6-omnibar input").fill("Create Plugin");
    await home.getByRole("menuitem", { name: /Create Plugin/ }).click();
    const creation = home.getByRole("dialog", {
      name: "Create Plugin",
      exact: true,
    });
    await creation
      .getByLabel("Name", { exact: true })
      .fill("Operations overview");
    await creation
      .getByRole("button", { name: "Dashboard template", exact: true })
      .click();
    await shot(home, "fdo-templates.png");
    // Open the same selected template through the real editor IPC.
    await creation.getByRole("button", { name: "Close", exact: true }).click();
    const opening = app.waitForEvent("window");
    await home.evaluate(() =>
      window.electron.system.openEditorWindow({
        name: "Operations overview",
        template: "dashboard",
      }),
    );
    const editor = await opening;
    await editor.waitForFunction(
      () => window.__editorTestApi?.getState?.().currentVersion,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("#/editor"))
        .setContentSize(1440, 960),
    );
    const tree = await editor.evaluate(
      () => window.__editorTestApi.getState().workspaceTreeIds,
    );
    console.log(
      "Workspace files",
      tree.filter((p) => !p.startsWith("/node_modules")).slice(0, 20),
    );
    const renderFile = tree.find((p) => /^\/render\.[jt]sx?$/.test(p));
    if (renderFile)
      await editor
        .getByText(path.basename(renderFile), { exact: true })
        .first()
        .dblclick();
    await editor
      .locator(".monaco-editor")
      .first()
      .waitFor({ state: "visible" });
    await shot(editor, "fdo-editor.png");
    const previewOpening = app.waitForEvent("window");
    await editor
      .getByRole("button", { name: "Live UI editor", exact: true })
      .click();
    const visual = await previewOpening;
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("#/live-ui"))
        .setContentSize(1440, 1000),
    );
    const frame = visual.frameLocator('iframe[title="Plugin UI preview"]');
    await expect(frame.getByRole("heading").first()).toBeVisible({
      timeout: 30000,
    });
    await visual
      .getByRole("button", {
        name: "p · Demo metrics · Use Refresh or the plugin sidebar to explore",
        exact: true,
      })
      .click();
    await shot(visual, "fdo-live-ui.png");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("#/editor"))
        .focus(),
    );
    await ensureRootSigningCertificate(editor);
    await editor.getByRole("button", { name: "Deploy", exact: true }).click();
    await expect(
      editor
        .getByRole("region", { name: "Actions", exact: true })
        .getByText("Deployment complete", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    console.log("Demo plugin deployed through real test/build/sign pipeline.");
    const saved = editor.waitForEvent("close");
    await editor
      .getByRole("button", { name: "Save & Close", exact: true })
      .click();
    await saved;
    console.log("Authored source saved alongside the signed bundle.");
    await home.reload();
    const running = home.frameLocator(
      'iframe[data-plugin-id="operations-overview"]',
    );
    await expect(
      running.getByRole("heading", {
        name: "Operations overview",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await running
      .getByRole("button", { name: "Refresh dashboard", exact: true })
      .click();
    await expect(running.getByRole("status")).toContainText(
      "Demo dashboard refreshed",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes("#/live-ui"))
        .setContentSize(1200, 740),
    );
    // The homepage hero is a user-supplied Azure FinOps screenshot.
    // Recapturing supporting UI must not replace that image.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes("#/live-ui"))
        .setContentSize(1440, 1000),
    );
    await home.getByRole("button", { name: /Plugins Activated:/ }).click();
    await home
      .getByRole("button", { name: "Manage plugins", exact: true })
      .click();
    await expect(
      home.getByRole("button", { name: "Export As…", exact: true }),
    ).toBeVisible();
    await shot(home, "fdo-plugin-management.png");
    await home.getByRole("button", { name: "Export As…", exact: true }).click();
    const exporting = home.getByRole("dialog", { name: /Export As ·/ });
    await exporting.getByLabel("Export format").selectOption("web");
    await expect(
      exporting.getByText("Application conversion prepared", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await shot(home, "fdo-export.png");
    await exporting.getByText(/Container CLI tools ·/).click();
    await exporting
      .getByRole("button", { name: "Installation guide", exact: true })
      .click();
    const guide = home.getByRole("dialog", {
      name: "Container tool installation guide",
      exact: true,
    });
    await guide
      .getByLabel("How is the tool distributed?")
      .selectOption("image");
    await shot(home, "fdo-tool-guide.png");
  } finally {
    await closeElectronApp(app);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
