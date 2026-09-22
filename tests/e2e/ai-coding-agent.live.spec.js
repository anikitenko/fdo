const {readLiveAiConfig, findLiveCodingAssistant} = require("../../scripts/lib/live-ai-config.cjs");
const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const {observeLiveAiPage, describeLiveAiWaitFailure, readLiveAiMainProcess} = require("./helpers/liveAiLifecycle.cjs");
const {waitForAssistantUiToSettle} = require("./helpers/assistantRequestWait.cjs");
const {evaluatePluginCode} = require("./helpers/pluginBestPractices.cjs");
const {pluginHeading} = require("./helpers/pluginHeading.cjs");
const {evaluateJsonInspectorScenario, evaluateRoseCalculatorScenario, evaluateWebToolsWorkbenchScenario} = require("./helpers/pluginScenarioRubric.cjs");
const {runJsonInspectorLiveScenario} = require("./live-ai-scenarios/json-inspector.cjs");
const {runRoseCalculatorLiveScenario} = require("./live-ai-scenarios/rose-calculator.cjs");
const {runWebToolsWorkbenchLiveScenario} = require("./live-ai-scenarios/web-tools-workbench.cjs");
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
const LIVE_API_KEY = LIVE_PROVIDER === "ollama" ? "" : process.env.FDO_TEST_AI_API_KEY || "";
const LIVE_MODEL = process.env.FDO_TEST_AI_MODEL || "";
const LIVE_SCENARIO_SEED = process.env.FDO_E2E_PLUGIN_SCENARIO_SEED || "json-inspector-v1";
const LIVE_ROSE_CALCULATOR_SEED = process.env.FDO_E2E_ROSE_CALCULATOR_SEED || "rose-calculator-v1";
const LIVE_WEB_TOOLS_WORKBENCH_SEED = process.env.FDO_E2E_WEB_TOOLS_WORKBENCH_SEED || "web-tools-workbench-v1";
const LIVE_ARTIFACT_DIR = path.resolve(
  process.cwd(),
  process.env.FDO_E2E_LIVE_AI_ARTIFACT_DIR || "artifacts/live-ai",
);
const JSON_FORMATTER_REFERENCE_IMAGE = path.resolve(
  "tests/fixtures/reference-designs/json-formatter-mobile-reference.jpg",
);
const WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE = path.resolve(
  "tests/fixtures/reference-designs/web-tools-workbench-dashboard-reference.png",
);
if (LIVE_ENABLED) readLiveAiConfig();
const LIVE_ASSISTANT_NAME = process.env.FDO_E2E_LIVE_AI_NAME || "E2E Live Coding Assistant";

let electronApp;
let editorWindow;
let liveLifecycleEvents = [];
let stopObservingPage;
let liveWaitFailure;
let liveRequestConfiguration;

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

