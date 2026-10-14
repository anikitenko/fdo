const fs = require('node:fs');
const path = require('node:path');
const {summarizeTestFailures} = require('../e2e/helpers/testFailureSummary.cjs');
const {buildWorkbenchConvergencePrompt} = require('../e2e/helpers/workbenchConvergence.cjs');
const output = fs.readFileSync(path.join(__dirname, '../fixtures/ai/workbench-test-failures.txt'), 'utf8');

test('retains diagnostics for all eight recorded failures within the prompt budget', () => {
  const summary = summarizeTestFailures(output);
  expect(summary.length).toBeLessThanOrEqual(12000);
  expect(summary.match(/^test at /gm)).toHaveLength(8);
  for (const name of ['transformText upper/lower/title succeed', 'transformText rejects empty input',
    'formatJson produces two-space indented output', 'inspectMedia reports data-url kind and size',
    'socialPreview rejects a missing url', 'dashboard shows the workbench title and brand',
    'category workspaces are present with stable category keys', 'every category workspace exposes required roles']) {
    expect(summary).toContain(name);
  }
  expect(summary).toContain("expected: 'HELLO WORLD'");
  expect(summary).toContain("'success' !== 'error'");
  expect(summary).toContain('Dimensions: not available');
  expect(summary).toContain('data-role="tool-category-input"');
  expect(summary).toContain('expected: /Web Tools Workbench/');
  const prompt = buildWorkbenchConvergencePrompt({compiled: {success: true}, runtimeContract: {passed: true},
    rubric: {passed: true, checks: {nodeTests: true}}, testRun: {success: false, output}});
  expect(prompt).toContain(summary);
});

test('keeps useful ends of unstructured crashes and strips terminal coloring', () => {
  const summary = summarizeTestFailures('\x1b[31mTypeError: broken\x1b[39m\n' + 'x'.repeat(20000) + '\nprocess exited 1');
  expect(summary).toContain('TypeError: broken');
  expect(summary).toContain('process exited 1');
  expect(summary).not.toContain('\x1b');
  expect(summary.length).toBeLessThanOrEqual(12000);
});

test('maps compiled test filenames to unique source paths without treating generated line numbers as source lines', () => {
  const summary = summarizeTestFailures(output, 12000, {
    '/features/categories/categories.test.ts': 'export {};', '/render.test.ts': 'export {};',
  });
  expect(summary).toContain('test in /features/categories/categories.test.ts (compiled location: features/categories/categories.test.js:856:27)');
  expect(summary).toContain('test in /render.test.ts');
  expect(summary.length).toBeLessThanOrEqual(12000);
});
