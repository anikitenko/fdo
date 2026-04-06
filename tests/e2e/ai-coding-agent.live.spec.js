const { test, expect, _electron: electron } = require("@playwright/test");
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  expectNoUnexpectedErrorToasts,
} = require("./helpers/electronApp");

const LIVE_ENABLED = process.env.FDO_E2E_LIVE_AI === "1";
const LIVE_PROMPT = process.env.FDO_E2E_LIVE_AI_PROMPT
  || "Can you explain what metadata.name controls in this plugin and whether the visible render heading should usually match it? Do not change code.";
const LIVE_MULTI_FILE_PROMPT = process.env.FDO_E2E_LIVE_AI_MULTI_FILE_PROMPT
  || [
    "Please rename this plugin to Quasar Quill.",
    "Update the plugin metadata name in /index.ts and make /render.tsx show the same visible heading.",
    "Apply the changes in the current plugin workspace only.",
    "If you change multiple files, return executable workspace file sections.",
  ].join(" ");
const LIVE_TIMEOUT_MS = Number(process.env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
const LIVE_PROVIDER = process.env.FDO_E2E_LIVE_AI_PROVIDER
  || (process.env.OPENAI_API_KEY ? "openai" : (process.env.ANTHROPIC_API_KEY ? "anthropic" : "codex-cli"));
const LIVE_API_KEY = process.env.FDO_E2E_LIVE_AI_API_KEY
  || (LIVE_PROVIDER === "openai"
    ? (process.env.OPENAI_API_KEY || "")
    : (LIVE_PROVIDER === "anthropic" ? (process.env.ANTHROPIC_API_KEY || "") : ""));
const LIVE_MODEL = process.env.FDO_E2E_LIVE_AI_MODEL
  || (LIVE_PROVIDER === "openai"
    ? "gpt-5"
    : (LIVE_PROVIDER === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-5-codex"));
const LIVE_ASSISTANT_NAME = process.env.FDO_E2E_LIVE_AI_NAME || "E2E Live Coding Assistant";

let electronApp;
let editorWindow;

test.describe("AI Coding Agent Live Provider", () => {
  test.skip(!LIVE_ENABLED, "Set FDO_E2E_LIVE_AI=1 to run live-provider e2e.");

  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron);
  }, LIVE_TIMEOUT_MS);

  test.beforeEach(async () => {
    editorWindow = await openEditorWithMockedIPC(electronApp, { __useRealAssistants: true });
    await editorWindow.waitForTimeout(1200);
  }, LIVE_TIMEOUT_MS);

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  }, 60000);

  test.afterEach(async () => {
    await expectNoUnexpectedErrorToasts(editorWindow);
  });

  const openAiCodingAssistant = async () => {
    const aiAgentTab = editorWindow.getByRole("tab", { name: "AI Coding Agent" });
    const promptInput = editorWindow.locator("#prompt-input");
    const actionSelect = editorWindow.locator("#action-select");

    await aiAgentTab.click();
    await expect(editorWindow.locator("text=AI Coding Assistant")).toBeVisible({ timeout: 20000 });

    const assistants = await editorWindow.evaluate(async () => {
      try {
        return await window.electron.settings.ai.getAssistants();
      } catch (error) {
        return { __error: error?.message || String(error) };
      }
    });

    let resolvedAssistants = assistants;
    let hasCodingAssistants = Array.isArray(resolvedAssistants)
      && resolvedAssistants.some((assistant) => assistant?.purpose === "coding");
    let provisionedAssistant = false;

    if (!hasCodingAssistants) {
      const provisionResult = await editorWindow.evaluate(async ({ provider, apiKey, model, name }) => {
        if (!window?.electron?.settings?.ai?.addAssistant) {
          return {
            ok: false,
            reason: "window.electron.settings.ai.addAssistant is not available",
          };
        }

        try {
          await window.electron.settings.ai.addAssistant({
            name,
            provider,
            apiKey,
            model,
            purpose: "coding",
            default: true,
          });
          return {
            ok: true,
            assistants: await window.electron.settings.ai.getAssistants(),
          };
        } catch (error) {
          return {
            ok: false,
            reason: error?.message || String(error),
          };
        }
      }, {
        provider: LIVE_PROVIDER,
        apiKey: LIVE_API_KEY,
        model: LIVE_MODEL,
        name: LIVE_ASSISTANT_NAME,
      });

      expect(
        provisionResult?.ok,
        `Failed to provision live coding assistant for provider=${LIVE_PROVIDER} model=${LIVE_MODEL}: ${provisionResult?.reason || "unknown error"}`,
      ).toBeTruthy();

      resolvedAssistants = provisionResult.assistants || [];
      hasCodingAssistants = Array.isArray(resolvedAssistants)
        && resolvedAssistants.some((assistant) => assistant?.purpose === "coding");
      provisionedAssistant = true;
    }

    expect(
      hasCodingAssistants,
      `FDO_E2E_LIVE_AI=1 requires at least one real coding assistant. Received: ${JSON.stringify(resolvedAssistants)}`,
    ).toBeTruthy();

    if (provisionedAssistant) {
      const currentHash = await editorWindow.evaluate(() => window.location.hash);
      await editorWindow.evaluate(() => {
        window.location.hash = "#/";
      });
      await editorWindow.waitForFunction(() => window.location.hash === "#/");
      await editorWindow.evaluate((nextHash) => {
        window.location.hash = nextHash;
      }, currentHash);
      await editorWindow.waitForFunction((expectedHash) => window.location.hash === expectedHash, currentHash);
      await aiAgentTab.click();
      await expect(editorWindow.locator("text=AI Coding Assistant")).toBeVisible({ timeout: 20000 });
    }

    await expect(promptInput).toBeVisible({ timeout: 15000 });
    await expect(actionSelect).toBeVisible({ timeout: 15000 });
    return { promptInput, actionSelect, assistants: resolvedAssistants };
  };

  test("submits live question prompt and keeps workspace file unchanged when auto-apply is off", async () => {
    const { promptInput } = await openAiCodingAssistant();

    const before = await editorWindow.evaluate(() => {
      window.__editorTestApi.createFile("/index.ts", "export const liveSentinel = 'UNCHANGED';\n", "typescript");
      return window.__editorTestApi.getFileContent("/index.ts");
    });

    await promptInput.fill(LIVE_PROMPT);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");

    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({ timeout: 30000 });
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeHidden({ timeout: LIVE_TIMEOUT_MS });

    const after = await editorWindow.evaluate(() => window.__editorTestApi.getFileContent("/index.ts"));
    expect(after).toBe(before);
  }, LIVE_TIMEOUT_MS);

  test("live multi-file auto-apply either updates both plugin files or reports partial apply honestly", async () => {
    const { promptInput, actionSelect } = await openAiCodingAssistant();

    await editorWindow.evaluate(() => {
      window.__editorTestApi.createFile(
        "/index.ts",
        [
          "export default class Test6 extends FDO_SDK {",
          "    public get metadata(): PluginMetadata {",
          "        return {",
          '            name: "Aurora Anvil",',
          '            version: "1.0.0",',
          '            author: "AleXvWaN",',
          '            description: "A sample FDO plugin",',
          '            icon: "cog",',
          "        };",
          "    }",
          "}",
        ].join("\n"),
        "typescript",
      );
      window.__editorTestApi.createFile(
        "/render.tsx",
        [
          "export default function Render() {",
          "  return <h1>My Plugin</h1>;",
          "}",
        ].join("\n"),
        "typescript",
      );
    });

    const autoApply = editorWindow.getByRole("checkbox", { name: /Auto-apply generated changes/i });
    if (!(await autoApply.isChecked())) {
      await editorWindow.evaluate(() => {
        const checkbox = Array.from(document.querySelectorAll('input[type="checkbox"]'))
          .find((input) => /auto-apply generated changes/i.test(input.closest("label")?.innerText || ""));
        checkbox?.click();
      });
    }

    await actionSelect.selectOption("smart");
    await promptInput.fill(LIVE_MULTI_FILE_PROMPT);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");

    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({ timeout: 30000 });
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeHidden({ timeout: LIVE_TIMEOUT_MS });

    const result = await editorWindow.evaluate(() => {
      const indexContent = window.__editorTestApi.getFileContent("/index.ts") || "";
      const renderContent = window.__editorTestApi.getFileContent("/render.tsx") || "";
      const bodyText = document.body?.innerText || "";
      return {
        indexContent,
        renderContent,
        bodyText,
      };
    });

    const indexUpdated = /Quasar Quill/i.test(result.indexContent);
    const renderUpdated = /Quasar Quill/i.test(result.renderContent);
    const honestPartial =
      /Partially Applied/i.test(result.bodyText)
      || /mentioned by the AI but left unchanged/i.test(result.bodyText)
      || /Workspace Updated/i.test(result.bodyText);

    expect(indexUpdated || renderUpdated).toBeTruthy();
    expect((indexUpdated && renderUpdated) || honestPartial).toBeTruthy();
  }, LIVE_TIMEOUT_MS);
});
