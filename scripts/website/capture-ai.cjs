"use strict";
// Actual assistant UI with a draft request; no mocked response, credentials or inference.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron, expect } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
} = require("../../tests/e2e/helpers/electronApp");
(async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-site-codex-"));
  let app;
  try {
    app = await launchElectronApp(electron, {
      isolatedUserDataDir: true,
      env: { CODEX_HOME: codexHome },
    });
    const home = await app.firstWindow();
    await home.evaluate(() =>
      window.electron.settings.ai.addAssistant({
        name: "Codex",
        provider: "codex-cli",
        purpose: "coding",
        model: "gpt-5-codex",
        default: true,
      }),
    );
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
    await editor.getByRole("tab", { name: /AI Coding Agent/ }).click();
    await expect(editor.locator("#prompt-input")).toBeVisible({
      timeout: 15000,
    });
    await editor
      .locator("#prompt-input")
      .fill(
        "Review this dashboard plugin’s capability declarations, error states and test coverage. Suggest focused changes while preserving its existing behavior.",
      );
    const popout = app.waitForEvent("window");
    await editor
      .getByRole("button", { name: "Open assistant window", exact: true })
      .click();
    const assistant = await popout;
    await expect(
      assistant.getByRole("button", { name: "Return to editor", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "AI Coding Assistant · FDO")
        .setContentSize(1120, 920),
    );
    await expect(assistant.locator("#prompt-input")).toHaveValue(
      /Review this dashboard plugin/,
    );
    await assistant.screenshot({
      path: path.resolve("website/assets/fdo-ai-coding.png"),
      animations: "disabled",
      scale: "css",
    });
    console.log(
      "Captured the AI Coding Assistant window with an unsent draft request.",
    );
  } finally {
    await closeElectronApp(app);
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
