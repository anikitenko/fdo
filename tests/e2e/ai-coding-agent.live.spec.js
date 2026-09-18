const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const {evaluatePluginCode} = require("./helpers/pluginBestPractices.cjs");
const {pluginHeading} = require("./helpers/pluginHeading.cjs");
const {evaluateJsonInspectorScenario} = require("./helpers/pluginScenarioRubric.cjs");
const {
  activatePlugin,
  removePlugin,
  selectPluginOpen,
  waitForPluginReady,
  waitForPluginRegistered,
  waitForPluginUiRendered,
} = require("./helpers/sdkExamples.js");
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  expectNoUnexpectedErrorToasts,
} = require("./helpers/electronApp");

const templateModule = {exports: {}};
new Function("module", "exports", require("esbuild").transformSync(
  require("node:fs").readFileSync(require("node:path").resolve("src/components/editor/utils/virtualTemplates.js"), "utf8"),
  {format: "cjs"},
).code)(templateModule, templateModule.exports);

const scenarioCatalogModule = {exports: {}};
new Function("module", "exports", require("esbuild").transformSync(
  require("node:fs").readFileSync(require("node:path").resolve("src/utils/pluginAuthoringScenarioCatalog.js"), "utf8"),
  {format: "cjs"},
).code)(scenarioCatalogModule, scenarioCatalogModule.exports);

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
// A full four-file scenario may make one automatic validation-repair request.
// Keep it bounded, but do not let the normal per-request budget end a valid
// two-request flow midway through workspace application.
const LIVE_SCENARIO_TIMEOUT_MS = Math.max(LIVE_TIMEOUT_MS, 600000);
const LIVE_PROVIDER = process.env.FDO_TEST_AI_PROVIDER || "openai";
const LIVE_API_KEY = process.env.FDO_TEST_AI_API_KEY || "";
const LIVE_MODEL = process.env.FDO_TEST_AI_MODEL || "";
const LIVE_SCENARIO_SEED = process.env.FDO_E2E_PLUGIN_SCENARIO_SEED || "json-inspector-v1";
const LIVE_ARTIFACT_DIR = path.resolve(
  process.cwd(),
  process.env.FDO_E2E_LIVE_AI_ARTIFACT_DIR || "artifacts/live-ai",
);
const JSON_FORMATTER_REFERENCE_IMAGE = path.resolve(
  "tests/fixtures/reference-designs/json-formatter-mobile-reference.jpg",
);
if (LIVE_ENABLED && (!LIVE_API_KEY || !LIVE_MODEL || !["openai", "anthropic"].includes(LIVE_PROVIDER))) {
  throw new Error("Live Editor tests require FDO_TEST_AI_API_KEY, FDO_TEST_AI_MODEL and an openai or anthropic FDO_TEST_AI_PROVIDER. Personal credentials are never used as fallback.");
}
const LIVE_ASSISTANT_NAME = process.env.FDO_E2E_LIVE_AI_NAME || "E2E Live Coding Assistant";

let electronApp;
let editorWindow;
let liveLifecycleEvents = [];

function recordLiveLifecycle(event, details = {}) {
  liveLifecycleEvents.push({event, at: new Date().toISOString(), ...details});
  liveLifecycleEvents = liveLifecycleEvents.slice(-30);
}

async function ensureRootCertificate(window) {
  const hasRoot = await window.evaluate(async () => {
    const roots = await window.electron.settings.certificates.getRoot();
    return (roots || []).some((item) => item?.label === "root" && item?.key);
  });
  if (hasRoot) return;

  await window.evaluate(async () => {
    const before = await window.electron.settings.certificates.getRoot();
    const beforeIds = new Set((before || []).map((item) => item?.id).filter(Boolean));
    await window.electron.settings.certificates.create();
    const after = await window.electron.settings.certificates.getRoot();
    const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.key);
    if (created?.id && created.label !== "root") {
      await window.electron.settings.certificates.rename(created.id, "root");
    }
  });
  const ready = await window.evaluate(async () => {
    const roots = await window.electron.settings.certificates.getRoot();
    return (roots || []).some((item) => item?.label === "root" && item?.key);
  });
  if (!ready) throw new Error("The disposable live-test profile could not create a signing root certificate.");
}

async function capturePluginIframeScreenshot(window, pluginName, screenshotPath) {
  const iframe = window.locator(`iframe[data-plugin-id="${pluginName}"]:not([aria-hidden="true"])`);
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await waitForPluginUiRendered(window, pluginName, 15000);
      await expect(iframe).toBeVisible({timeout: 15000});
      // Screenshot the iframe element rather than a Frame instance: React can
      // replace the iframe during plugin activation, while a Locator resolves
      // the current visible element for each attempt.
      await iframe.screenshot({path: screenshotPath});
      return;
    } catch (error) {
      lastError = error;
      if (!/detached|not attached/i.test(String(error?.message || error)) || attempt === 3) {
        throw error;
      }
      await window.waitForTimeout(250 * attempt);
    }
  }

  throw lastError || new Error("The deployed plugin iframe could not be captured.");
}

async function persistLiveArtifact(sourcePath, filename) {
  await fs.mkdir(LIVE_ARTIFACT_DIR, {recursive: true});
  const destination = path.join(LIVE_ARTIFACT_DIR, filename);
  await fs.copyFile(sourcePath, destination);
  // A stable terminal path is much easier to find than a Playwright attachment,
  // especially because passing test output is normally cleaned up.
  console.log(`Live AI artifact: ${destination}`);
  return destination;
}

