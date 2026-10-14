import {importsPluginSdkBase, validateGeneratedFileSyntax} from '../../src/utils/plugins/validation/generatedFileSyntax';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';

test.each([
    ['/features/text/logic.ts', 'export const x: string = ;'],
    ['/features/index.tsx', 'export const x = <div>'],
    ['/lib/worker.mjs', 'export function f( {'],
    ['/tests/logic.test.ts', 'import test from "node:test"; test("x", () => {'],
    ['/styles/overlay.css', '.overlay { color: red;'],
    ['/data/options.json', '{"theme":}'],
])('validates syntax independently for %s', (path, content) => {
    expect(validateGeneratedPluginFiles([{path, content}], {partial: true}).errors.join('\n')).toContain(`${path}:`);
});

test.each(['// new Plugin();', 'const example = "new Plugin()";', 'function later() { new Plugin(); }',
    'register(() => new Plugin());', 'register(function () { return new Plugin(); });',
    'register?.(new Plugin());', 'register(ready && new Plugin());',
    'register(ready ? new Plugin() : null);']) (
    'entry must actually instantiate the plugin: %s', suffix => {
        expect(validateGeneratedFileSyntax({path: '/index.ts', content: `class Plugin extends FDO_SDK {}\n${suffix}`}, {entry: true}))
            .toEqual([expect.stringContaining('new Plugin()')]);
    });

test.each(['new Plugin();', 'export default new Plugin();', 'const instance = new Plugin();',
    'PluginRegistry.registerPlugin(new Plugin());', 'register(wrap(new Plugin()));',
    'const instance = register(new Plugin());', 'export default register(new Plugin());',
    'PluginRegistry.registerPlugin(new Plugin() as FDO_SDK);']) (
    'accepts executable entry instantiation: %s', suffix => {
        expect(validateGeneratedFileSyntax({path: '/index.ts', content: `class Plugin extends FDO_SDK {}\n${suffix}`}, {entry: true})).toEqual([]);
    });

test('accepts an aliased SDK import and preserves real source newlines', () => {
    const content = 'import {FDO_SDK as Base} from "@anikitenko/fdo-sdk";\n// entry\nclass Plugin extends Base {}\nnew Plugin();';
    expect(validateGeneratedPluginFiles([{path: '/index.ts', content}], {partial: true}).errors).toEqual([]);
});

test('nested index helpers and extracted classes do not have to instantiate a plugin', () => {
    expect(validateGeneratedPluginFiles([{path: '/features/index.ts', content: 'export class Feature extends FDO_SDK {}'}]).errors).toEqual([]);
});

test('file-local UI rules run without an entry, while pending wrappers are allowed', () => {
    const path = '/features/render.ts';
    expect(validateGeneratedPluginFiles([{path, content: 'export const field = `<input>`;'}], {partial: true}).errors).toEqual([]);
    expect(validateGeneratedPluginFiles([{path, content: 'export const field = DOM.createElement("div");'}], {partial: true}).errors)
        .toEqual([expect.stringContaining('DOM.createElement(...) is not an SDK static method')]);
});

test('a recoverable grammar violation reports the rule and the offending token, not a nearby blame', () => {
    // Recorded live failure (attempt 65): the thrown first-error path reported
    // "Unexpected token" at the closing `)` of a three-line arrow signature
    // while the actual defect — `readonly` on a non-array return type — sat 36
    // characters later; two repair rounds went into not understanding `)`.
    // Recovery-mode parsing states the grammar rule and points at `readonly`.
    const content = 'export const bindCategory = (\n  category: ToolCategoryKey,\n): readonly typeof dashboardActions => [\n  ...bindDashboard(),\n];';
    const errors = validateGeneratedFileSyntax({path: '/features/dashboard/actions.ts', content});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/features/dashboard/actions.ts:3:4: invalid source syntax:');
    expect(errors[0]).toContain("'readonly' type modifier is only permitted on array and tuple literal types");
    expect(errors[0]).toContain('The source has "readonly" there.');
    expect(errors[0]).toContain('): |readonly typeof dashboardActions');
});

