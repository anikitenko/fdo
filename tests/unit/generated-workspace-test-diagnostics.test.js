import {generatedWorkspaceTestDiagnostics as diagnose} from '../../src/utils/plugins/validation/generatedWorkspaceTestDiagnostics';
import {getValidationRepairPaths} from '../../src/components/editor/utils/aiCodingAgentPlanRepair';

const files = [
    {path: '/actions.test.ts', content: 'import {register} from "./actions";'},
    {path: '/actions.ts', content: 'export const register = () => {};'},
    {path: '/features/tools/logic.test.ts', content: 'import {stats} from "./logic";'},
    {path: '/features/tools/logic.ts', content: 'export const stats = () => 1;'},
    {path: '/render.test.ts', content: 'import Plugin from "./index";'},
    {path: '/index.ts', content: 'export default class Plugin {}'},
    {path: '/unrelated.ts', content: ''},
];
// Distinct root causes from the 37.7-minute live run, including the early
// SDK startup error that the old tail-only failure message dropped.
const output = `Error: Plugin host messaging bridge is unavailable: process.parentPort is not initialized.

test at actions.test.js:757:29
✖ returns error string when payload is a string instead of object
  ReferenceError: PluginRegistry is not defined
    at TestContext.<anonymous> (/tmp/run/compiled/actions.test.js:428:3)

test at features/tools/logic.test.js:375:27
✖ computes word, character, line, sentence and paragraph counts
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  1 !== 2

test at ../../../../var/folders/tmp/run/compiled/render.test.js:1:1
✖ /var/folders/tmp/run/compiled/render.test.js
  'test failed'`;
test('keeps all three live failure causes and limits repair scope', () => {
    const errors = diagnose({output}, files);
    expect(errors.join('\n')).toContain('PluginRegistry is not defined');
    expect(errors.join('\n')).toContain('1 !== 2');
    expect(errors.join('\n')).toContain('process.parentPort');
    expect(getValidationRepairPaths(errors, files).sort()).toEqual(files.slice(0, 6).map(file => file.path).sort());
});
test('unmapped or ambiguous output does not authorize a guessed repair', () => {
    const errors = diagnose({output: output.replace('actions.test.js:757', 'missing.test.js:757')}, files);
    expect(getValidationRepairPaths(errors, files)).toEqual([]);
});
test('type-only dependencies and unrelated files are not repair targets', () => {
    const sample = [{path: '/actions.test.ts', content: 'import type {Thing} from "./unrelated"; import {type Other} from "./other";'},
        {path: '/unrelated.ts', content: ''}, {path: '/other.ts', content: ''}];
    expect(diagnose({output: '\ntest at actions.test.js:1:1\nReferenceError: missing'}, sample)).toHaveLength(1);
});
test('normalizes Windows compiled locations and strips ANSI escapes', () => {
    const errors = diagnose({output: '\ntest at C:\\tmp\\compiled\\actions.test.js:1:1\n\u001b[31mReferenceError: missing\u001b[39m'}, files);
    expect(errors[0]).toMatch(/^\/actions.test.ts:/);
    expect(errors.join('')).not.toContain('\u001b');
});

test('keeps late assertion evidence without repeating other files failures', () => {
    const many = Array.from({length: 16}, (_, index) => `\ntest at actions.test.js:${index + 1}:1\n✖ case ${index}\nAssertionError: unique-${index}\n${'assertion body '.repeat(100)}`).join('');
    const errors = diagnose({output: many + '\ntest at render.test.js:1:1\nAssertionError: unrelated-render-failure'}, files);
    const action = errors.find(error => error.startsWith('/actions.test.ts:'));
    expect(action).toContain('case 15');
    expect(action).toContain('unique-15');
    expect(action).not.toContain('unrelated-render-failure');
    expect(action.length).toBeLessThan(7000);
});

test('mapped stack frames retain the actual transitive failure owner', () => {
    const sourceFiles = [{path: '/render.test.ts', content: 'import {render} from "./render";'},
        {path: '/render.ts', content: 'export const render = () => {};'},
        {path: '/render/navigation.tsx', content: 'export const nav = () => {};'}];
    const errors = diagnose({output: '\ntest at /tmp/run/workspace/render.test.ts:6:1\nTypeError: Cannot convert undefined or null to object\n    at NavigationBar (/tmp/run/workspace/render/navigation.tsx:105:25)\n    at Render (/tmp/run/workspace/render.ts:59:15)'}, sourceFiles);
    expect(errors[0]).toContain('at NavigationBar (/render/navigation.tsx:105:25)');
    expect(getValidationRepairPaths(errors, sourceFiles)).toContain('/render/navigation.tsx');
});

test('maps CommonJS bundle startup failures back to the original test and its dependencies', () => {
    const diagnostics = diagnose({output: `ReferenceError: missingFixture is not defined
\ntest at /tmp/fdo-plugin-tests-example/compiled/features/tools/logic.test.cjs:1:1
✖ /tmp/fdo-plugin-tests-example/compiled/features/tools/logic.test.cjs
  'test failed'`}, files);
    expect(diagnostics[0]).toContain('/features/tools/logic.test.ts: Generated tests failed');
    expect(diagnostics[0]).toContain('missingFixture is not defined');
    expect(diagnostics.some(message => message.startsWith('/features/tools/logic.ts:'))).toBe(true);
    expect(diagnostics.join('\n')).not.toContain('unmapped locations');
    expect(diagnostics.join('\n')).not.toContain('/unrelated.ts');
});

test('a source-mapped HTML assertion does not authorize unrelated tool implementations', () => {
    const candidate = [
        {path: '/render.test.ts', content: `import {it} from 'node:test';
import {analyzeHtml} from './features/html/logic';
import {formatJson} from './features/json/logic';
it('empty HTML', () => { const result = analyzeHtml(''); if (result.ok) throw new Error('expected error'); });
it('JSON', () => formatJson('{}'));`},
        {path: '/features/html/logic.ts', content: 'export const analyzeHtml = () => ({ok:true});'},
        {path: '/features/json/logic.ts', content: 'export const formatJson = () => "{}";'},
    ];
    const result = diagnose({output: 'Test failures:\ntest at /tmp/run/workspace/render.test.ts:4:1\n✖ empty HTML\n  AssertionError: true !== false'}, candidate);
    expect(result.some(line => line.startsWith('/features/html/logic.ts:'))).toBe(true);
    expect(result.some(line => line.startsWith('/features/json/logic.ts:'))).toBe(false);
});