async function persistJsonInspectorArtifactStatus(testInfo) {
  await fs.mkdir(LIVE_ARTIFACT_DIR, {recursive: true});
  const screenshotPath = path.join(LIVE_ARTIFACT_DIR, "json-inspector-latest.png");
  const screenshot = await fs.stat(screenshotPath).then((entry) => entry.mtime.toISOString()).catch(() => null);
  const statusPath = path.join(LIVE_ARTIFACT_DIR, "json-inspector-latest.status.json");
  await fs.writeFile(statusPath, JSON.stringify({
    test: testInfo.title,
    status: testInfo.status,
    completedAt: new Date().toISOString(),
    screenshotCapturedAt: screenshot,
    note: testInfo.status === "passed"
      ? "The latest screenshot belongs to this successful run."
      : "The screenshot may be from an earlier successful run; inspect this status before judging it.",
  }, null, 2), "utf8");
  console.log(`Live AI artifact: ${statusPath}`);
}

async function waitForTargetPluginVisualState(window, pluginName, timeout = 30000) {
  const readState = async () => await window.evaluate(async (id) => {
    const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
      .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
    const doc = iframe?.contentDocument;
    const styleText = Array.from(doc?.querySelectorAll('style') || []).map((node) => node.textContent || '').join('\n');
    const styledElements = Array.from(doc?.querySelectorAll('[class]') || [])
      .filter((node) => /\bgo\d+/.test(node.className || '')).length;
    const main = doc?.querySelector('main');
    // A plugin may use <main> as its visual card or as a layout container with
    // a child card. Prefer an explicit panel, then a styled main element. Only
    // inspect a structural child as the card when main itself is unstyled;
    // otherwise a styled result region would be incorrectly measured as the
    // panel.
    const hasGeneratedClass = (node) => /\bgo\d+\b/.test(node?.className || '');
    const panel = doc?.querySelector('[data-role="panel"]')
      || (hasGeneratedClass(main) ? main : null)
      || Array.from(main?.children || []).find((node) => (
        hasGeneratedClass(node) && /^(ARTICLE|SECTION|DIV|MAIN)$/.test(node.tagName)
      ))
      || main;
    const input = doc?.querySelector('[data-role="json-input"]');
    const action = doc?.querySelector('[data-role="inspect-json"]');
    const result = doc?.querySelector('[data-role="result"]');
    const styleFor = (node) => node ? iframe.contentWindow?.getComputedStyle(node) : null;
    const generatedClassesFor = (node) => Array.from(node?.classList || [])
      .filter((className) => /^go\d+$/.test(className));
    const generatedClasses = {
      panel: generatedClassesFor(panel),
      input: generatedClassesFor(input),
      action: generatedClassesFor(action),
      result: generatedClassesFor(result),
    };
    const emittedFor = (classNames) => classNames.some((className) => (
      className !== "go11" && styleText.includes(`.${className}{`)
    ));
    const panelStyle = styleFor(panel);
    const resultStyle = styleFor(result);
    const panelBox = panel?.getBoundingClientRect();
    const inputBox = input?.getBoundingClientRect();
    const actionBox = action?.getBoundingClientRect();
    const resultBox = result?.getBoundingClientRect();
    const viewportWidth = Number(iframe?.contentWindow?.innerWidth || 0);
    const nonTransparent = (color) => Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
    const runtime = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const container = document.querySelector(`[data-plugin-id="${CSS.escape(id)}"][data-plugin-active="true"]`);
    const hostText = String(container?.innerText || '').trim();
    const metrics = (window.__FDO_PLUGIN_METRICS__ || [])
      .filter((entry) => entry?.plugin === id)
      .slice(-12);
    return {
      iframePresent: !!iframe,
      text: String(doc?.body?.innerText || '').trim(),
      html: String(doc?.body?.innerHTML || '').trim().slice(0, 4000),
      styleText,
      styledElements,
      generatedClasses,
      visual: {
        pureCssFoundationApplied: Boolean(
          doc?.querySelector(".pure-form.pure-form-stacked")
          && doc?.querySelector(".pure-button.pure-button-primary")
        ),
        coreStyleClassesEmitted: Object.values(generatedClasses).every(emittedFor),
        panelHasSurface: nonTransparent(panelStyle?.backgroundColor),
        panelHasRoundedCorners: Number.parseFloat(panelStyle?.borderRadius || '0') > 0,
        panelHasPadding: Number.parseFloat(panelStyle?.paddingTop || '0') >= 16,
        inputWidthRatio: viewportWidth > 0 && inputBox ? inputBox.width / viewportWidth : 0,
        inputHasEditorHeight: Boolean(inputBox && inputBox.height >= 120),
        verticalActionFlow: Boolean(inputBox && actionBox && actionBox.top >= inputBox.bottom + 4),
        resultHasSurface: nonTransparent(resultStyle?.backgroundColor)
          || Number.parseFloat(resultStyle?.borderLeftWidth || '0') >= 2,
        resultBelowAction: Boolean(actionBox && resultBox && resultBox.top >= actionBox.bottom + 4),
        panelWidth: panelBox?.width || 0,
        viewportWidth,
      },
      runtimeStatus: runtime?.statuses?.[0] || null,
      hostText: hostText.slice(0, 1200),
      metrics,
    };
  }, pluginName);

  try {
    await window.waitForFunction((id) => {
      const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
        .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
      const body = iframe?.contentDocument?.body;
      const html = String(body?.innerHTML || '');
      const text = String(body?.innerText || '').trim();
      return !html.includes('plugin-page-loader') && /JSON Inspector/i.test(text);
    }, pluginName, {timeout});
  } catch (error) {
    const state = await readState();
    throw new Error(`Target plugin iframe did not render the JSON Inspector UI. ${JSON.stringify(state)}`, {cause: error});
  }

  return readState();
}