test('a thrown defect names the token the source has where the parser expected another', () => {
    // Recorded live failure (attempt 67): a stray comma between a ternary's
    // true branch and its `:` — babel said only `expected ":"` while three
    // byte-identical repairs re-emitted the comma. The reason now quotes the
    // token present at the position as a sentence, not just a marker.
    const content = 'const el = ready\n  ? dom.createElement("select", null,\n      items.map((option) =>\n        dom.createElement("option", { value: option.value }, option.label),\n      )),\n  : dom.createElement("input", null);';
    const errors = validateGeneratedFileSyntax({path: '/render.ts', content});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('invalid source syntax: Unexpected token, expected ":"');
    expect(errors[0]).toContain('The source has "," there.');
    expect(errors[0]).toContain('Source at that position (| marks');
});

test('every recoverable violation is reported at once so one round can clear them all', () => {
    // The syntax checker stops at the first thrown defect, so independent
    // defects surface serially: a live file fixed its duplicate declaration in
    // round one and only then met the readonly type in round two, spending the
    // progression grant before the second defect could repeat fatally.
    const content = 'export const a = (): readonly string => 1;\nexport const b = (): readonly number => 2;';
    const errors = validateGeneratedFileSyntax({path: '/features/shared/actions.ts', content});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(':1:22: invalid source syntax:');
    expect(errors[1]).toContain(':2:22: invalid source syntax:');
    expect(errors[0]).toContain('export const a = (): |readonly string');
});

test('a redeclaration lists every declaration site so the duplicate can actually be found', () => {
    // Recorded live failure (attempt 70): babel reported the duplicate
    // `function renderDashboard` at line 197 of a 16,000-char file and never
    // the original; the model nudged seven characters twice and reverted.
    const content = 'export const renderDashboard = () => "";\nexport const other = 1;\n// renderDashboard renders the shell\nexport function renderDashboard() { return ""; }';
    const errors = validateGeneratedFileSyntax({path: '/features/dashboard/render.ts', content});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('has already been declared');
    expect(errors[0]).toContain('renderDashboard is declared at lines 1, 4 — exactly one declaration may remain; delete or rename the others.');
    expect(errors[0]).toContain('Source at that position (| marks');
});

test('an early template close names the backtick that ended it so the nesting defect can be repaired', () => {
    // Recorded live failure (attempt 75): the handler's enclosing template
    // was closed early by an unescaped inner backtick and babel's symptom
    // ("expected \",\"" at Cyrillic text) points past the cause — the row
    // reads valid alone, so the model returned the 13,670-char file
    // byte-identical three times and spent the repeat budget.
    const content = [
        'const handlers = {',
        '  applyResult: `({ document }) => {',
        '    const message = document.querySelector(".msg");',
        '    message.textContent = `Текст преобразован. Символов: ${count}.`;',
        '  }`,',
        '};',
    ].join('\n');
    const errors = validateGeneratedFileSyntax({path: '/features/text/render.ts', content});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('invalid source syntax');
    expect(errors[0]).toContain('The unescaped backtick at 4:27 closed a template literal opened earlier');
    expect(errors[0]).toContain('that is why it stops here');
    expect(errors[0]).toContain('putting a backslash before each');
    expect(errors[0]).not.toContain('has already been declared');
});

test('a syntax error with no backtick before its position carries no template note', () => {
    const errors = validateGeneratedFileSyntax({path: '/features/json/actions.ts', content: 'const x = ;'});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('invalid source syntax');
    expect(errors[0]).not.toContain('closed a template literal');
    // An escaped backtick is content, not a delimiter: no note either.
    const escaped = 'const a = "x\\`";\nconst b = `ok`;\nconst c = ;';
    const recovered = validateGeneratedFileSyntax({path: '/actions.ts', content: escaped});
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered[0]).not.toContain('closed a template literal');
});

