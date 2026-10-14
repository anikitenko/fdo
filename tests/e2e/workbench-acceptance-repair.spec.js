const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const recorded = require('../fixtures/ai/workbench-acceptance-repair.json');
const {evaluateWebToolsWorkbenchScenario} = require('./helpers/pluginScenarioRubric.cjs');
const {buildWorkbenchConvergencePrompt, workbenchPassed} = require('./helpers/workbenchConvergence.cjs');

test('saved Workbench renders mapped controls but exposes compiler and test failures together', async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => Boolean(window.electron?.plugin?.runTests))).toBe(true);
    const compiled = await page.evaluate(files => window.electron.plugin.build({latestContent: files}), recorded.files);
    expect(compiled.success).toBe(false);
    expect(compiled.error).toContain('Circular CSS import');
    const testRun = await page.evaluate(files => window.electron.plugin.runTests({latestContent: files}), recorded.files);
    expect(testRun.success).toBe(false);
    const state = {...recorded, compiled, testRun, rubric: evaluateWebToolsWorkbenchScenario(recorded.files)};
    expect(state.rubric.missingRoles).toEqual([]);
    expect(workbenchPassed(state)).toBe(false);
    const prompt = buildWorkbenchConvergencePrompt(state);
    expect(prompt).toContain('BUILD FAILURE:');
    expect(prompt).toContain('TEST FAILURES:');
    expect(prompt).toContain('styleMapRendered');

    // Execute the saved template with its actual imported metadata. This is
    // independent runtime evidence for the static rubric's map recognition.
    const focused = Object.fromEntries([
      '/shared/types.ts', '/features/dashboard/render.tsx',
      '/features/library/render.tsx', '/features/personal-space/render.tsx',
    ].map(path => [path, recorded.files[path]]));
    focused['/render.test.ts'] = `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderDashboard} from './features/dashboard/render';
import {renderLibrary} from './features/library/render';
import {renderPersonalSpace} from './features/personal-space/render';
import {INITIAL_VIEW_STATE} from './shared/types';
test('metadata renders five real category controls', () => {
  const html = renderDashboard({state: INITIAL_VIEW_STATE});
  for (const key of ['text', 'data', 'seo', 'images', 'social']) {
    assert.ok(html.includes('data-role="tool-card-' + key + '"'));
  }
});
test('overlay state expressions render closed and open states', () => {
  for (const render of [renderLibrary, renderPersonalSpace]) {
    assert.ok(render({open: false}).includes('data-state="closed"'));
    assert.ok(render({open: true}).includes('data-state="open"'));
  }
});`;
    const proof = await page.evaluate(files => window.electron.plugin.runTests({latestContent: files}), focused);
    expect(proof.success, proof.output || proof.error).toBe(true);
    expect(proof.skipped).not.toBe(true);
  } finally { await closeElectronApp(app); }
});