async function waitForAssistantRequestToSettle(timeout = LIVE_TIMEOUT_MS) {
  const stopButton = editorWindow.locator('button:has-text("Stop")');
  await expect(stopButton).toBeVisible({timeout: 30000});
  try {
    await expect(stopButton).toHaveCount(0, {timeout});
  } catch (error) {
    const state = await editorWindow.evaluate(() => ({
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      streamResponses: window.__liveAiResponses || [],
      visibleText: String(document.body?.innerText || "").slice(-3000),
    })).catch((readError) => ({readError: String(readError?.message || readError)}));
    const mainProcess = await electronApp?.evaluate(({app, BrowserWindow}) => ({
      ready: app.isReady(),
      lifecycle: globalThis.__FDO_E2E_WINDOW_LIFECYCLE__ || [],
      codingLifecycle: globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [],
      windows: BrowserWindow.getAllWindows().map((window) => ({
        id: window.id,
        destroyed: window.isDestroyed(),
        visible: !window.isDestroyed() && window.isVisible(),
        webContentsDestroyed: window.webContents.isDestroyed(),
        webContentsId: window.webContents.id,
        url: window.webContents.getURL(),
      })),
    })).catch((readError) => ({readError: String(readError?.message || readError)}));
    const playwrightPages = await Promise.all((electronApp?.windows?.() || []).map(async (page, index) => ({
      index,
      closed: page.isClosed(),
      url: await page.url().catch(() => ""),
      isOriginalEditorPage: page === editorWindow,
    }))).catch((readError) => ({readError: String(readError?.message || readError)}));
    const failure = editorWindow?.isClosed()
      ? "Editor window closed before the assistant request settled."
      : "Assistant request did not settle before the live-test deadline.";
    throw new Error(`${failure} ${JSON.stringify({state, lifecycle: liveLifecycleEvents, mainProcess, playwrightPages})}`, {cause: error});
  }
}

