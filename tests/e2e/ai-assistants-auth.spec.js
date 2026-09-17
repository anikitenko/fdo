const { test, expect, _electron: electron } = require("@playwright/test");
const { launchElectronApp, closeElectronApp } = require("./helpers/electronApp");

let electronApp;

test.beforeAll(async () => {
  electronApp = await launchElectronApp(electron, { isolatedUserDataDir: true });
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
});

test("AI Assistants auth dialog clears pending state after successful auth check", async () => {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await electronApp.evaluate(() => {
    const { ipcMain, BrowserWindow } = process.mainModule.require("electron");

    const channels = {
      GET: "settings:ai_assistants:get",
      GET_AVAILABLE_MODELS: "settings:ai_assistants:get-available-models",
      ADD: "settings:ai_assistants:add",
      SET_DEFAULT: "settings:ai_assistants:set-default",
      REMOVE: "settings:ai_assistants:remove",
      CODEX_AUTH_STATUS: "settings:ai_assistants:codex-auth-status",
      CODEX_AUTH_LOGIN: "settings:ai_assistants:codex-auth-login",
      CODEX_AUTH_LOGOUT: "settings:ai_assistants:codex-auth-logout",
      CODEX_AUTH_CANCEL: "settings:ai_assistants:codex-auth-cancel",
      UPDATED: "settings:ai_assistants:on_off:updated",
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const now = () => new Date().toISOString();
    const state = {
      assistant: {
        id: "e2e-codex-auth-assistant",
        name: "E2E Codex Assistant",
        provider: "codex-cli",
        model: "gpt-5-codex",
        purpose: "coding",
        default: true,
        executablePath: "/usr/local/bin/codex",
        codexRuntime: { source: "path", version: "1.2.3", bundled: false },
        codexAuth: {
          status: "pending",
          message: "Codex login started in a background utility process. Complete the flow to authenticate.",
          checkedAt: now(),
        },
      },
    };

    const broadcastUpdated = () => {
      const list = [clone(state.assistant)];
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(channels.UPDATED, list);
        }
      }
    };

    const bind = (channel, handler) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    };

    bind(channels.GET, async () => [clone(state.assistant)]);
    bind(channels.GET_AVAILABLE_MODELS, async () => [{ label: "gpt-5-codex", value: "gpt-5-codex", provider: "codex-cli" }]);
    bind(channels.ADD, async () => true);
    bind(channels.SET_DEFAULT, async () => true);
    bind(channels.REMOVE, async () => true);
    bind(channels.CODEX_AUTH_LOGIN, async () => ({ started: true, auth: clone(state.assistant.codexAuth) }));
    bind(channels.CODEX_AUTH_LOGOUT, async () => {
      state.assistant.codexAuth = { status: "unauthorized", message: "Signed out.", checkedAt: now() };
      broadcastUpdated();
      return clone(state.assistant.codexAuth);
    });
    bind(channels.CODEX_AUTH_CANCEL, async () => {
      state.assistant.codexAuth = { status: "cancelled", message: "Codex authentication was cancelled.", checkedAt: now() };
      broadcastUpdated();
      return clone(state.assistant.codexAuth);
    });
    bind(channels.CODEX_AUTH_STATUS, async () => {
      state.assistant.codexAuth = { status: "authorized", message: "Codex CLI is authenticated.", checkedAt: now() };
      broadcastUpdated();
      return clone(state.assistant.codexAuth);
    });
  });

  await window.evaluate(() => {
    localStorage.setItem("activeSettingsTab", "ai");
  });

  const mockProbe = await window.evaluate(async () => {
    const list = await window.electron.settings.ai.getAssistants();
    return {
      count: Array.isArray(list) ? list.length : -1,
      firstName: Array.isArray(list) && list[0] ? list[0].name : "",
      firstStatus: Array.isArray(list) && list[0] ? list[0]?.codexAuth?.status : "",
    };
  });
  expect(mockProbe.count).toBeGreaterThan(0);
  expect(mockProbe.firstName).toBe("E2E Codex Assistant");
  expect(mockProbe.firstStatus).toBe("pending");

  const settingsButton = window.locator('button[aria-label="settings"]').first();
  if ((await settingsButton.count()) === 0) {
    const sidebarToggle = window.locator('button[aria-label="menu-open"], button[aria-label="menu-closed"]').first();
    await expect(sidebarToggle).toBeVisible({ timeout: 30000 });
    await sidebarToggle.click();
  }
  await expect(settingsButton).toBeVisible({ timeout: 30000 });
  await settingsButton.click();
  await expect(window.getByRole("dialog", { name: /Settings/i })).toBeVisible({ timeout: 10000 });

  await window.getByRole("tab", { name: /AI Assistants/i }).click();
  await expect(window.getByRole("heading", { name: "AI Assistants" })).toBeVisible({ timeout: 10000 });
  await expect(window.getByRole("button", { name: "Manage Auth" })).toBeVisible({ timeout: 10000 });
  await expect(window.getByText("Authentication in progress")).toBeVisible({ timeout: 10000 });

  await window.getByRole("button", { name: "Manage Auth" }).click();
  const authDialog = window.getByRole("dialog", { name: /Manage Codex Auth/i });
  await expect(authDialog).toBeVisible({ timeout: 10000 });
  await expect(authDialog.getByText("Authentication in progress")).toBeVisible({ timeout: 10000 });

  await authDialog.getByRole("button", { name: "Check auth" }).click();

  await expect(authDialog.getByText("Authenticated", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(authDialog.getByText("Authentication in progress")).toHaveCount(0);
  await expect(authDialog.getByRole("button", { name: "Done" })).toBeVisible({ timeout: 10000 });
});
