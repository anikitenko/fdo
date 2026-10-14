const fs = require('node:fs/promises');
const {exerciseWorkbench} = require('../helpers/workbenchUserAcceptance.cjs');

async function runWebToolsWorkbenchUserScenario(deps, testInfo) {
  const {test, expect, editorWindow, LIVE_SCENARIO_TIMEOUT_MS, LIVE_WEB_TOOLS_WORKBENCH_SEED,
    WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE, scenarioCatalogModule, templateModule, openAiCodingAssistant,
    waitForAssistantRequestToSettle, expectSuccessfulResponse, LIVE_API_KEY, ensureRootCertificate,
    waitForPluginRegistered, activatePlugin, waitForPluginReady, selectPluginOpen, waitForPluginUiRendered,
    capturePluginIframeScreenshot, persistLiveArtifact, removePlugin} = deps;
  test.setTimeout(LIVE_SCENARIO_TIMEOUT_MS);
  const scenario = scenarioCatalogModule.exports.selectPluginAuthoringScenarioById('web-tools-workbench', LIVE_WEB_TOOLS_WORKBENCH_SEED);
  const report = {acceptanceMode: 'realistic-user', scenario, checks: [], visualReview: 'Screenshots require human comparison with the reference; automated checks cover layout only.'};
  let pluginName;
  let originalViewport;
  const network = [];
  try {
    // Provisioning can remount the editor. Seed only after it has finished.
    const {promptInput, actionSelect} = await openAiCodingAssistant();
    await editorWindow.evaluate(({main, render, tests}) => {
      window.__editorTestApi.createFile('/index.ts', main, 'typescript');
      window.__editorTestApi.createFile('/render.tsx', render, 'typescript');
      window.__editorTestApi.createFile('/render.test.ts', tests, 'typescript');
    }, {main: templateModule.exports.BLANK_TEMPLATE_MAIN('Workbench'), render: templateModule.exports.BLANK_TEMPLATE_RENDER('Workbench'), tests: templateModule.exports.BLANK_TEMPLATE_TEST()});
    const initialTests = await editorWindow.evaluate(() => window.__editorTestApi.getFileContent('/render.test.ts'));
    expect(initialTests, 'Starter tests were not initialized').toBe(templateModule.exports.BLANK_TEMPLATE_TEST());
    await editorWindow.getByLabel('Changes', {exact: true}).selectOption('apply');
    await actionSelect.selectOption('plan');
    await editorWindow.locator('input[type="file"][accept="image/*"]').setInputFiles(WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE);
    await testInfo.attach('workbench-reference.png', {path: WEB_TOOLS_WORKBENCH_REFERENCE_IMAGE, contentType: 'image/png'});
    await promptInput.fill(scenario.prompt);
    await promptInput.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await waitForAssistantRequestToSettle(LIVE_SCENARIO_TIMEOUT_MS);
    await expectSuccessfulResponse();
    const files = await editorWindow.evaluate(() => Object.fromEntries(window.__editorTestApi.getState().filesKeys
      .filter(path => !path.startsWith('/node_modules/') && !path.startsWith('/dist/'))
      .map(path => [path, window.__editorTestApi.getFileContent(path)])));
    const compiled = await editorWindow.evaluate(latestContent => window.electron.plugin.build({latestContent}), files);
    const tests = await editorWindow.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
    const problems = await editorWindow.evaluate(() => window.__editorTestApi.getState().filesKeys
      .filter(path => !path.startsWith('/node_modules/') && !path.startsWith('/dist/'))
      .flatMap(path => (window.__editorTestApi.getMarkersForPath?.(path) || []).filter(marker => marker.severity >= 8)
        .map(marker => ({path, message: marker.message}))), undefined);
    Object.assign(report, {files, compiled, tests, problems});
    expect(compiled.success, compiled.error || 'Build failed').toBe(true);
    expect(problems, JSON.stringify(problems)).toEqual([]);
    expect(Object.entries(files).some(([path, content]) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) && content !== initialTests), 'The agent left only the unchanged template tests').toBe(true);
    expect(tests.skipped, 'Requested tool tests were not executed').toBe(false);
    expect(tests.success, String(tests.output || tests.error || '').slice(-2500)).toBe(true);
    const output = Array.isArray(compiled.files) ? compiled.files : compiled.files?.outputFiles || compiled.outputFiles || [];
    const content = output.find(file => typeof file.text === 'string')?.text;
    expect(content, 'No deployable output').toBeTruthy();
    pluginName = `live-user-workbench-${Date.now()}`;
    await ensureRootCertificate(editorWindow);
    const deployed = await editorWindow.evaluate(({content, name}) => window.electron.plugin.deployToMainFromEditor({
      name, sandbox: `live_ai_${name}`, entrypoint: 'dist/index.cjs', content,
      metadata: {name: 'Live User Workbench', version: '1.0.0', author: 'Live evaluation', description: 'Disposable user acceptance check', icon: 'applications'}, rootCert: 'root',
    }), {content, name: pluginName});
    expect(deployed.success, deployed.error).toBe(true);
    await waitForPluginRegistered(editorWindow, pluginName);
    expect((await activatePlugin(editorWindow, pluginName)).success).toBe(true);
    await waitForPluginReady(editorWindow, pluginName);
    await editorWindow.evaluate(() => { window.location.hash = '#/'; });
    await selectPluginOpen(editorWindow, pluginName);
    await waitForPluginUiRendered(editorWindow, pluginName, 30000);
    const frame = editorWindow.frameLocator(`iframe[data-plugin-id="${pluginName}"]`);
    // Record requests by the actual plugin frame, including srcdoc/opaque URLs.
    const iframe = await editorWindow.locator(`iframe[data-plugin-id="${pluginName}"]`).elementHandle();
    const pluginFrame = await iframe.contentFrame();
    report.network = network;
    const observe = request => {
      try { if (request.frame() === pluginFrame && /^https?:/.test(request.url())) network.push(request.url()); } catch {}
    };
    editorWindow.on('request', observe);
    try {
      const capture = async name => {
        const path = testInfo.outputPath(`web-tools-workbench-${name}.png`);
        await capturePluginIframeScreenshot(editorWindow, pluginName, path);
        await testInfo.attach(`workbench-${name}`, {path, contentType: 'image/png'});
        await persistLiveArtifact(path, name === 'dashboard' ? 'web-tools-workbench-latest.png' : `web-tools-workbench-${name}-latest.png`);
        report.checks.push(name);
      };
      await exerciseWorkbench(frame, expect, capture);
      originalViewport = editorWindow.viewportSize() || await editorWindow.evaluate(() => ({width: innerWidth, height: innerHeight}));
      await editorWindow.setViewportSize({width: 480, height: 800});
      await expect.poll(() => frame.locator('body').evaluate(node => node.scrollWidth <= node.ownerDocument.documentElement.clientWidth + 2)).toBe(true);
      await capture('narrow');
      await editorWindow.setViewportSize(originalViewport);
      originalViewport = undefined;
      expect(network, 'Local tools made network requests during interaction').toEqual([]);
      report.passed = true;
    } finally { editorWindow.off('request', observe); }
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
    throw error;
  } finally {
    const path = testInfo.outputPath('web-tools-workbench-scenario.json');
    try {
      await fs.writeFile(path, JSON.stringify(report, null, 2).split(LIVE_API_KEY || '[unused-secret]').join('[REDACTED]'));
      await testInfo.attach('web-tools-workbench-scenario.json', {path, contentType: 'application/json'});
      await persistLiveArtifact(path, 'web-tools-workbench-scenario-latest.json');
      const interactions = testInfo.outputPath('web-tools-workbench-interactions.json');
      await fs.writeFile(interactions, JSON.stringify({acceptanceMode: report.acceptanceMode,
        passed: report.passed, completedScreens: report.checks}, null, 2));
      await persistLiveArtifact(interactions, 'web-tools-workbench-interactions-latest.json');
    } finally {
      if (originalViewport) await editorWindow.setViewportSize(originalViewport).catch(() => {});
      if (pluginName) await removePlugin(editorWindow, pluginName);
    }
  }
}
module.exports = {runWebToolsWorkbenchUserScenario};