test.describe("AI Coding Agent Live Provider", () => {
  // Apply the live-provider budget before hooks and test bodies begin. A
  // single scenario can need a generation and an automatic repair request.
  test.describe.configure({timeout: LIVE_SCENARIO_TIMEOUT_MS});
  test.skip(!LIVE_ENABLED, "Set FDO_E2E_LIVE_AI=1 to run live-provider e2e.");

  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
      OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
    }});
    electronApp.process?.()?.on?.("exit", (code, signal) => {
      recordLiveLifecycle("electron-process-exit", {code, signal});
    });
  }, LIVE_TIMEOUT_MS);

  test.beforeEach(async () => {
    liveLifecycleEvents = [];
    editorWindow = await openEditorWithMockedIPC(electronApp, { __useRealAssistants: true });
    recordLiveLifecycle("editor-window-ready");
    editorWindow.on("close", () => recordLiveLifecycle("editor-window-close"));
    editorWindow.on("crash", () => recordLiveLifecycle("editor-window-crash"));
    await editorWindow.evaluate(() => {
      window.__liveAiResponses = [];
      window.electron.aiCodingAgent.on.streamDone((event) => {
        window.__liveAiResponses.push({requestId: event.requestId, success: true, content: event.fullContent});
      });
      window.electron.aiCodingAgent.on.streamError((event) => {
        window.__liveAiResponses.push({requestId: event.requestId, success: false, error: event.error});
      });
    });
    await editorWindow.waitForTimeout(1200);
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  }, 60000);

  test.afterEach(async ({}, testInfo) => {
    if (!editorWindow || editorWindow.isClosed()) return;
    const observed = await editorWindow.evaluate(() => ({
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      backendResponses: window.__liveAiResponses || [],
      files: Object.fromEntries(["/index.ts", "/render.tsx", "/render.test.ts"].map(file =>
        [file, window.__editorTestApi?.getFileContent(file) || ""])),
    }));
    const report = JSON.stringify({provider: LIVE_PROVIDER, model: LIVE_MODEL, status: testInfo.status,
      durationMs: testInfo.duration, ...observed}, null, 2).split(LIVE_API_KEY).join("[REDACTED]");
    // Persist even with the list reporter, which does not retain body-only attachments.
    const reportPath = testInfo.outputPath("editor-live-result.json");
    await require("node:fs/promises").writeFile(reportPath, report, "utf8");
    await testInfo.attach("editor-live-result.json", {path: reportPath, contentType: "application/json"});
    if (/JSON Inspector/i.test(testInfo.title)) {
      await persistJsonInspectorArtifactStatus(testInfo);
    }
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
        return (await window.electron.settings.ai.getAssistants()).map(({apiKey: _secret, ...item}) => item);
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
            assistants: (await window.electron.settings.ai.getAssistants()).map(({apiKey: _secret, ...item}) => item),
          };
        } catch (error) {
          return {
            ok: false,
            reason: String(error?.message || error).split(apiKey).join("[REDACTED]"),
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
      "Live Editor tests require their dedicated coding assistant.",
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

  const expectSuccessfulResponse = async () => {
    const observed = await editorWindow.evaluate(() => ({
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
    }));
    const error = observed.error.split(LIVE_API_KEY).join("[REDACTED]");
    expect(error, `Editor AI request failed: ${error}`).toBe("");
    expect(observed.response.trim(), "Editor completed without an AI response").not.toBe("");
  };

  test("submits live question prompt and keeps workspace file unchanged in Review first", async () => {
    const { promptInput } = await openAiCodingAssistant();

    const before = await editorWindow.evaluate(() => {
      const files = ["/index.ts", "/render.tsx", "/render.test.ts", "/package.json"];
      return Object.fromEntries(files.map((file) => [file, window.__editorTestApi.getFileContent(file)]));
    });
    expect(before["/index.ts"]).toContain("extends FDO_SDK");
    expect(before["/render.tsx"]).toContain("Refresh status");
    expect(before["/render.test.ts"]).toContain("node:test");

    await editorWindow.getByLabel("Changes", {exact: true}).selectOption("review");
    await promptInput.fill(LIVE_PROMPT);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");

    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({ timeout: 30000 });
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, { timeout: LIVE_TIMEOUT_MS });

    const after = await editorWindow.evaluate(() => {
      const files = ["/index.ts", "/render.tsx", "/render.test.ts", "/package.json"];
      return Object.fromEntries(files.map((file) => [file, window.__editorTestApi.getFileContent(file)]));
    });
    await expectSuccessfulResponse();
    expect(after).toEqual(before);
  }, LIVE_TIMEOUT_MS);

  test("live multi-file edit updates both files and compiles", async () => {
    const { promptInput, actionSelect } = await openAiCodingAssistant();

    await editorWindow.evaluate(({main, render}) => {
      window.__editorTestApi.createFile("/index.ts", main, "typescript");
      window.__editorTestApi.createFile("/render.tsx", render, "typescript");
    }, {main: templateModule.exports.BLANK_TEMPLATE_MAIN("Aurora Anvil"), render: templateModule.exports.BLANK_TEMPLATE_RENDER("Aurora Anvil")});

    await editorWindow.getByLabel("Changes", {exact: true}).selectOption("apply");

    await actionSelect.selectOption("smart");
    await promptInput.fill(LIVE_MULTI_FILE_PROMPT);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");

    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({ timeout: 30000 });
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, { timeout: LIVE_TIMEOUT_MS });

    await expectSuccessfulResponse();
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

    expect(result.indexContent, "Expected the applied /index.ts to contain the new plugin name").toMatch(/Quasar Quill/i);
    expect(pluginHeading({'/index.ts': result.indexContent, '/render.tsx': result.renderContent}),
      "Expected the plugin render call to produce the new heading").toBe('Quasar Quill');
    await expect(editorWindow.getByTestId("ai-conversation-history")).toContainText("rename this plugin");
    await promptInput.fill('Keep the plugin name we just chose. Update only metadata.description in /index.ts to "A focused monitoring plugin." Keep all other behavior and the render heading unchanged.');
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({timeout: 30000});
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, {timeout: LIVE_TIMEOUT_MS});
    await expectSuccessfulResponse();
    const refined = await editorWindow.evaluate(() => ({
      index: window.__editorTestApi.getFileContent("/index.ts"),
      render: window.__editorTestApi.getFileContent("/render.tsx"),
    }));
    expect(refined.index).toContain("A focused monitoring plugin.");
    expect(refined.index).toContain("Quasar Quill");
    expect(refined.render).toBe(result.renderContent);
    expect(pluginHeading({'/index.ts': refined.index, '/render.tsx': refined.render})).toBe('Quasar Quill');
    const compiled = await editorWindow.evaluate(async () => {
      const latestContent = {};
      for (const file of ["/index.ts", "/render.tsx", "/package.json"]) {
        latestContent[file] = window.__editorTestApi.getFileContent(file);
      }
      return window.electron.plugin.build({latestContent});
    });
    expect(compiled.success, compiled.error || "Generated plugin did not compile").toBe(true);
  }, LIVE_TIMEOUT_MS);
  test("live best-practices: reviews broken plugin code without changing files", async () => {
    const {promptInput} = await openAiCodingAssistant();
    const brokenMain = templateModule.exports.BLANK_TEMPLATE_MAIN("Review Fixture")
      .replace(/PluginRegistry\.registerHandler\("refreshStatus", \(\) => \(\{[\s\S]*?\}\)\);/, 'PluginRegistry.registerHandler("refreshStatus", () => { const status = {success: true}; });\n        document.querySelector("#status");');
    const brokenTests = 'test("status", () => { expect(true).toBe(true); });';
    await editorWindow.evaluate(({main, render, tests}) => {
      window.__editorTestApi.createFile('/index.ts', main, 'typescript');
      window.__editorTestApi.createFile('/render.tsx', render, 'typescript');
      window.__editorTestApi.createFile('/render.test.ts', tests, 'typescript');
    }, {main: brokenMain, render: templateModule.exports.BLANK_TEMPLATE_RENDER("Review Fixture"), tests: brokenTests});
    await editorWindow.getByLabel('Changes', {exact: true}).selectOption('review');
    await promptInput.fill('Review /index.ts, /render.tsx and /render.test.ts for correctness and FDO plugin best practices. Identify concrete defects and explain how to fix them. Do not modify files or execute code.');
    await promptInput.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({timeout: 30000});
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, {timeout: LIVE_TIMEOUT_MS});
    await expectSuccessfulResponse();
    const response = await editorWindow.getByTestId('ai-coding-response').innerText();
    expect(response).toMatch(/refreshStatus|registerHandler/);
    expect(response).toMatch(/return|undefined|envelope/i);
    expect(response).toMatch(/document|browser|renderOnLoad/);
    expect(response).toMatch(/node:test|node:assert|expect\(/);
    const after = await editorWindow.evaluate(() => ({main: window.__editorTestApi.getFileContent('/index.ts'), tests: window.__editorTestApi.getFileContent('/render.test.ts')}));
    expect(after.main).toBe(brokenMain);
    expect(after.tests).toBe(brokenTests);
  }, LIVE_TIMEOUT_MS);

  test("live best-practices: generates a plugin with an SDK contract and render tests", async ({}, testInfo) => {
    const {promptInput, actionSelect} = await openAiCodingAssistant();
    await editorWindow.evaluate(({main, render}) => {
      window.__editorTestApi.createFile("/index.ts", main, "typescript");
      window.__editorTestApi.createFile("/render.tsx", render, "typescript");
    }, {main: templateModule.exports.BLANK_TEMPLATE_MAIN("Practice Fixture"), render: templateModule.exports.BLANK_TEMPLATE_RENDER("Practice Fixture")});
    await editorWindow.getByLabel("Changes", {exact: true}).selectOption("apply");
    await actionSelect.selectOption("smart");
    await promptInput.fill('Implement a small plugin named Sentinel Beacon using the supplied SDK and its best practices. Add an Inspect status button that calls a backend handler named inspectStatus and displays its returned status. Use a local deterministic status value: no shell, network, Azure, or host application access. Add /render.test.ts using the bundled node:test runner with at least two meaningful assertions covering the heading and the action target. Keep tests independent of plugin bootstrap. Apply complete plugin workspace files; preserve the supported SDK architecture.');
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({timeout: 30000});
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, {timeout: LIVE_TIMEOUT_MS});
    await expectSuccessfulResponse();
    const files = await editorWindow.evaluate(() => Object.fromEntries(
      window.__editorTestApi.getState().filesKeys.filter(path => !path.startsWith('/node_modules/') && !path.startsWith('/dist/'))
        .map(path => [path, window.__editorTestApi.getFileContent(path)]).filter(([, content]) => typeof content === 'string')));
    await expect(editorWindow.getByRole('button', {name: 'Clear conversation', exact: true})).toBeInViewport({ratio: 1});
    const rubric = evaluatePluginCode(files);
    const reportPath = testInfo.outputPath('plugin-best-practices.json');
    await require('node:fs/promises').writeFile(reportPath, JSON.stringify({rubric, files}, null, 2).split(LIVE_API_KEY).join('[REDACTED]'));
    await testInfo.attach('plugin-best-practices.json', {path: reportPath, contentType: 'application/json'});
    expect(files['/index.ts']).toContain('Sentinel Beacon');
    expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
    const compiled = await editorWindow.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
    expect(compiled.success, compiled.error || 'Generated plugin did not compile').toBe(true);
  }, LIVE_TIMEOUT_MS);

  test("live scenario: builds and verifies a seeded JSON Inspector without external access", async ({}, testInfo) => {
    // Keep Playwright's built-in slow-test multiplier as a compatibility
    // fallback for runners that retain the base 60-second budget despite the
    // live configuration. The explicit deadline still covers a generation
    // followed by one Problems-panel repair pass.
    test.slow(true, "A live workspace generation may require a validation repair pass.");
    test.setTimeout(LIVE_SCENARIO_TIMEOUT_MS);
    console.log(`Live JSON Inspector timeout: ${testInfo.timeout}ms`);
    const scenario = scenarioCatalogModule.exports.selectPluginAuthoringScenario(LIVE_SCENARIO_SEED);
    await editorWindow.evaluate(({main, render, tests}) => {
      window.__editorTestApi.createFile("/index.ts", main, "typescript");
      window.__editorTestApi.createFile("/render.tsx", render, "typescript");
      window.__editorTestApi.createFile("/render.test.ts", tests, "typescript");
    }, {
      main: templateModule.exports.BLANK_TEMPLATE_MAIN("Scenario Fixture"),
      render: templateModule.exports.BLANK_TEMPLATE_RENDER("Scenario Fixture"),
      tests: templateModule.exports.BLANK_TEMPLATE_TEST(),
    });

    // A blank workspace includes this example test. Exercise the same Run Tests
    // action a plugin author uses before asking the model to replace the files.
    const seededTestFile = await editorWindow.evaluate(() => window.__editorTestApi.getFileContent("/render.test.ts"));
    expect(seededTestFile).toContain('from "node:test"');
    await editorWindow.getByRole("button", {name: "Run Tests", exact: true}).click();
    await expect(editorWindow.getByRole("tab", {name: "Tests", exact: true})).toHaveAttribute("aria-selected", "true");
    await expect(editorWindow.getByText("Plugin tests passed.", {exact: true})).toBeVisible({timeout: 30000});

    const {promptInput, actionSelect} = await openAiCodingAssistant();
    await editorWindow.getByLabel("Changes", {exact: true}).selectOption("apply");
    // This is an explicit complete-workspace request. Plan mode avoids an
    // extra Smart-mode routing pass and leaves the provider budget for code.
    await actionSelect.selectOption("plan");
    await promptInput.fill(scenario.prompt);
    // The code editor may retain a caret selection from the seeded file. For a
    // workspace-creation prompt it is optional context, never a prerequisite.
    await expect(editorWindow.getByText("Selection recommended", {exact: true})).toHaveCount(0);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await waitForAssistantRequestToSettle(LIVE_SCENARIO_TIMEOUT_MS);
    await expectSuccessfulResponse();

    const problems = await editorWindow.evaluate(() => {
      const paths = window.__editorTestApi.getState().filesKeys
        .filter((filePath) => !filePath.startsWith("/node_modules/") && !filePath.startsWith("/dist/"));
      return paths.flatMap((filePath) => (window.__editorTestApi.getMarkersForPath?.(filePath) || [])
        .filter((marker) => Number(marker?.severity) >= 8)
        .map((marker) => ({path: filePath, message: marker.message, severity: marker.severity})));
    });
    expect(problems, `The AI agent must repair errors reported by the Problems panel: ${JSON.stringify(problems)}`).toEqual([]);

    const files = await editorWindow.evaluate(() => Object.fromEntries(
      window.__editorTestApi.getState().filesKeys
        .filter(path => !path.startsWith("/node_modules/") && !path.startsWith("/dist/"))
        .map(path => [path, window.__editorTestApi.getFileContent(path)])
        .filter(([, content]) => typeof content === "string"),
    ));
    const rubric = evaluateJsonInspectorScenario(files);
    const metadataIcon = files["/index.ts"]?.match(/\bicon\s*:\s*["']([^"']+)["']/)?.[1] || "";
    expect(metadataIcon, "The JSON Inspector must use the known valid Blueprint icon requested by the scenario").toBe("data-search");
    const compiled = await editorWindow.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
    const testRun = await editorWindow.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
    const report = {seed: LIVE_SCENARIO_SEED, scenario: {
      id: scenario.id, title: scenario.title, designBrief: scenario.designBrief,
    }, defaultTest: {
      path: "/render.test.ts",
      content: seededTestFile,
      executedWith: "Editor Run Tests action",
      result: "passed",
    }, problems, rubric, compiled, testRun, files};
    const reportPath = testInfo.outputPath("json-inspector-scenario.json");
    await require("node:fs/promises").writeFile(
      reportPath,
      JSON.stringify(report, null, 2).split(LIVE_API_KEY).join("[REDACTED]"),
      "utf8",
    );
    await testInfo.attach("json-inspector-scenario.json", {path: reportPath, contentType: "application/json"});

    expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
    expect(compiled.success, compiled.error || "Generated JSON Inspector did not compile").toBe(true);
    expect(testRun.skipped, "The scenario must add node:test tests").toBe(false);
    expect(testRun.success, testRun.output || testRun.error || "Generated JSON Inspector tests failed").toBe(true);

    const compiledOutputFiles = Array.isArray(compiled.files)
      ? compiled.files
      : (compiled.files?.outputFiles || compiled.outputFiles || []);
    const compiledContent = compiledOutputFiles.find((file) => typeof file?.text === "string")?.text || "";
    expect(compiledContent, "The compiler did not return deployable plugin output").not.toBe("");
    const pluginName = `live-json-inspector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await ensureRootCertificate(editorWindow);
      const deployed = await editorWindow.evaluate(async ({content, name}) => {
        return await window.electron.plugin.deployToMainFromEditor({
          name,
          sandbox: `live_ai_${name}`,
          entrypoint: "dist/index.cjs",
          content,
          metadata: {
            name: "Live JSON Inspector Visual Check",
            version: "1.0.0",
            author: "FDO Live Evaluation",
            description: "Disposable visual deployment check for generated plugin CSS.",
            icon: "search",
          },
          rootCert: "root",
        });
      }, {content: compiledContent, name: pluginName});
      expect(deployed.success, deployed.error || "Generated plugin deployment failed").toBe(true);
      await waitForPluginRegistered(editorWindow, pluginName);
      expect((await activatePlugin(editorWindow, pluginName)).success).toBe(true);
      await waitForPluginReady(editorWindow, pluginName);
      await editorWindow.evaluate(() => { window.location.hash = "#/"; });
      await editorWindow.waitForFunction(() => window.location.hash === "#/");
      await selectPluginOpen(editorWindow, pluginName);
      await waitForPluginUiRendered(editorWindow, pluginName, 30000);

      const uiState = await waitForTargetPluginVisualState(editorWindow, pluginName, 30000);
      const screenshotPath = testInfo.outputPath("json-inspector-ui.png");
      const visualStatePath = testInfo.outputPath("json-inspector-visual-state.json");
      await fs.writeFile(visualStatePath, JSON.stringify(uiState, null, 2), "utf8");
      await testInfo.attach("json-inspector-visual-state.json", {path: visualStatePath, contentType: "application/json"});
      await capturePluginIframeScreenshot(editorWindow, pluginName, screenshotPath);
      await testInfo.attach("json-inspector-ui.png", {path: screenshotPath, contentType: "image/png"});
      await persistLiveArtifact(screenshotPath, "json-inspector-latest.png");
      await persistLiveArtifact(visualStatePath, "json-inspector-latest.json");
      expect(uiState.iframePresent).toBe(true);
      expect(uiState.text).toMatch(/JSON Inspector/i);
      expect(uiState.styledElements).toBeGreaterThan(0);
      expect(uiState.styleText).toMatch(/@keyframes/i);
      expect(uiState.styleText).toMatch(/prefers-reduced-motion/i);
      expect(uiState.visual.pureCssFoundationApplied).toBe(true);
      expect(uiState.visual.coreStyleClassesEmitted).toBe(true);
      expect(uiState.visual.panelHasSurface).toBe(true);
      expect(uiState.visual.panelHasRoundedCorners).toBe(true);
      expect(uiState.visual.panelHasPadding).toBe(true);
      expect(uiState.visual.inputWidthRatio).toBeGreaterThanOrEqual(0.55);
      expect(uiState.visual.inputHasEditorHeight).toBe(true);
      expect(uiState.visual.verticalActionFlow).toBe(true);
      expect(uiState.visual.resultHasSurface).toBe(true);
      expect(uiState.visual.resultBelowAction).toBe(true);

      const frame = editorWindow.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
      const input = frame.locator('[data-role="json-input"]');
      const action = frame.locator('[data-role="inspect-json"]');
      const result = frame.locator('[data-role="result"]');
      const interactions = [];
      const exercise = async ({id, json, state, expectedText}) => {
        await input.fill(json);
        await action.click();
        await expect(result).toHaveAttribute("data-state", state, {timeout: 10000});
        const text = await result.innerText();
        expect(text).toMatch(expectedText);
        const interactionScreenshotPath = testInfo.outputPath(`json-inspector-${id}.png`);
        await capturePluginIframeScreenshot(editorWindow, pluginName, interactionScreenshotPath);
        await testInfo.attach(`json-inspector-${id}.png`, {path: interactionScreenshotPath, contentType: "image/png"});
        await persistLiveArtifact(interactionScreenshotPath, `json-inspector-${id}-latest.png`);
        interactions.push({id, json, state, result: text});
      };

      await exercise({
        id: "valid-service",
        json: '{"service":"payments-api","environment":"production","latencyMs":127,"healthy":true}',
        state: "success",
        expectedText: /object[\s\S]*service/i,
      });
      await exercise({
        id: "valid-array",
        json: '[{"id":"INC-1042"},{"id":"INC-1043"},{"id":"INC-1044"}]',
        state: "success",
        expectedText: /array[\s\S]*3/i,
      });
      await exercise({
        id: "invalid-json",
        json: '{"service":"payments-api",}',
        state: "error",
        expectedText: /invalid|error|parse|malformed/i,
      });
      const interactionReportPath = testInfo.outputPath("json-inspector-interactions.json");
      await fs.writeFile(interactionReportPath, JSON.stringify(interactions, null, 2), "utf8");
      await testInfo.attach("json-inspector-interactions.json", {path: interactionReportPath, contentType: "application/json"});
      await persistLiveArtifact(interactionReportPath, "json-inspector-interactions-latest.json");
    } finally {
      await removePlugin(editorWindow, pluginName);
    }
  });

  test("live visual reference: creates a polished JSON Inspector from a supplied mobile mockup", async ({}, testInfo) => {
    await editorWindow.evaluate(({main, render, tests}) => {
      window.__editorTestApi.createFile("/index.ts", main, "typescript");
      window.__editorTestApi.createFile("/render.tsx", render, "typescript");
      window.__editorTestApi.createFile("/render.test.ts", tests, "typescript");
    }, {
      main: templateModule.exports.BLANK_TEMPLATE_MAIN("Reference Fixture"),
      render: templateModule.exports.BLANK_TEMPLATE_RENDER("Reference Fixture"),
      tests: templateModule.exports.BLANK_TEMPLATE_TEST(),
    });
    const {promptInput, actionSelect} = await openAiCodingAssistant();
    await editorWindow.getByLabel("Changes", {exact: true}).selectOption("apply");
    await actionSelect.selectOption("plan");
    const referenceInput = editorWindow.locator('input[type="file"][accept="image/*"]');
    await expect(referenceInput).toBeAttached();
    await referenceInput.setInputFiles(JSON_FORMATTER_REFERENCE_IMAGE);
    await expect(editorWindow.getByAltText("UI Mockup")).toBeVisible();
    await testInfo.attach("json-formatter-mobile-reference.jpg", {
      path: JSON_FORMATTER_REFERENCE_IMAGE,
      contentType: "image/jpeg",
    });
    await promptInput.fill([
      "Create an original, polished JSON Inspector plugin using the supplied mobile JSON Formatter mockup as a visual reference.",
      "Do not copy its product name, logo, or text. Preserve its information hierarchy: a compact toolbar, quiet pale canvas, dark blue-gray typography, warm amber primary control, segmented input/result tabs, and a bordered monospace editor card.",
      "Use only local deterministic data. Implement inspectJson in init(), return normal {valid:false, message} validation payloads, and use data-role=json-input, inspect-json, and result.",
      "Set metadata.icon to exactly data-search. Create exactly /index.ts, /render.tsx, /styles.css, and /render.test.ts. Use node:test plus node:assert/strict.",
      "Use injected Pure CSS first: a pure-form pure-form-stacked wrapper and exactly pure-button pure-button-primary for the main action; use pure-g/pure-u-* only when a responsive grid improves the layout. Do not import Pure CSS. Import styles.css as a style map. Every panel, input, action, and result region must receive a non-empty class from dom.createClassFromStyle(css.<class>); never use css[\".<class>\"].",
      "The result must render as an original responsive tool: center the panel, limit its readable width, give it a distinct surface, spacing, rounded border, and shadow; make the editor full-width and at least 12rem tall; stack the primary action below it; and show a separate result card.",
      "Include @keyframes and a literal @media (prefers-reduced-motion: reduce) rule that disables animation. Return only complete workspace file sections under 190 lines. No shell, network, credentials, host files, or external dependencies.",
    ].join(" "));
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({timeout: 30000});
    await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, {timeout: LIVE_TIMEOUT_MS});
    await expectSuccessfulResponse();

    const files = await editorWindow.evaluate(() => Object.fromEntries(
      window.__editorTestApi.getState().filesKeys
        .filter(path => !path.startsWith("/node_modules/") && !path.startsWith("/dist/"))
        .map(path => [path, window.__editorTestApi.getFileContent(path)])
        .filter(([, content]) => typeof content === "string"),
    ));
    const rubric = evaluateJsonInspectorScenario(files);
    const compiled = await editorWindow.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
    const testRun = await editorWindow.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
    const reportPath = testInfo.outputPath("json-inspector-reference-scenario.json");
    await fs.writeFile(reportPath, JSON.stringify({rubric, compiled, testRun, files}, null, 2), "utf8");
    await testInfo.attach("json-inspector-reference-scenario.json", {path: reportPath, contentType: "application/json"});
    expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
    expect(compiled.success, compiled.error || "Reference-inspired JSON Inspector did not compile").toBe(true);
    expect(testRun.success, testRun.output || testRun.error || "Reference-inspired JSON Inspector tests failed").toBe(true);

    const compiledOutputFiles = Array.isArray(compiled.files)
      ? compiled.files
      : (compiled.files?.outputFiles || compiled.outputFiles || []);
    const content = compiledOutputFiles.find((file) => typeof file?.text === "string")?.text || "";
    const pluginName = `live-json-reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await ensureRootCertificate(editorWindow);
      const deployed = await editorWindow.evaluate(async ({content, name}) => await window.electron.plugin.deployToMainFromEditor({
        name,
        sandbox: `live_ai_${name}`,
        entrypoint: "dist/index.cjs",
        content,
        metadata: {
          name: "Live JSON Inspector Reference Check",
          version: "1.0.0",
          author: "FDO Live Evaluation",
          description: "Disposable visual check using a supplied mobile reference.",
          icon: "data-search",
        },
        rootCert: "root",
      }), {content, name: pluginName});
      expect(deployed.success, deployed.error || "Reference-inspired plugin deployment failed").toBe(true);
      await waitForPluginRegistered(editorWindow, pluginName);
      expect((await activatePlugin(editorWindow, pluginName)).success).toBe(true);
      await waitForPluginReady(editorWindow, pluginName);
      await editorWindow.evaluate(() => { window.location.hash = "#/"; });
      await selectPluginOpen(editorWindow, pluginName);
      await waitForPluginUiRendered(editorWindow, pluginName, 30000);
      const uiState = await waitForTargetPluginVisualState(editorWindow, pluginName, 30000);
      const screenshotPath = testInfo.outputPath("json-inspector-reference.png");
      await capturePluginIframeScreenshot(editorWindow, pluginName, screenshotPath);
      await testInfo.attach("json-inspector-reference.png", {path: screenshotPath, contentType: "image/png"});
      await persistLiveArtifact(screenshotPath, "json-inspector-reference-latest.png");
      expect(uiState.visual.pureCssFoundationApplied).toBe(true);
      expect(uiState.visual.coreStyleClassesEmitted).toBe(true);
      expect(uiState.visual.panelHasSurface).toBe(true);
      expect(uiState.visual.panelHasRoundedCorners).toBe(true);
      expect(uiState.visual.panelHasPadding).toBe(true);
      expect(uiState.visual.inputWidthRatio).toBeGreaterThanOrEqual(0.55);
      expect(uiState.visual.inputHasEditorHeight).toBe(true);
      expect(uiState.visual.verticalActionFlow).toBe(true);
      expect(uiState.visual.resultHasSurface).toBe(true);
      expect(uiState.visual.resultBelowAction).toBe(true);
    } finally {
      await removePlugin(editorWindow, pluginName);
    }
  });

  for (const scenario of [
    {id: "sdk-contract", prompt: "Explain PluginRegistry.registerHandler in init, returning a response to window.createBackendReq, and why browser code belongs in renderOnLoad. Do not modify code.", terms: ["registerHandler", "init", "renderOnLoad", "createBackendReq"]},
    {id: "azure-cli", prompt: "я хочу плагін для моніторингу Azure через az cli з вибором subscription та resource group. Explain a plugin-only implementation, permission checks and node:test coverage. Do not run az or change Azure resources.", terms: ["az", "subscription", "node:test"]},
  ]) {
    test(`live quality: ${scenario.id}`, async ({}, testInfo) => {
      const {promptInput, actionSelect} = await openAiCodingAssistant();
      await editorWindow.getByLabel("Changes", {exact: true}).selectOption("review");
      await actionSelect.selectOption("smart");
      await promptInput.fill(scenario.prompt);
      await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
      await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({timeout: 30000});
      await expect(editorWindow.locator('button:has-text("Stop")')).toHaveCount(0, {timeout: LIVE_TIMEOUT_MS});
      await expectSuccessfulResponse();
      const response = editorWindow.getByTestId("ai-coding-response");
      await expect(response).toBeVisible();
      const result = {success: true, content: await response.innerText()};
      const report = JSON.stringify({provider: LIVE_PROVIDER, model: LIVE_MODEL, result}, null, 2).split(LIVE_API_KEY).join("[REDACTED]");
      await testInfo.attach(`${scenario.id}.json`, {body: report, contentType: "application/json"});
      expect(result.success, result.error || "Provider failed").toBe(true);
      expect(result.content.trim().length).toBeGreaterThan(0);
      for (const term of scenario.terms) expect(result.content.toLowerCase()).toContain(term.toLowerCase());
      expect(result.content).not.toMatch(/(?:import|require).*?["']electron["']/);
    }, LIVE_TIMEOUT_MS);
  }

});