test('detects exactly the SDK-base value import the entry-shape rule keys on', () => {
    expect(importsPluginSdkBase("import { FDO_SDK } from '@anikitenko/fdo-sdk';\nclass X {}")).toBe(true);
    expect(importsPluginSdkBase("import { FDO_SDK as Base } from '@anikitenko/fdo-sdk';\nclass X extends Base {}")).toBe(true);
    expect(importsPluginSdkBase("import type { FDO_SDK } from '@anikitenko/fdo-sdk';\nclass X {}")).toBe(false);
    expect(importsPluginSdkBase("import { FDOInterface } from '@anikitenko/fdo-sdk';\nimport { FDO_SDK } from 'other';")).toBe(false);
    expect(importsPluginSdkBase("import { FDO_SDK } from '@other/package';")).toBe(false);
    expect(importsPluginSdkBase('import { FDO_SDK } from')).toBe(false);
});


test('diagnoses function-valued property grammar without changing source or rejecting method syntax', () => {
    const {path, source, corrected} = require('../fixtures/ai/workspace-syntax-repair.cjs').scenario();
    const errors = validateGeneratedFileSyntax({path, content: source});
    expect(errors.join('\n')).toContain('Function-type syntax uses =>');
    expect(errors.join('\n')).toContain('expected "=>"');
    expect(validateGeneratedFileSyntax({path, content: corrected})).toEqual([]);
    expect(validateGeneratedFileSyntax({path, content: 'export interface Actions { close(context: HTMLElement): void; }'})).toEqual([]);
    const unrelated = validateGeneratedFileSyntax({path, content: 'export const broken = ;'}).join('\n');
    expect(unrelated).not.toContain('Function-type syntax');
});

test('rejects import/function collisions before the build transform, including a self-calling wrapper', () => {
    const {path, source, corrected} = require('../fixtures/ai/workspace-import-binding-repair.cjs').scenario();
    const errors = validateGeneratedFileSyntax({path, content: source});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("/render.tsx:2:17: invalid source syntax: Import binding 'renderOnLoad' at line 1 conflicts");
    expect(errors[0]).toContain('Alias the import');
    expect(validateGeneratedFileSyntax({path, content: corrected})).toEqual([]);
    expect(validateGeneratedPluginFiles([{path, content: source}], {partial: true}).errors).toEqual(errors);
});

test.each([
    'import run from "./actions"; export function run() {}',
    'import * as actions from "./actions"; export const actions = {};',
    'import {run as local} from "./actions"; class local {}',
    'import {run} from "./actions"; const {nested: [run = 1]} = value;',
    'import {run} from "./actions"; enum run { One }',
])('rejects colliding top-level runtime declarations: %s', content => {
    expect(validateGeneratedFileSyntax({path: '/module.ts', content}).length).toBeGreaterThan(0);
});

test.each([
    'import {run} from "./actions"; export {run};',
    'import {run} from "./actions"; export {run as start};',
    'import {run} from "./actions"; function other() { const run = 1; return run; }',
    'import {run} from "./actions"; const {run: local} = value;',
    'import type {Options} from "./types"; export const Options = {};',
    'import {type Options} from "./types"; export const Options = {};',
    'import {run} from "./actions"; export interface run { label: string }',
    'export function run(x: string): string; export function run(x: string) { return x; }',
])('preserves re-exports, inner scopes and TypeScript type/value namespaces: %s', content => {
    expect(validateGeneratedFileSyntax({path: '/module.ts', content})).toEqual([]);
});

test('duplicate helper diagnostics include the destructured declaration and its SDK contract mismatch', () => {
    const source = 'import {DOM as D} from "@anikitenko/fdo-sdk";\nconst {createButton, createTextarea} = D;\nfunction createButton() {}\nfunction createTextarea() {}';
    const errors = validateGeneratedFileSyntax({path: '/render.tsx', content: source});
    expect(errors.join('\n')).toContain('createButton is declared at lines 2, 3');
    expect(errors.join('\n')).toContain('createTextarea is declared at lines 2, 4');
    expect(errors.join('\n')).toContain('not static constructor properties');
});
