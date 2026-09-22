const fs = require("node:fs/promises");

async function runRoseCalculatorLiveScenario(deps, testInfo) {
  const {
    test, expect, editorWindow, LIVE_SCENARIO_TIMEOUT_MS, LIVE_ROSE_CALCULATOR_SEED,
    scenarioCatalogModule, templateModule, openAiCodingAssistant, waitForAssistantRequestToSettle,
    expectSuccessfulResponse, evaluateRoseCalculatorScenario, LIVE_API_KEY, ensureRootCertificate,
    waitForPluginRegistered, activatePlugin, waitForPluginReady, selectPluginOpen,
    waitForPluginUiRendered, waitForRoseCalculatorVisualState, capturePluginIframeScreenshot,
    persistLiveArtifact, removePlugin,
  } = deps;
    test.slow(true, "A live workspace generation may require validation or Problems-panel repair.");
    test.setTimeout(LIVE_SCENARIO_TIMEOUT_MS);
    console.log(`Live Rose Calculator timeout: ${testInfo.timeout}ms`);
    const scenario = scenarioCatalogModule.exports.selectPluginAuthoringScenarioById("rose-calculator", LIVE_ROSE_CALCULATOR_SEED);
    await editorWindow.evaluate(({main, render, tests}) => {
      window.__editorTestApi.createFile("/index.ts", main, "typescript");
      window.__editorTestApi.createFile("/render.tsx", render, "typescript");
      window.__editorTestApi.createFile("/render.test.ts", tests, "typescript");
    }, {
      main: templateModule.exports.BLANK_TEMPLATE_MAIN("Rose Calculator Fixture"),
      render: templateModule.exports.BLANK_TEMPLATE_RENDER("Rose Calculator Fixture"),
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
    await promptInput.fill(scenario.prompt);
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
        .filter((filePath) => !filePath.startsWith("/node_modules/") && !filePath.startsWith("/dist/"))
        .map((filePath) => [filePath, window.__editorTestApi.getFileContent(filePath)])
        .filter(([, content]) => typeof content === "string"),
    ));
    const rubric = evaluateRoseCalculatorScenario(files);
    const compiled = await editorWindow.evaluate((latestContent) => window.electron.plugin.build({latestContent}), files);
    const testRun = await editorWindow.evaluate((latestContent) => window.electron.plugin.runTests({latestContent}), files);
    const report = {
      seed: LIVE_ROSE_CALCULATOR_SEED,
      scenario: {id: scenario.id, title: scenario.title, designBrief: scenario.designBrief},
      defaultTest: {path: "/render.test.ts", content: seededTestFile, executedWith: "Editor Run Tests action", result: "passed"},
      problems,
      rubric,
      compiled,
      testRun,
      files,
    };
    const reportPath = testInfo.outputPath("rose-calculator-scenario.json");
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]"), "utf8");
    await testInfo.attach("rose-calculator-scenario.json", {path: reportPath, contentType: "application/json"});

    expect(rubric.passed, JSON.stringify(rubric, null, 2)).toBe(true);
    expect(compiled.success, compiled.error || "Generated Rose Calculator did not compile").toBe(true);
    expect(testRun.skipped, "The scenario must add node:test tests").toBe(false);
    expect(testRun.success, testRun.output || testRun.error || "Generated Rose Calculator tests failed").toBe(true);

    const compiledOutputFiles = Array.isArray(compiled.files)
      ? compiled.files
      : (compiled.files?.outputFiles || compiled.outputFiles || []);
    const compiledContent = compiledOutputFiles.find((file) => typeof file?.text === "string")?.text || "";
    expect(compiledContent, "The compiler did not return deployable plugin output").not.toBe("");
    const pluginName = `live-rose-calculator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await ensureRootCertificate(editorWindow);
      const deployed = await editorWindow.evaluate(async ({content, name}) => await window.electron.plugin.deployToMainFromEditor({
        name,
        sandbox: `live_ai_${name}`,
        entrypoint: "dist/index.cjs",
        content,
        metadata: {
          name: "Live Rose Calculator Visual Check",
          version: "1.0.0",
          author: "FDO Live Evaluation",
          description: "Disposable visual and interactive check for the generated calculator.",
          icon: "calculator",
        },
        rootCert: "root",
      }), {content: compiledContent, name: pluginName});
      expect(deployed.success, deployed.error || "Generated Rose Calculator deployment failed").toBe(true);
      await waitForPluginRegistered(editorWindow, pluginName);
      expect((await activatePlugin(editorWindow, pluginName)).success).toBe(true);
      await waitForPluginReady(editorWindow, pluginName);
      await editorWindow.evaluate(() => { window.location.hash = "#/"; });
      await editorWindow.waitForFunction(() => window.location.hash === "#/");
      await selectPluginOpen(editorWindow, pluginName);
      await waitForPluginUiRendered(editorWindow, pluginName, 30000);

      const uiState = await waitForRoseCalculatorVisualState(editorWindow, pluginName, 30000);
      const screenshotPath = testInfo.outputPath("rose-calculator-ui.png");
      const visualStatePath = testInfo.outputPath("rose-calculator-visual-state.json");
      await fs.writeFile(visualStatePath, JSON.stringify(uiState, null, 2), "utf8");
      await testInfo.attach("rose-calculator-visual-state.json", {path: visualStatePath, contentType: "application/json"});
      await capturePluginIframeScreenshot(editorWindow, pluginName, screenshotPath);
      await testInfo.attach("rose-calculator-ui.png", {path: screenshotPath, contentType: "image/png"});
      await persistLiveArtifact(screenshotPath, "rose-calculator-latest.png");
      await persistLiveArtifact(visualStatePath, "rose-calculator-latest.json");
      expect(uiState.iframePresent).toBe(true);
      expect(uiState.text).toMatch(/Rose Calculator/i);
      expect(uiState.styledElements).toBeGreaterThan(0);
      expect(uiState.roles).toEqual({shell: true, display: true, result: true, quickActions: true, sidebar: true, cat: true});
      expect(uiState.styleText).toMatch(/grid-template-columns/i);
      expect(uiState.styleText).toMatch(/prefers-reduced-motion/i);
      expect(uiState.visual.shellHasSurface).toBe(true);
      expect(uiState.visual.shellHasRoundedCorners).toBe(true);
      expect(uiState.visual.shellHasPadding).toBe(true);
      expect(uiState.visual.shellHasShadowOrBorder).toBe(true);
      expect(uiState.visual.displayIsUsable).toBe(true);
      expect(uiState.visual.sidebarPresentBesideMain).toBe(true);
      expect(uiState.visual.catIsFullBackgroundArtwork).toBe(true);

      const frame = editorWindow.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
      const display = frame.locator('[data-role="calculator-display"]');
      const result = frame.locator('[data-role="calculator-result"]');
      const sidebar = frame.locator('[data-role="calculator-sidebar"]');
      const interactions = [];
      const captureInteraction = async (id) => {
        const interactionScreenshotPath = testInfo.outputPath(`rose-calculator-${id}.png`);
        await capturePluginIframeScreenshot(editorWindow, pluginName, interactionScreenshotPath);
        await testInfo.attach(`rose-calculator-${id}.png`, {path: interactionScreenshotPath, contentType: "image/png"});
        await persistLiveArtifact(interactionScreenshotPath, `rose-calculator-${id}-latest.png`);
      };

      await display.fill("12");
      await frame.locator('[data-role="calculator-quick-double"]').click();
      await expect(display).toHaveValue(/24/);
      await captureInteraction("quick-double");
      interactions.push({id: "quick-double", display: await display.inputValue()});

      await display.fill("7+5");
      await frame.locator('[data-role="calculator-equals"]').click();
      await expect(result).toHaveAttribute("data-state", "success", {timeout: 10000});
      await expect(result).toContainText(/12/);
      await captureInteraction("equals");
      interactions.push({id: "equals", state: await result.getAttribute("data-state"), result: await result.innerText()});

      await frame.locator('[data-role="calculator-sidebar-theme"]').click();
      await expect(sidebar).toHaveAttribute("data-state", "open", {timeout: 10000});
      await frame.locator('[data-role="calculator-sidebar-history"]').click();
      await expect(sidebar).toHaveAttribute("data-state", "open", {timeout: 10000});
      await expect(sidebar).toContainText(/12/);
      await captureInteraction("sidebar");
      interactions.push({id: "sidebar", state: await sidebar.getAttribute("data-state"), content: await sidebar.innerText()});

      await frame.locator('[data-role="calculator-clear"]').click();
      await expect(display).toHaveValue("");
      await expect(result).toHaveAttribute("data-state", "empty", {timeout: 10000});
      interactions.push({id: "clear", display: await display.inputValue(), state: await result.getAttribute("data-state")});
      const interactionReportPath = testInfo.outputPath("rose-calculator-interactions.json");
      await fs.writeFile(interactionReportPath, JSON.stringify(interactions, null, 2), "utf8");
      await testInfo.attach("rose-calculator-interactions.json", {path: interactionReportPath, contentType: "application/json"});
      await persistLiveArtifact(interactionReportPath, "rose-calculator-interactions-latest.json");
    } finally {
      await removePlugin(editorWindow, pluginName);
    }
}

module.exports = {runRoseCalculatorLiveScenario};
