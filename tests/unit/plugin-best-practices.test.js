const {evaluatePluginCode} = require('../e2e/helpers/pluginBestPractices.cjs');
const {BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER} = require('../../src/components/editor/utils/virtualTemplates');
const fixture = () => ({
  '/index.ts': BLANK_TEMPLATE_MAIN('Sentinel Beacon').replaceAll('refreshStatus', 'inspectStatus'),
  '/render.tsx': BLANK_TEMPLATE_RENDER('Sentinel Beacon'),
  '/render.test.ts': `import test from 'node:test';
import assert from 'node:assert/strict';
import {Render} from './render';
test('heading', () => { assert.ok(Render({version:'1',author:'A',description:'D'}).includes('My Plugin')); });
test('target', () => { assert.ok(Render({version:'1',author:'A',description:'D'}).includes('refresh-status')); });`,
});
test('accepts the documented blank SDK structure with tests', () => {
  expect(evaluatePluginCode(fixture())).toMatchObject({passed: true, violations: []});
});
test('does not accept SDK vocabulary in comments instead of implementations', () => {
  const result = evaluatePluginCode({'/index.ts': '// init registerHandler inspectStatus renderOnLoad createBackendReq node:test assert\nexport const value = 1;'});
  expect(result.passed).toBe(false);
  expect(result.checks.registeredInInit).toBe(false);
  expect(result.checks.handlerReturnsValue).toBe(false);
});
test.each([
  ["import electron from 'electron';", 'forbidden import'],
  ["import internal from '@anikitenko/fdo-sdk/dist/private';", 'forbidden import'],
  ['document.querySelector("body");', 'browser API outside'],
])('rejects unsupported host/browser usage: %s', (extra, issue) => {
  const files = fixture();
  files['/index.ts'] += '\n' + extra;
  expect(evaluatePluginCode(files).violations.join(' ')).toContain(issue);
});
test('requires a returned handler value and an actual matching click binding', () => {
  const files = fixture();
  files['/index.ts'] = files['/index.ts'].replace(/\(\) => \(\{[\s\S]*?\}\)\)/, '() => {})').replace('event: "click"', 'event: "change"');
  const result = evaluatePluginCode(files);
  expect(result.checks.handlerReturnsValue).toBe(false);
  expect(result.checks.clickBinding).toBe(false);
  expect(result.passed).toBe(false);
});
test('rejects absent tests even when the implementation passes', () => {
  const files = fixture();
  delete files['/render.test.ts'];
  expect(evaluatePluginCode(files).checks.atLeastTwoTests).toBe(false);
});
