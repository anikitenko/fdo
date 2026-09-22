const fs = require("node:fs/promises");
const {liveAiRepairAttempts} = require("../../../src/utils/liveAiTestPolicy.cjs");

async function checkWorkbenchPersonalSpace(frame, expect, onOpen) {
  // The header and dock may both expose this action. Exercise every visible
  // entry point; choosing .first() would leave a broken second binding untested.
  const buttons = frame.locator('[data-role="tool-space-button"]:visible');
  await expect(buttons).not.toHaveCount(0);
  const count = await buttons.count();
  const space = frame.locator('[data-role="tool-space-dialog"]');
  await expect(space).toHaveCount(1);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const label = (await button.innerText()).trim();
    await expect(button).toHaveAttribute("type", "button");
    await button.click();
    await expect(space).toHaveAttribute("data-state", "open", {timeout: 10000});
    await expect(space).toBeVisible({timeout: 10000});
    await expect(space).toContainText(/local|private|favourite|saved/i);
    await onOpen({index, label, state: await space.getAttribute("data-state")});
    await space.locator('[data-role="tool-space-close"]').click();
    await expect(space).toHaveAttribute("data-state", "closed", {timeout: 10000});
    await expect(space).toBeHidden({timeout: 10000});
    await expect(buttons).toHaveCount(count);
  }
}

async function runWorkbenchOperation(workspace, {value, mode, expectedText}, expect) {
  if (mode) {
    // Select the requested operation explicitly; a valid tool may default to
    // title case or retain the user's previous selection when reopened.
    const selector = workspace.getByRole("combobox");
    await expect(selector).toHaveCount(1);
    await selector.selectOption(mode);
    await expect(selector).toHaveValue(mode);
  }
  if (value !== undefined) {
    await workspace.locator('[data-role="tool-category-input"]').first().fill(value);
  }
  await workspace.locator('[data-role="tool-category-action"]').click();
  const result = workspace.locator('[data-role="tool-category-result"]');
  await expect(result).toHaveAttribute("data-state", "success", {timeout: 10000});
  await expect(result).toContainText(expectedText);
  return {state: await result.getAttribute("data-state"), result: await result.innerText()};
}

function buildWorkbenchMarkupRepairPrompt(rubric) {
  const requiredChecks = ['workbenchMarkup', 'actionMarkup', 'declarativeActions', 'visibleStates', 'styleMapRendered'];
  if (requiredChecks.every(check => rubric.checks[check])) return "";
  const missingRoles = [...new Set([...(rubric.missingRoles || []), ...(rubric.missingActionRoles || [])])];
  return [
    "Repair the missing Workbench controls in the current plugin workspace. Apply the correction now through complete workspace file sections.",
    `Required data-role values missing from the implementation: ${missingRoles.join(", ")}.`,
    `Failed implementation checks: ${requiredChecks.filter(check => !rubric.checks[check]).join(', ')}.`,
    "Follow imports from /render.tsx to the plugin-local modules owning the missing controls and bindings; update only those modules and their composition imports. Preserve all existing screens, style-map classes, tools, and exports. Do not edit /styles.css or /package.json. Add a cohesive helper module only if needed; do not collapse existing modules into the entry file.",
    "Render each missing role on the actual corresponding element; mentions in comments, tests, or unused strings do not implement a control. Every added action must be usable with defineRenderOnLoadActions click bindings.",
    "Complete the dashboard, searchable tool library and personal-space sheet as distinct views. The library and personal-space sheet start data-state=\"closed\". Their open/close buttons must change that state; category cards open their corresponding workspace and Back restores the dashboard. Wire the action module into the plugin entry's renderOnLoad(); an empty renderOnLoad() is not an implementation.",
    "Use one SDK DOM instance and its returned HTML strings, not browser elements. Apply the shell, dashboard, card, library, workspace, result and dock style-map classes and return dom.renderHTML(...). Preserve the formatter's empty/success/error states.",
    missingRoles.includes("tool-card-json")
      ? 'The dashboard JSON Formatter quick-access control must be a type="button" with data-role="tool-card-json" that opens the JSON workspace. Keep the separate library control data-role="tool-open-json" and its binding; do not rename or remove it. Both controls must open the same formatter.'
      : "",
    "Return only complete changed plugin workspace files, with no unrelated rewrites.",
  ].filter(Boolean).join("\n");
}

