const fs = require("node:fs/promises");

async function runJsonInspectorLiveScenario(deps, testInfo) {
  const {
    test, expect, editorWindow, LIVE_SCENARIO_TIMEOUT_MS, LIVE_SCENARIO_SEED,
    scenarioCatalogModule, templateModule, openAiCodingAssistant, waitForAssistantRequestToSettle,
    expectSuccessfulResponse, evaluateJsonInspectorScenario, LIVE_API_KEY, ensureRootCertificate,
    waitForPluginRegistered, activatePlugin, waitForPluginReady, selectPluginOpen,
    waitForPluginUiRendered, waitForTargetPluginVisualState, capturePluginIframeScreenshot,
    persistLiveArtifact, removePlugin,
  } = deps;
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
    await expect(editorWindow.getByRole("tab", {name: "Test", exact: true})).toHaveAttribute("aria-selected", "true");
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
      JSON.stringify(report, null, 2).split(LIVE_API_KEY || "[unused-secret]").join("[REDACTED]"),
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
}

module.exports = {runJsonInspectorLiveScenario};