async function persistRoseCalculatorArtifactStatus(testInfo) {
  await fs.mkdir(LIVE_ARTIFACT_DIR, {recursive: true});
  const screenshotPath = path.join(LIVE_ARTIFACT_DIR, "rose-calculator-latest.png");
  const screenshot = await fs.stat(screenshotPath).then((entry) => entry.mtime.toISOString()).catch(() => null);
  const statusPath = path.join(LIVE_ARTIFACT_DIR, "rose-calculator-latest.status.json");
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

async function persistWebToolsWorkbenchArtifactStatus(testInfo) {
  await fs.mkdir(LIVE_ARTIFACT_DIR, {recursive: true});
  const screenshotPath = path.join(LIVE_ARTIFACT_DIR, "web-tools-workbench-latest.png");
  const screenshot = await fs.stat(screenshotPath).then((entry) => entry.mtime.toISOString()).catch(() => null);
  const statusPath = path.join(LIVE_ARTIFACT_DIR, "web-tools-workbench-latest.status.json");
  await fs.writeFile(statusPath, JSON.stringify({
    test: testInfo.title,
    status: testInfo.status,
    completedAt: new Date().toISOString(),
    screenshotCapturedAt: screenshot,
    note: testInfo.status === "passed"
      ? "The latest screenshots belong to this successful run."
      : "Screenshots may be from an earlier successful run; inspect this status before judging them.",
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

async function waitForRoseCalculatorVisualState(window, pluginName, timeout = 30000) {
  const readState = async () => await window.evaluate(async (id) => {
    const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
      .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
    const doc = iframe?.contentDocument;
    const styleText = Array.from(doc?.querySelectorAll('style') || []).map((node) => node.textContent || '').join('\n');
    const shell = doc?.querySelector('[data-role="calculator-shell"]');
    const display = doc?.querySelector('[data-role="calculator-display"]');
    const quickActions = doc?.querySelector('[data-role="calculator-quick-actions"]');
    const sidebar = doc?.querySelector('[data-role="calculator-sidebar"]');
    const result = doc?.querySelector('[data-role="calculator-result"]');
    const cat = doc?.querySelector('[data-role="calculator-cat"]');
    const catPartRoles = [
      "calculator-cat-head", "calculator-cat-ear-left", "calculator-cat-ear-right",
      "calculator-cat-eye-left", "calculator-cat-eye-right", "calculator-cat-tail",
    ];
    const catParts = catPartRoles.map((role) => doc?.querySelector(`[data-role="${role}"]`));
    const styleFor = (node) => node ? iframe?.contentWindow?.getComputedStyle(node) : null;
    const shellStyle = styleFor(shell);
    const catStyle = styleFor(cat);
    const shellBox = shell?.getBoundingClientRect();
    const catBox = cat?.getBoundingClientRect();
    const displayBox = display?.getBoundingClientRect();
    const sidebarBox = sidebar?.getBoundingClientRect();
    const viewportWidth = Number(iframe?.contentWindow?.innerWidth || 0);
    const viewportHeight = Number(iframe?.contentWindow?.innerHeight || 0);
    const nonTransparent = (color) => Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
    const hasSurface = (style) => nonTransparent(style?.backgroundColor) || style?.backgroundImage !== 'none';
    return {
      iframePresent: !!iframe,
      text: String(doc?.body?.innerText || '').trim(),
      html: String(doc?.body?.innerHTML || '').trim().slice(0, 5000),
      styleText,
      styledElements: Array.from(doc?.querySelectorAll('[class]') || []).filter((node) => /\bgo\d+/.test(node.className || '')).length,
      roles: {
        shell: !!shell,
        display: !!display,
        result: !!result,
        quickActions: !!quickActions,
        sidebar: !!sidebar,
        cat: !!cat,
      },
      catParts: Object.fromEntries(catPartRoles.map((role, index) => [role, !!catParts[index]])),
      visual: {
        shellHasSurface: hasSurface(shellStyle),
        shellHasRoundedCorners: Number.parseFloat(shellStyle?.borderRadius || '0') > 0,
        shellHasPadding: Number.parseFloat(shellStyle?.paddingTop || '0') >= 16,
        shellHasShadowOrBorder: shellStyle?.boxShadow !== 'none' || Number.parseFloat(shellStyle?.borderTopWidth || '0') > 0,
        displayIsUsable: Boolean(displayBox && displayBox.width >= Math.min(180, viewportWidth * 0.45) && displayBox.height >= 32),
        sidebarPresentBesideMain: Boolean(shellBox && sidebarBox && viewportWidth >= 500 && sidebarBox.left > shellBox.left),
        catIsFullBackgroundArtwork: Boolean(cat && catParts.every(Boolean) && !shell?.contains(cat)
          && catStyle?.position === 'fixed' && [catStyle?.top, catStyle?.right, catStyle?.bottom, catStyle?.left].every((value) => value === '0px')
          && catStyle?.pointerEvents === 'none' && Number.parseFloat(catStyle?.opacity || '0') >= .3
          && Number.parseFloat(catStyle?.opacity || '1') <= .75 && catBox?.width >= viewportWidth * .9
          && catBox?.height >= viewportHeight * .9),
        catSize: {width: catBox?.width || 0, height: catBox?.height || 0, opacity: catStyle?.opacity || ''},
      },
    };
  }, pluginName);

  try {
    await window.waitForFunction((id) => {
      const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
        .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
      const body = iframe?.contentDocument?.body;
      const html = String(body?.innerHTML || '');
      const text = String(body?.innerText || '').trim();
      return !html.includes('plugin-page-loader') && /Rose Calculator/i.test(text);
    }, pluginName, {timeout});
  } catch (error) {
    const state = await readState();
    throw new Error(`Target plugin iframe did not render the Rose Calculator UI. ${JSON.stringify(state)}`, {cause: error});
  }

  return readState();
}

async function waitForWebToolsWorkbenchVisualState(window, pluginName, timeout = 30000) {
  const readState = async () => await window.evaluate(async (id) => {
    const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
      .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
    const doc = iframe?.contentDocument;
    const styleText = Array.from(doc?.querySelectorAll('style') || []).map((node) => node.textContent || '').join('\n');
    const shell = doc?.querySelector('[data-role="tool-workbench"]');
    const dashboard = doc?.querySelector('[data-role="tool-dashboard"]');
    const library = doc?.querySelector('[data-role="tool-library"]');
    const workspace = doc?.querySelector('[data-role="tool-workspace"]');
    const personalSpace = doc?.querySelector('[data-role="tool-space-dialog"]');
    const dock = doc?.querySelector('footer') || doc?.querySelector('[data-role="tool-dock"]');
    const styleFor = (node) => node ? iframe?.contentWindow?.getComputedStyle(node) : null;
    const dashboardGridContainer = [dashboard, ...Array.from(dashboard?.querySelectorAll("*") || [])]
      .find((node) => {
        const style = styleFor(node);
        return style?.display === "grid" && Number(node?.children?.length || 0) >= 2;
      });
    const shellStyle = styleFor(shell);
    const dashboardGridStyle = styleFor(dashboardGridContainer);
    const dockStyle = styleFor(dock);
    const shellBox = shell?.getBoundingClientRect();
    const viewportHeight = Number(iframe?.contentWindow?.innerHeight || 0);
    const nonTransparent = (color) => Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
    return {
      iframePresent: !!iframe,
      text: String(doc?.body?.innerText || '').trim(),
      html: String(doc?.body?.innerHTML || '').trim().slice(0, 6000),
      styleText,
      styledElements: Array.from(doc?.querySelectorAll('[class]') || []).filter((node) => /\bgo\d+/.test(node.className || '')).length,
      roles: {
        shell: !!shell,
        dashboard: !!dashboard,
        library: !!library,
        workspace: !!workspace,
        personalSpace: !!personalSpace,
      },
      visual: {
        darkShell: (nonTransparent(shellStyle?.backgroundColor) || shellStyle?.backgroundImage !== 'none')
          && /(?:rgb\(\s*(?:[0-7]?\d|8\d)|#(?:0|1|2|3)[0-9a-f]{2})/i.test(`${shellStyle?.backgroundColor || ''} ${shellStyle?.backgroundImage || ''}`),
        dashboardGrid: dashboardGridStyle?.display === "grid"
          && Number(dashboardGridContainer?.children?.length || 0) >= 2,
        hasDock: !!dock && (dockStyle?.position === 'sticky' || dockStyle?.position === 'fixed'
          || Number.parseFloat(dockStyle?.borderTopWidth || '0') > 0),
        shellUsesViewport: Boolean(shellBox && shellBox.height >= Math.min(300, viewportHeight * .7)),
      },
    };
  }, pluginName);

  try {
    await window.waitForFunction((id) => {
      const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
        .find((node) => node?.dataset?.pluginId === id && node.getAttribute('aria-hidden') !== 'true');
      const body = iframe?.contentDocument?.body;
      const html = String(body?.innerHTML || '');
      const text = String(body?.innerText || '').trim();
      return !html.includes('plugin-page-loader') && /Web Tools Workbench/i.test(text)
        && Boolean(iframe?.contentDocument?.querySelector('[data-role="tool-dashboard"]'));
    }, pluginName, {timeout});
  } catch (error) {
    const state = await readState();
    const host = await window.evaluate(async (id) => ({
      url: window.location.href,
      text: String(document.querySelector('#plugin-container')?.innerText || document.body?.innerText || '').slice(0, 2000),
      runtime: await window.electron.plugin.getRuntimeStatus([id]).catch(() => null),
    }), pluginName).catch(readError => ({readError: readError.message}));
    throw new Error(`Target plugin iframe did not render the Web Tools Workbench UI. ${JSON.stringify({state, host})}`, {cause: error});
  }

  return readState();
}

async function waitForAssistantRequestToSettle(timeout = LIVE_TIMEOUT_MS) {
  const testInfo = test.info();
  try {
    await waitForAssistantUiToSettle(editorWindow, timeout);
  } catch (error) {
    const state = await editorWindow.evaluate(() => ({
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      streamResponses: window.__liveAiResponses || [],
      visibleText: String(document.body?.innerText || "").slice(-3000),
    })).catch((readError) => ({readError: String(readError?.message || readError)}));
    const mainProcess = await electronApp?.evaluate(readLiveAiMainProcess)
      .catch((readError) => ({readError: String(readError?.message || readError)}));
    const playwrightPages = await Promise.all((electronApp?.windows?.() || []).map(async (page, index) => ({
      index,
      closed: page.isClosed(),
      url: page.url(),
      isOriginalEditorPage: page === editorWindow,
    }))).catch((readError) => ({readError: String(readError?.message || readError)}));
    const failure = describeLiveAiWaitFailure(editorWindow?.isClosed(), mainProcess, testInfo.status === "timedOut");
    liveWaitFailure = {failure, state, lifecycle: [...liveLifecycleEvents], mainProcess, playwrightPages,
      runner: {node: process.version, playwright: require("@playwright/test/package.json").version}};
    throw new Error(`${failure} ${JSON.stringify(liveWaitFailure).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]")}`, {cause: error});
  }
}

test.describe("AI Coding Agent Live Provider", () => {
  // Apply the live-provider budget before hooks and test bodies begin. A
  // single scenario can need a generation and an automatic repair request.
  test.describe.configure({timeout: LIVE_SCENARIO_TIMEOUT_MS});
  test.skip(!LIVE_ENABLED, "Set FDO_E2E_LIVE_AI=1 to run live-provider e2e.");

  test.beforeAll(async () => {
    electronApp = await launchElectronApp(electron, {isolatedUserDataDir: true, keepDisplayAwake: true, env: {
      OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
    }});
    electronApp.process?.()?.on?.("exit", (code, signal) => {
      recordLiveLifecycle("electron-process-exit", {code, signal});
    });
  }, LIVE_TIMEOUT_MS);

  test.beforeEach(async () => {
    liveLifecycleEvents = [];
    liveWaitFailure = null;
    liveRequestConfiguration = null;
    stopObservingPage = undefined;
    editorWindow = await openEditorWithMockedIPC(electronApp, { __useRealAssistants: true });
    recordLiveLifecycle("editor-window-ready");
    stopObservingPage = await observeLiveAiPage(electronApp, editorWindow, recordLiveLifecycle);
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
    await stopObservingPage?.();
    const observed = !editorWindow || editorWindow.isClosed()
      ? {readError: "Editor page unavailable; see lifecycle and waitFailure."}
      : await editorWindow.evaluate(() => ({
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      backendResponses: window.__liveAiResponses || [],
      files: Object.fromEntries(["/index.ts", "/render.tsx", "/render.test.ts"].map(file =>
        [file, window.__editorTestApi?.getFileContent(file) || ""])),
    })).catch(error => ({readError: String(error.message || error)}));
    const requestBudget = await electronApp?.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__ || null).catch(() => null);
    const codingLifecycle = await electronApp?.evaluate(() => globalThis.__FDO_E2E_CODING_LIFECYCLE__ || []).catch(() => []);
    const report = JSON.stringify({requestBudget, codingLifecycle, provider: LIVE_PROVIDER, model: LIVE_MODEL, status: testInfo.status,
      durationMs: testInfo.duration, lifecycle: liveLifecycleEvents, waitFailure: liveWaitFailure, requestConfiguration: liveRequestConfiguration,
      ...observed}, null, 2).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]");
    // Persist even with the list reporter, which does not retain body-only attachments.
    const reportPath = testInfo.outputPath("editor-live-result.json");
    await require("node:fs/promises").writeFile(reportPath, report, "utf8");
    await testInfo.attach("editor-live-result.json", {path: reportPath, contentType: "application/json"});
    const transportLog = process.env.FDO_E2E_LIVE_AI_TRANSPORT_LOG;
    if (transportLog && await fs.stat(transportLog).then(() => true).catch(() => false)) {
      await testInfo.attach("playwright-transport.log", {path: transportLog, contentType: "text/plain"});
    }
    if (/JSON Inspector/i.test(testInfo.title)) {
      await persistJsonInspectorArtifactStatus(testInfo);
    }
    if (/Rose Calculator/i.test(testInfo.title)) {
      await persistRoseCalculatorArtifactStatus(testInfo);
    }
    if (/Web Tools Workbench/i.test(testInfo.title)) {
      await persistWebToolsWorkbenchArtifactStatus(testInfo);
    }
    if (editorWindow && !editorWindow.isClosed()) await expectNoUnexpectedErrorToasts(editorWindow);
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
    const config = readLiveAiConfig();
    let selectedAssistant = findLiveCodingAssistant(resolvedAssistants, config, LIVE_ASSISTANT_NAME);
    let provisionedAssistant = false;

    if (!selectedAssistant) {
      const provisionResult = await editorWindow.evaluate(async ({ provider, apiKey, model, name, baseUrl, contextLength, accountId, firstResponseTimeoutMs, defaultThinkingMode }) => {
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
            baseUrl, contextLength, accountId, firstResponseTimeoutMs, defaultThinkingMode,
            default: true,
          });
          return {
            ok: true,
            assistants: (await window.electron.settings.ai.getAssistants()).map(({apiKey: _secret, ...item}) => item),
          };
        } catch (error) {
          return {
            ok: false,
            reason: String(error?.message || error).split(apiKey || "[unused-secret]").join("[REDACTED]"),
          };
        }
      }, {
        provider: LIVE_PROVIDER,
        apiKey: LIVE_API_KEY,
        model: LIVE_MODEL,
        name: LIVE_ASSISTANT_NAME,
        firstResponseTimeoutMs: process.env.FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS,
        defaultThinkingMode: readLiveAiConfig().defaultThinkingMode,
        accountId: process.env.FDO_TEST_AI_ACCOUNT_ID,
        baseUrl: process.env.FDO_TEST_AI_BASE_URL,
        contextLength: process.env.FDO_TEST_AI_CONTEXT_LENGTH,
      });

      expect(
        provisionResult?.ok,
        `Failed to provision live coding assistant for provider=${LIVE_PROVIDER} model=${LIVE_MODEL}: ${provisionResult?.reason || "unknown error"}`,
      ).toBeTruthy();

      resolvedAssistants = provisionResult.assistants || [];
      selectedAssistant = findLiveCodingAssistant(resolvedAssistants, config, LIVE_ASSISTANT_NAME);
      provisionedAssistant = true;
    }

    expect(
      selectedAssistant,
      "Live Editor tests require a dedicated assistant matching the requested provider, model, thinking mode and timeout.",
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
    await editorWindow.locator('#assistant-select').selectOption(selectedAssistant.id);
    await expect(editorWindow.locator('#assistant-select')).toHaveValue(selectedAssistant.id);
    liveRequestConfiguration = {provider: selectedAssistant.provider, model: selectedAssistant.model,
      thinkingMode: selectedAssistant.defaultThinkingMode, firstResponseTimeoutMs: selectedAssistant.firstResponseTimeoutMs,
      requestLimit: config.limit, requestBudgetMode: config.requestBudgetMode};
    console.log(`Live AI request configuration: ${JSON.stringify(liveRequestConfiguration)}`);
    return { promptInput, actionSelect, assistants: resolvedAssistants };
  };

  const expectSuccessfulResponse = async () => {
    const observed = await editorWindow.evaluate(() => ({
      error: document.querySelector('[data-testid="ai-coding-error"]')?.textContent || "",
      response: document.querySelector('[data-testid="ai-coding-response"]')?.textContent || "",
    }));
    const error = observed.error.split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]");
    expect(error, `Editor AI request failed: ${error}`).toBe("");
    expect(observed.response.trim(), "Editor completed without an AI response").not.toBe("");
  };

  const jsonInspectorScenarioDeps = () => ({
    test,
    expect,
    editorWindow,
    LIVE_SCENARIO_TIMEOUT_MS,
    LIVE_SCENARIO_SEED,
    LIVE_API_KEY,
    scenarioCatalogModule,
    templateModule,
    openAiCodingAssistant,
    waitForAssistantRequestToSettle,
    expectSuccessfulResponse,
    evaluateJsonInspectorScenario,
    ensureRootCertificate,
    waitForPluginRegistered,
    activatePlugin,
    waitForPluginReady,
    selectPluginOpen,
    waitForPluginUiRendered,
    waitForTargetPluginVisualState,
    capturePluginIframeScreenshot,
    persistLiveArtifact,
    removePlugin,
  });

  const roseCalculatorScenarioDeps = () => ({
    test,
    expect,
    editorWindow,
    LIVE_SCENARIO_TIMEOUT_MS,
    LIVE_ROSE_CALCULATOR_SEED,
    LIVE_API_KEY,
    scenarioCatalogModule,
    templateModule,
    openAiCodingAssistant,
    waitForAssistantRequestToSettle,
    expectSuccessfulResponse,
    evaluateRoseCalculatorScenario,
    ensureRootCertificate,
    waitForPluginRegistered,
    activatePlugin,
    waitForPluginReady,
    selectPluginOpen,
    waitForPluginUiRendered,
    waitForRoseCalculatorVisualState,
    capturePluginIframeScreenshot,
    persistLiveArtifact,
    removePlugin,
  });

  const webToolsWorkbenchScenarioDeps = () => ({
    test,
    expect,
    editorWindow,
    LIVE_SCENARIO_TIMEOUT_MS,
    LIVE_WEB_TOOLS_WORKBENCH_SEED,
    LIVE_API_KEY,
    WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE,
    scenarioCatalogModule,
    templateModule,
    openAiCodingAssistant,
    waitForAssistantRequestToSettle,
    expectSuccessfulResponse,
    evaluateWebToolsWorkbenchScenario,
    ensureRootCertificate,
    waitForPluginRegistered,
    activatePlugin,
    waitForPluginReady,
    selectPluginOpen,
    waitForPluginUiRendered,
    waitForWebToolsWorkbenchVisualState,
    capturePluginIframeScreenshot,
    persistLiveArtifact,
    removePlugin,
  });

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
    await expect(editorWindow.getByRole('button', {name: 'Reset workspace conversation', exact: true})).toBeInViewport({ratio: 1});
    const rubric = evaluatePluginCode(files);
    const reportPath = testInfo.outputPath('plugin-best-practices.json');
    await require('node:fs/promises').writeFile(reportPath, JSON.stringify({rubric, files}, null, 2).split(LIVE_API_KEY || "[unused-secret]").join('[REDACTED]'));
    await testInfo.attach('plugin-best-practices.json', {path: reportPath, contentType: 'application/json'});
    expect(files['/index.ts']).toContain('Sentinel Beacon');
    expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
    const compiled = await editorWindow.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
    expect(compiled.success, compiled.error || 'Generated plugin did not compile').toBe(true);
  }, LIVE_TIMEOUT_MS);

  test.describe("JSON Inspector live scenario", () => {
    test("live scenario: builds and verifies a seeded JSON Inspector without external access", async ({}, testInfo) => {
      await runJsonInspectorLiveScenario(jsonInspectorScenarioDeps(), testInfo);
    });
  });

  test.describe("Rose Calculator live scenario", () => {
    test("live scenario: builds, deploys, and screenshots a Rose Calculator with quick and sidebar actions", async ({}, testInfo) => {
      await runRoseCalculatorLiveScenario(roseCalculatorScenarioDeps(), testInfo);
    });
  });

  test.describe("Web Tools Workbench live scenario", () => {
    test("live scenario: builds, deploys, and screenshots a local webmaster-tools workbench", async ({}, testInfo) => {
      await runWebToolsWorkbenchLiveScenario(webToolsWorkbenchScenarioDeps(), testInfo);
    });
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
      const report = JSON.stringify({provider: LIVE_PROVIDER, model: LIVE_MODEL, result}, null, 2).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]");
      await testInfo.attach(`${scenario.id}.json`, {body: report, contentType: "application/json"});
      expect(result.success, result.error || "Provider failed").toBe(true);
      expect(result.content.trim().length).toBeGreaterThan(0);
      for (const term of scenario.terms) expect(result.content.toLowerCase()).toContain(term.toLowerCase());
      expect(result.content).not.toMatch(/(?:import|require).*?["']electron["']/);
    }, LIVE_TIMEOUT_MS);
  }

});