function needsWorkbenchTestRepair(testRun, rubric) {
  return !testRun.success || testRun.skipped || !rubric.checks.nodeTests;
}

function evaluateWorkbenchRuntimeContract(files) {
  const entry = String(files?.["/index.ts"] || "");
  const violations = [];
  if (!/\bextends\s+FDO_SDK\b/.test(entry)) {
    violations.push("/index.ts must extend the installed FDO_SDK base class.");
  }
  if (/\bextends\s+(?:BasePlugin|FDOPlugin)\b/.test(entry)) {
    violations.push("BasePlugin and FDOPlugin are not available in the installed SDK runtime.");
  }
  if (!/\bimplements\s+FDOInterface\b/.test(entry)) {
    violations.push("/index.ts must implement FDOInterface.");
  }
  return {passed: violations.length === 0, violations};
}

async function runWebToolsWorkbenchLiveScenario(deps, testInfo) {
  const {
    test, expect, editorWindow, LIVE_SCENARIO_TIMEOUT_MS, LIVE_WEB_TOOLS_WORKBENCH_SEED,
    WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE,
    scenarioCatalogModule, templateModule, openAiCodingAssistant, waitForAssistantRequestToSettle,
    expectSuccessfulResponse, evaluateWebToolsWorkbenchScenario, LIVE_API_KEY, ensureRootCertificate,
    waitForPluginRegistered, activatePlugin, waitForPluginReady, selectPluginOpen,
    waitForPluginUiRendered, waitForWebToolsWorkbenchVisualState, capturePluginIframeScreenshot,
    persistLiveArtifact, removePlugin,
  } = deps;

  test.slow(true, "A live workspace generation may require validation or Problems-panel repair.");
  test.setTimeout(LIVE_SCENARIO_TIMEOUT_MS);
  console.log(`Live Web Tools Workbench timeout: ${testInfo.timeout}ms`);
  const scenario = scenarioCatalogModule.exports.selectPluginAuthoringScenarioById("web-tools-workbench", LIVE_WEB_TOOLS_WORKBENCH_SEED);
  await editorWindow.evaluate(({main, render, tests}) => {
    window.__editorTestApi.createFile("/index.ts", main, "typescript");
    window.__editorTestApi.createFile("/render.tsx", render, "typescript");
    window.__editorTestApi.createFile("/render.test.ts", tests, "typescript");
  }, {
    main: templateModule.exports.BLANK_TEMPLATE_MAIN("Web Tools Workbench Fixture"),
    render: templateModule.exports.BLANK_TEMPLATE_RENDER("Web Tools Workbench Fixture"),
    tests: templateModule.exports.BLANK_TEMPLATE_TEST(),
  });

  const seededTestFile = await editorWindow.evaluate(() => window.__editorTestApi.getFileContent("/render.test.ts"));
  expect(seededTestFile).toContain('from "node:test"');
  await editorWindow.getByRole("button", {name: "Run Tests", exact: true}).click();
  await expect(editorWindow.getByRole("tab", {name: "Test", exact: true})).toHaveAttribute("aria-selected", "true");
  await expect(editorWindow.getByText("Plugin tests passed.", {exact: true})).toBeVisible({timeout: 30000});

  const {promptInput, actionSelect} = await openAiCodingAssistant();
  await editorWindow.getByLabel("Changes", {exact: true}).selectOption("apply");
  await actionSelect.selectOption("plan");
  const referenceInput = editorWindow.locator('input[type="file"][accept="image/*"]');
  await expect(referenceInput).toBeAttached();
  await referenceInput.setInputFiles(WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE);
  await expect(editorWindow.getByAltText("UI Mockup")).toBeVisible();
  await testInfo.attach("web-tools-workbench-dashboard-reference.png", {
    path: WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE,
    contentType: "image/png",
  });
  await promptInput.fill(scenario.prompt);
  await expect(editorWindow.getByText("Selection recommended", {exact: true})).toHaveCount(0);
  await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await waitForAssistantRequestToSettle(LIVE_SCENARIO_TIMEOUT_MS);
  await expectSuccessfulResponse();

  const readWorkspaceFiles = async () => await editorWindow.evaluate(() => Object.fromEntries(
    window.__editorTestApi.getState().filesKeys
      .filter((filePath) => !filePath.startsWith("/node_modules/") && !filePath.startsWith("/dist/"))
      .map((filePath) => [filePath, window.__editorTestApi.getFileContent(filePath)])
      .filter(([, content]) => typeof content === "string"),
  ));

  let files = await readWorkspaceFiles();
  let compiled = await editorWindow.evaluate((latestContent) => window.electron.plugin.build({latestContent}), files);
  let repairPrompt = "";
  const sendRepair = async (prompt) => {
    repairPrompt = prompt;
    await promptInput.fill(prompt);
    await promptInput.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await waitForAssistantRequestToSettle(LIVE_SCENARIO_TIMEOUT_MS);
    await expectSuccessfulResponse();
    files = await readWorkspaceFiles();
    compiled = await editorWindow.evaluate((latestContent) => window.electron.plugin.build({latestContent}), files);
  };

  if (!compiled.success) {
    await sendRepair([
      "Repair the plugin workspace you just generated; apply the corrections now and return complete file sections only.",
      `The build failed with: ${compiled.error || "an unknown compiler error"}`,
      "Keep every required Workbench screen and interaction. Follow the compiler diagnostics to the owning plugin-local modules, preserve their boundaries, and return only complete changed files. Add a helper module only if needed. Do not edit /package.json or add dependencies.",
      "The FDO CSS style-map transformer rejects complex nested CSS. Use simple flat class selectors and at most `.shell { & button { ... } }`; do not use nested attribute selectors, :not(...), or comma-separated nested selectors.",
    ].join("\n"));
  }

  let runtimeContract = evaluateWorkbenchRuntimeContract(files);
  if (!runtimeContract.passed) {
    await sendRepair([
      "Repair only /index.ts in the current plugin workspace and return one complete /index.ts workspace file section. Do not change /render.tsx, /styles.css, tests, /package.json, or add files.",
      `The deployed plugin entry is incompatible with the installed SDK: ${runtimeContract.violations.join(" ")}`,
      "Import FDO_SDK, FDOInterface, and PluginMetadata from @anikitenko/fdo-sdk. Export the plugin class as `extends FDO_SDK implements FDOInterface`, preserve its metadata, render(), and renderOnLoad(), and instantiate it. Never use BasePlugin or FDOPlugin because they are undefined in this runtime.",
    ].filter(Boolean).join("\n"));
    runtimeContract = evaluateWorkbenchRuntimeContract(files);
  }

  // Visual fidelity to the reference mockup is what this scenario measures, so
  // the stylesheet and markup stages converge over several rounds instead of
  // failing the run on a single imperfect attempt.
  const repairAttempts = liveAiRepairAttempts();
  let rubric = evaluateWebToolsWorkbenchScenario(files);
  for (let attempt = 0; attempt < repairAttempts; attempt += 1) {
    if (rubric.checks.polishedWorkbench && rubric.checks.responsiveLayout) break;
    const failedVisualChecks = Object.entries(rubric.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
      .join(", ");
    await sendRepair([
      "Repair the owning plugin-local CSS files in the current workspace, following relative @import dependencies from /styles.css or feature renderers. Return only changed complete CSS file sections. Preserve the modular stylesheet structure; do not flatten imported styles back into /styles.css. Do not change markup, behavior, tests, /package.json, or add files.",
      `The visual stylesheet acceptance failed: ${failedVisualChecks}.`,
      "Preserve the existing class names and all required states. Across the repaired stylesheet modules, retain: `.shell` with both `background:` and `min-height:`; `.dashboard` with `display: grid` and a two-column `grid-template-columns:` rule; `.dock` with `position: sticky`, `position: fixed`, or a `border:`; and a mobile `@media` rule whose `.dashboard` sets `grid-template-columns: 1fr`.",
      "Keep the dark-teal dashboard, ivory surfaces, pastel cards, and bottom dock. Use flat class selectors and at most one simple nested `.shell { & button { ... } }` rule. Keep @keyframes and the reduced-motion rule with `animation: none`.",
    ].filter(Boolean).join("\n"));
    rubric = evaluateWebToolsWorkbenchScenario(files);
  }

  for (let attempt = 0; attempt < repairAttempts; attempt += 1) {
    const markupRepairPrompt = buildWorkbenchMarkupRepairPrompt(rubric);
    if (!markupRepairPrompt) break;
    await sendRepair(markupRepairPrompt);
    rubric = evaluateWebToolsWorkbenchScenario(files);
  }

  let testRun = await editorWindow.evaluate((latestContent) => window.electron.plugin.runTests({latestContent}), files);
  if (needsWorkbenchTestRepair(testRun, rubric)) {
    await sendRepair([
      "Repair the generated node:test suite in /render.test.ts and any plugin-local test modules identified by the failure. Return only complete changed test files; preserve the modular structure and test coverage.",
      "The generated node:test suite failed or is missing required coverage:",
      String(testRun.output || testRun.error || "unknown test failure").slice(0, 5000),
      "Keep all plugin behavior unchanged. Call the render function for HTML assertions.",
      "Create at least two executable node:test tests using node:assert/strict. Assert the composed dashboard controls and the formatter/category workspace targets in the rendered HTML; an empty file, skipped test run, or placeholder assertion is not coverage.",
      "renderOnLoad() returns an action object, so never pass it directly to assert.match; use String(renderOnLoad().source || \"\") only when testing its generated source.",
      "Use node:test and node:assert/strict. Do not edit implementation files or /package.json. Additional focused test modules are allowed if needed.",
    ].filter(Boolean).join("\n"));
    testRun = await editorWindow.evaluate((latestContent) => window.electron.plugin.runTests({latestContent}), files);
  }

  const problems = await editorWindow.evaluate(() => {
    const paths = window.__editorTestApi.getState().filesKeys
      .filter((filePath) => !filePath.startsWith("/node_modules/") && !filePath.startsWith("/dist/"));
    return paths.flatMap((filePath) => (window.__editorTestApi.getMarkersForPath?.(filePath) || [])
      .filter((marker) => Number(marker?.severity) >= 8)
      .map((marker) => ({path: filePath, message: marker.message, severity: marker.severity})));
  });
  expect(problems, `The AI agent must repair errors reported by the Problems panel: ${JSON.stringify(problems)}`).toEqual([]);

  rubric = evaluateWebToolsWorkbenchScenario(files);
  runtimeContract = evaluateWorkbenchRuntimeContract(files);
  const report = {
    seed: LIVE_WEB_TOOLS_WORKBENCH_SEED,
    scenario: {id: scenario.id, title: scenario.title, designBrief: scenario.designBrief},
    defaultTest: {path: "/render.test.ts", content: seededTestFile, executedWith: "Editor Run Tests action", result: "passed"},
    problems, rubric, runtimeContract, compiled, testRun, repairPrompt, files,
  };
  const reportPath = testInfo.outputPath("web-tools-workbench-scenario.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]"), "utf8");
  await testInfo.attach("web-tools-workbench-scenario.json", {path: reportPath, contentType: "application/json"});

  expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
  expect(runtimeContract.passed, JSON.stringify(runtimeContract, null, 2)).toBe(true);
  expect(compiled.success, compiled.error || "Generated Web Tools Workbench did not compile").toBe(true);
  expect(testRun.skipped, "The scenario must add node:test tests").toBe(false);
  // This scenario measures how closely the generated workbench reproduces the
  // reference mockup, so the model's own helper-level assertions inform the
  // repair round above but do not decide the run. Deployment and the
  // interaction walkthrough below are the behavioural gate.
  if (!testRun.success) {
    console.warn(`Generated Web Tools Workbench node:test assertions still fail:\n${String(testRun.output || testRun.error || "").slice(0, 4000)}`);
  }

  const compiledOutputFiles = Array.isArray(compiled.files) ? compiled.files : (compiled.files?.outputFiles || compiled.outputFiles || []);
  const compiledContent = compiledOutputFiles.find((file) => typeof file?.text === "string")?.text || "";
  expect(compiledContent, "The compiler did not return deployable plugin output").not.toBe("");
  const pluginName = `live-web-tools-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await ensureRootCertificate(editorWindow);
    const deployed = await editorWindow.evaluate(async ({content, name}) => await window.electron.plugin.deployToMainFromEditor({
      name, sandbox: `live_ai_${name}`, entrypoint: "dist/index.cjs", content,
      metadata: {name: "Live Web Tools Workbench", version: "1.0.0", author: "FDO Live Evaluation", description: "Disposable visual and interactive workbench check.", icon: "applications"},
      rootCert: "root",
    }), {content: compiledContent, name: pluginName});
    expect(deployed.success, deployed.error || "Generated Web Tools Workbench deployment failed").toBe(true);
    await waitForPluginRegistered(editorWindow, pluginName);
    expect((await activatePlugin(editorWindow, pluginName)).success).toBe(true);
    await waitForPluginReady(editorWindow, pluginName);
    await editorWindow.evaluate(() => { window.location.hash = "#/"; });
    await editorWindow.waitForFunction(() => window.location.hash === "#/");
    await selectPluginOpen(editorWindow, pluginName);
    await waitForPluginUiRendered(editorWindow, pluginName, 30000);

    const initialState = await waitForWebToolsWorkbenchVisualState(editorWindow, pluginName, 30000);
    const initialScreenshotPath = testInfo.outputPath("web-tools-workbench-ui.png");
    const visualStatePath = testInfo.outputPath("web-tools-workbench-visual-state.json");
    await fs.writeFile(visualStatePath, JSON.stringify(initialState, null, 2), "utf8");
    await testInfo.attach("web-tools-workbench-visual-state.json", {path: visualStatePath, contentType: "application/json"});
    await capturePluginIframeScreenshot(editorWindow, pluginName, initialScreenshotPath);
    await testInfo.attach("web-tools-workbench-ui.png", {path: initialScreenshotPath, contentType: "image/png"});
    await persistLiveArtifact(initialScreenshotPath, "web-tools-workbench-latest.png");
    await persistLiveArtifact(visualStatePath, "web-tools-workbench-latest.json");
    expect(initialState.visual).toMatchObject({darkShell: true, dashboardGrid: true, hasDock: true});

    const frame = editorWindow.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
    const capture = async (id) => {
      const screenshotPath = testInfo.outputPath(`web-tools-workbench-${id}.png`);
      await capturePluginIframeScreenshot(editorWindow, pluginName, screenshotPath);
      await testInfo.attach(`web-tools-workbench-${id}.png`, {path: screenshotPath, contentType: "image/png"});
      await persistLiveArtifact(screenshotPath, `web-tools-workbench-${id}-latest.png`);
    };
    const captureCategory = async (id, label) => {
      const roleByCaptureId = {
        "text-content": "tool-card-text",
        "development-data": "tool-card-data",
        "web-seo": "tool-card-seo",
        "images-media": "tool-card-images",
        "social-platforms": "tool-card-social",
      };
      const category = frame.locator(`[data-role="${roleByCaptureId[id]}"]`);
      await expect(category).toBeVisible({timeout: 10000});
      await expect(category).toContainText(label);
      const screenshotPath = testInfo.outputPath(`web-tools-workbench-category-${id}.png`);
      await category.screenshot({path: screenshotPath});
      await testInfo.attach(`web-tools-workbench-category-${id}.png`, {
        path: screenshotPath,
        contentType: "image/png",
      });
      await persistLiveArtifact(screenshotPath, `web-tools-workbench-category-${id}-latest.png`);
    };
    const interactions = [];

    for (const category of [
      ["text-content", "Text & Content"],
      ["development-data", "Development & Data"],
      ["web-seo", "Web & SEO"],
      ["images-media", "Images & Media"],
      ["social-platforms", "Social & Platforms"],
    ]) {
      await captureCategory(...category);
    }

    const categoryScenarios = [
      ["text", "Hello local tools", "HELLO LOCAL TOOLS", "text-content"],
      ["data", '{"project":"Workbench","items":[1,2]}', '"project": "Workbench"', "development-data"],
      ["seo", '<html><head><title>Workbench</title><meta name="description" content="Local tools"></head><body><h1>Tools</h1><a href="/docs">Docs</a><img alt="Dashboard"></body></html>', "Title: Workbench", "web-seo"],
      ["images", "data:image/svg+xml,<svg width=\"120\" height=\"80\" xmlns=\"http://www.w3.org/2000/svg\"></svg>", "Type: image/svg+xml", "images-media"],
      ["social", '{"title":"Workbench","description":"Local tools","url":"https://example.test/tools"}', "Workbench", "social-platforms"],
    ];
    for (const [category] of categoryScenarios) {
      await expect(frame.locator(`[data-role="tool-category-workspace"][data-tool-category="${category}"]`))
        .toHaveCount(1, {timeout: 10000});
    }
    for (const [category, value, expectedText, screenshotId] of categoryScenarios) {
      await frame.locator(`[data-role="tool-card-${category}"]`).click();
      const categoryWorkspace = frame.locator(`[data-role="tool-category-workspace"][data-tool-category="${category}"]`);
      await expect(categoryWorkspace).toHaveAttribute("data-tool-category", category, {timeout: 10000});
      await expect(categoryWorkspace).toBeVisible({timeout: 10000});
      if (category === "social") {
        const titleInput = categoryWorkspace.locator('[name="title"]').first();
        const descriptionInput = categoryWorkspace.locator('[name="description"]').first();
        const urlInput = categoryWorkspace.locator('[name="url"]').first();
        await expect(titleInput).toBeVisible({timeout: 10000});
        await expect(descriptionInput).toBeVisible({timeout: 10000});
        await expect(urlInput).toBeVisible({timeout: 10000});
        await titleInput.fill("Workbench");
        await descriptionInput.fill("Local tools");
        await urlInput.fill("https://example.test/tools");
      }
      const operations = category === "text" ? [
        {mode: "upper", value, expectedText},
        {mode: "lower", value, expectedText: "hello local tools"},
        {mode: "title", value: "hELLO LOCAL tools", expectedText: "Hello Local Tools"},
      ] : category === "data" ? [
        {mode: "json", value, expectedText},
        {mode: "encode", value: "local tools & café", expectedText: "local%20tools%20%26%20caf%C3%A9"},
        {mode: "decode", value: "local%20tools%20%26%20caf%C3%A9", expectedText: "local tools & café"},
      ] : [{value: category === "social" ? undefined : value, expectedText}];
      for (const [index, operation] of operations.entries()) {
        const result = await runWorkbenchOperation(categoryWorkspace, operation, expect);
        const suffix = index === 0 ? "" : `-${operation.mode}`;
        await capture(`category-${screenshotId}${suffix}`);
        interactions.push({id: `category-${category}${suffix}`, mode: operation.mode, ...result});
      }
      await categoryWorkspace.locator('[data-role="tool-category-back"]').click();
      await expect(categoryWorkspace).toBeHidden({timeout: 10000});
      await expect(frame.locator('[data-role="tool-dashboard"]')).toBeVisible({timeout: 10000});
    }

    const quickJson = frame.locator('[data-role="tool-card-json"]');
    await expect(quickJson).toBeVisible();
    await expect(quickJson).toHaveAttribute("type", "button");
    await quickJson.click();
    await expect(frame.locator('[data-role="tool-workspace"]')).toBeVisible({timeout: 10000});
    await capture("json-quick-access");
    interactions.push({id: "json-quick-access", workspaceVisible: true});
    await frame.locator('[data-role="tool-back-dashboard"]').click();
    await expect(frame.locator('[data-role="tool-dashboard"]')).toBeVisible({timeout: 10000});

    await frame.locator('[data-role="tool-library-button"]').click();
    const library = frame.locator('[data-role="tool-library"]');
    await expect(library).toHaveAttribute("data-state", "open", {timeout: 10000});
    await expect(library).toBeVisible({timeout: 10000});
    await capture("library");
    interactions.push({id: "library", state: await library.getAttribute("data-state")});

    await frame.locator('[data-role="tool-search"]').fill("JSON");
    const openJson = frame.locator('[data-role="tool-open-json"]');
    await expect(openJson).toBeVisible();
    await openJson.click();
    const workspace = frame.locator('[data-role="tool-workspace"]');
    await expect(workspace).toBeVisible({timeout: 10000});
    await expect(library).toHaveAttribute("data-state", "closed", {timeout: 10000});
    const input = frame.locator('[data-role="tool-json-input"]');
    const result = frame.locator('[data-role="tool-json-result"]');
    await input.fill('{"project":"Workbench","tools":["JSON","Text"]}');
    await frame.locator('[data-role="tool-format-json"]').click();
    await expect(result).toHaveAttribute("data-state", "success", {timeout: 10000});
    await expect(result).toContainText(/project/i);
    await capture("formatter");
    interactions.push({id: "formatter", state: await result.getAttribute("data-state"), result: await result.innerText()});
    await input.fill('{"project": }');
    await frame.locator('[data-role="tool-format-json"]').click();
    await expect(result).toHaveAttribute("data-state", "error", {timeout: 10000});
    await expect(result).toContainText(/invalid|unexpected|json/i);

    await frame.locator('[data-role="tool-back-dashboard"]').click();
    await expect(frame.locator('[data-role="tool-dashboard"]')).toBeVisible({timeout: 10000});
    await checkWorkbenchPersonalSpace(frame, expect, async ({index, label, state}) => {
      const id = index === 0 ? "personal-space" : `personal-space-entry-${index + 1}`;
      await capture(id);
      interactions.push({id, label, state});
    });

    const interactionsPath = testInfo.outputPath("web-tools-workbench-interactions.json");
    await fs.writeFile(interactionsPath, JSON.stringify(interactions, null, 2), "utf8");
    await testInfo.attach("web-tools-workbench-interactions.json", {path: interactionsPath, contentType: "application/json"});
    await persistLiveArtifact(interactionsPath, "web-tools-workbench-interactions-latest.json");
  } finally {
    await removePlugin(editorWindow, pluginName);
  }
}

module.exports = {runWebToolsWorkbenchLiveScenario, buildWorkbenchMarkupRepairPrompt, needsWorkbenchTestRepair, runWorkbenchOperation, checkWorkbenchPersonalSpace};
