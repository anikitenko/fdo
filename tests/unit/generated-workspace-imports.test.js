import {inboundGeneratedImports, validateGeneratedWorkspaceImports as validate} from '../../src/utils/plugins/validation/generatedWorkspaceImports';
import {validateGeneratedPluginFiles} from '../../src/components/editor/utils/validateGeneratedPluginFiles';

const source = (path, content) => ({path, content});

test('rejects the recorded live renderer self-import before applying it', () => {
    const content = require('fs').readFileSync(require('path').join(__dirname,
        '../fixtures/ai/workspace-render-self-import.tsx'), 'utf8');
    expect(validateGeneratedPluginFiles([source('/render.tsx', content)], {partial: true}).errors)
        .toContainEqual(expect.stringContaining('resolves to this same file'));
});

test.each([
    ['/render.tsx', 'import {render} from "./render";'],
    ['/ui/index.ts', 'export * from "../ui";'],
    ['/styles/layout.css', '@import "./../styles/layout.css";'],
])('rejects self dependencies in %s', (path, content) => {
    expect(validate([source(path, content)])).toContainEqual(expect.stringContaining('resolves to this same file'));
});

test('names the resolved target and legal alternatives when a local import matches no planned file', () => {
    const files = [source('/styles.css', '@import "./features/categories/styles/category-workspace.css";')];
    expect(validate(files, {paths: ['/styles.css', '/features/dashboard/styles.css', '/features/library/styles.css']}))
        .toContainEqual(expect.stringContaining('resolves to "/features/categories/styles/category-workspace.css", which has no file in the workspace or approved plan'));
    expect(validate(files, {paths: ['/styles.css', '/features/dashboard/styles.css', '/features/library/styles.css']}))
        .toContainEqual(expect.stringContaining('Valid targets: /features/dashboard/styles.css, /features/library/styles.css'));
    // The importer's own path is never a legal target, so it is not listed.
    expect(validate(files, {paths: ['/styles.css', '/features/dashboard/styles.css']})).not
        .toContainEqual(expect.stringContaining('Valid targets: /styles.css'));
});

test('states where an unresolved import\'s pulled names are exported, or that no known interface has them', () => {
    const files = [
        source('/render.tsx', 'import { metadata, nowhere } from "./plugin";\nexport { metadata };'),
        source('/index.ts', 'export const plugin = {};'),
    ];
    const errors = validate(files, {paths: ['/render.tsx', '/index.ts']});
    // The recorded live repair repointed "./plugin"'s names at a module that
    // never exported them because the rejection named only the bad path.
    expect(errors).toContainEqual(expect.stringContaining(
        'The import pulls {metadata, nowhere}: metadata is exported by "/render.tsx" (this file’s export list; this may be only a re-export'));
    expect(errors).toContainEqual(expect.stringContaining(
        'nowhere is exported by no workspace file with a known interface.'));
});

test('points each pulled name at its exact home when every name has exactly one owner', () => {
    const files = [
        source('/features/dashboard/render.ts', 'import { categoryKeys, CategoryKey } from "../../categories/types";'),
        source('/features/categories/logic.ts', 'export const categoryKeys = [];'),
        source('/features/categories/types.ts', 'export type CategoryKey = string;'),
    ];
    const errors = validate(files, {
        paths: ['/features/dashboard/render.ts', '/features/categories/logic.ts', '/features/categories/types.ts'],
    });
    // The recorded live repair kept a wrong-path import pulling names owned
    // by two modules: the single-path tail note could not express the split.
    expect(errors).toContainEqual(expect.stringContaining(
        'The correct sources, by name: categoryKeys from "../categories/logic.ts", CategoryKey from "../categories/types.ts" — rewrite the import so each name is pulled from exactly the file named for it.'));
});

test('withholds the per-name sources line when any pulled name has no single owner', () => {
    const files = [
        source('/features/dashboard/render.ts', 'import { categoryKeys, nowhere } from "../../categories/types";'),
        source('/features/categories/logic.ts', 'export const categoryKeys = [];'),
        source('/features/categories/types.ts', 'export type CategoryKey = string;'),
    ];
    const errors = validate(files, {
        paths: ['/features/dashboard/render.ts', '/features/categories/logic.ts', '/features/categories/types.ts'],
    });
    expect(errors.join('\n')).not.toContain('The correct sources, by name');
});

test('states the missing index module and the planned files when a specifier names a directory', () => {
    const files = [source('/render.tsx', 'import "./features/dashboard";')];
    const paths = ['/render.tsx', '/features/dashboard/data.ts', '/index.ts'];
    expect(validate(files, {paths})).toContainEqual(expect.stringContaining(
        'is a directory, not a module: no index module is planned inside it, and its planned files are /features/dashboard/data.ts'));
    expect(validate(files, {paths})).toContainEqual(expect.stringContaining(
        'Module imports must name a concrete planned file; import one of those files directly instead of the directory.'));
    // A wholly invented path with nothing planned beneath it keeps the plain
    // missing-target message: the directory claims would be unverifiable.
    const invented = [source('/render.tsx', 'import "./features/invented";')];
    expect(validate(invented, {paths})).not
        .toContainEqual(expect.stringContaining('is a directory, not a module'));
});

test('names the planned file a wrong-depth specifier intended, with the exact relative specifier', () => {
    // Recorded live shape: from /features/categories/text/, a single ".."
    // lands in /features/categories/dashboard/ instead of /features/dashboard/.
    const files = [source('/features/categories/text/styles.css', '@import "../dashboard/theme.css";')];
    const paths = ['/features/categories/text/styles.css', '/features/dashboard/theme.css', '/styles.css'];
    expect(validate(files, {paths})).toContainEqual(expect.stringContaining(
        'The specifier\'s ending "dashboard/theme.css" matches the planned file "/features/dashboard/theme.css"'));
    expect(validate(files, {paths})).toContainEqual(expect.stringContaining(
        'from /features/categories/text/styles.css write "../../dashboard/theme.css"'));
    // Ambiguous endings list the candidates instead of prescribing one.
    const ambiguous = [source('/x/y.css', '@import "../theme.css";')];
    expect(validate(ambiguous, {paths: ['/x/y.css', '/a/theme.css', '/b/theme.css']})).toContainEqual(
        expect.stringContaining('matches planned files: /a/theme.css, /b/theme.css'));
});

test('an extensionless wrong-depth specifier names the planned sibling and the exact relative write', () => {
    // Recorded live shape: a repair at /features/categories/test.test.ts
    // rewrote siblings as "./categories/logic"/"./categories/types", one
    // directory too deep. The bare tail never ends with ".ts", so the
    // ending match must compare extension-stripped paths to fire.
    const files = [source('/features/categories/test.test.ts',
        'import {run} from "./categories/logic"; import type {T} from "./categories/types";'),
    source('/features/categories/logic.ts', 'export const run = () => {};')];
    const errors = validate(files, {paths: ['/features/categories/test.test.ts',
        '/features/categories/logic.ts', '/features/categories/types.ts']});
    expect(errors).toContainEqual(expect.stringContaining(
        'The specifier\'s ending "categories/logic" matches the planned file "/features/categories/logic.ts"'));
    expect(errors).toContainEqual(expect.stringContaining(
        'from /features/categories/test.test.ts write "./logic.ts"'));
    // The other bare sibling resolves the same way, to its exact specifier.
    expect(errors).toContainEqual(expect.stringContaining(
        'The specifier\'s ending "categories/types" matches the planned file "/features/categories/types.ts"'));
    expect(errors).toContainEqual(expect.stringContaining(
        'from /features/categories/test.test.ts write "./types.ts"'));
});

test('explains ..-as-workspace-root specifiers as both interpretations', () => {
    const files = [source('/features/dashboard/styles/base.css', '@import "../features/dashboard/styles/base.css";')];
    // The recorded live shape: the specifier names the importer itself when
    // read from the root, and resolves to a doubled path when read normally.
    expect(validate(files, {paths: ['/features/dashboard/styles/base.css', '/styles.css']}))
        .toContainEqual(expect.stringContaining('the specifier names /features/dashboard/styles/base.css itself, and a file must never import itself'));
    const renamed = [source('/features/dashboard/styles/base.css', '@import "../features/dashboard/styles/panel.css";')];
    expect(validate(renamed, {paths: ['/features/dashboard/styles/base.css', '/features/dashboard/styles/panel.css']}))
        .toContainEqual(expect.stringContaining('interpreted from the workspace root the specifier would be "/features/dashboard/styles/panel.css", which is planned; from /features/dashboard/styles/base.css write "./panel.css"'));
});

test('resolves existing, pending, directory and absolute imports with virtual build precedence', () => {
    const files = [source('/ui/render.ts', 'import "../styles.css"; import {item} from "./parts"; import "/actions.ts"; import x from "sdk";')];
    expect(validate(files, {paths: ['/ui/render.ts', '/styles.css', '/ui/parts/index.ts', '/actions.ts']})).toEqual([]);
    expect(validate(files, {paths: ['/ui/render.ts']})).toHaveLength(3);
    expect(validate(files, {checkMissing: false})).toEqual([]);
    expect(validate([source('/ui.ts', 'import "./ui";')], {paths: ['/ui.ts', '/ui.js']})).toEqual([]);
});

test('resolves NodeNext-style .js specifiers against planned TypeScript sources', () => {
    // TypeScript's module convention writes './module.js' for './module.ts';
    // a plan listing only .ts sources must accept that import.
    const files = [source('/render.tsx',
        'import {Dashboard} from "./features/dashboard/render.js";\nimport {renderers} from "./features/categories/renderers.js";')];
    expect(validate([files[0]], {paths: ['/render.tsx', '/features/dashboard/render.ts',
        '/features/categories/renderers.tsx']})).toEqual([]);
    // A sibling that really exists as .js still resolves before substitution.
    expect(validate([files[0]], {paths: ['/render.tsx', '/features/dashboard/render.js',
        '/features/categories/renderers.tsx']})).toEqual([]);
    // Genuinely unplanned imports stay rejected even with substitution active.
    expect(validate([files[0]], {paths: ['/render.tsx', '/features/dashboard/render.ts']}))
        .toEqual([expect.stringContaining('/features/categories/renderers.js')]);
});

test('checks named, aliased, default and re-exported imports against actual source', () => {
    const dependencies = [source('/logic.ts', 'export type Mode = string; export const {run, stop: halt} = tools; export default 1;')];
    const good = source('/render.ts', 'import value, {run as execute, halt, type Mode} from "./logic"; export {run as action} from "./logic";');
    expect(validate([good], {sources: [good, ...dependencies]})).toEqual([]);
    const bad = source('/render.ts', 'import {missing} from "./logic";');
    expect(validate([bad], {sources: [bad, ...dependencies]})).toEqual([
        '/render.ts: /logic.ts does not export missing. It exports Mode, run, halt, default. Keep imports and the dependency\'s actual public interface consistent.',
    ]);
});

test('states the dependency exports and where a missing name actually lives', () => {
    // Recorded live shape: a repair invented CATEGORY_TOOLS for types.ts and
    // repeated it because the rejection never said what types.ts exports.
    const files = [
        source('/render.ts', 'import {CATEGORY_TOOLS} from "./types";'),
        source('/types.ts', 'export type CategoryTool = string;'),
        source('/config.ts', 'export const CATEGORY_TOOLS = [];'),
    ];
    expect(validate(files)).toEqual([
        '/render.ts: /types.ts does not export CATEGORY_TOOLS. It exports CategoryTool. CATEGORY_TOOLS is exported by "/config.ts". Keep imports and the dependency\'s actual public interface consistent.',
    ]);
    // A dependency with no exports at all says so instead of listing nothing.
    const empty = [source('/render.ts', 'import {x} from "./empty";'), source('/empty.ts', '')];
    expect(validate(empty)).toEqual([
        '/render.ts: /empty.ts does not export x. It exports nothing. Keep imports and the dependency\'s actual public interface consistent.',
    ]);
});

test('reports completed modules that already import a pending file, with exact names', () => {
    const completed = [
        source('/render.tsx', 'import {render} from "./features/categories/render"; export const out = render;'),
        source('/side.ts', 'import "./features/categories/render"; export {};'),
        source('/index.ts', 'export const boot = 1;'),
    ];
    const paths = ['/render.tsx', '/side.ts', '/index.ts', '/features/categories/render.tsx'];
    // Side-effect imports carry no names and uninvolved files never appear.
    expect(inboundGeneratedImports(completed, '/features/categories/render.tsx', paths))
        .toEqual([{path: '/render.tsx', names: ['render']}]);
    // A completed file importing itself, or imports resolving elsewhere, add nothing.
    expect(inboundGeneratedImports(completed, '/render.tsx', paths)).toEqual([]);
    // CSS is consumed through its implicit default import; no interface to list.
    expect(inboundGeneratedImports(completed, '/styles.css', [...paths, '/styles.css'])).toEqual([]);
});

test('does not invent exports for CSS maps, JSON, CommonJS or star re-exports', () => {
    const dependencies = [source('/style.css', '.shell {}'), source('/data.json', '{}'),
        source('/cjs.cjs', 'module.exports = compute();'), source('/barrel.ts', 'export * from "./unknown";')];
    const consumer = source('/render.ts', 'import styles from "./style.css"; import data from "./data.json"; import {x} from "./cjs.cjs"; import {y} from "./barrel";');
    expect(validate([consumer], {sources: [consumer, ...dependencies]})).toEqual([]);
});

test('syntax diagnostics remain owned by the source parser', () => {
    expect(validate([source('/bad.ts', 'export const = ;')])).toEqual([]);
});

test('missing default import points to the intended dependency rather than an unrelated default export', () => {
    const errors = validate([
        source('/index.ts', 'import Feature from "./render"; export default class Plugin {}'),
        source('/render.tsx', 'export class JSONInspectorFeature {}'),
    ]);
    expect(errors.join('\n')).toContain('It exports JSONInspectorFeature');
    expect(errors.join('\n')).not.toContain('default is exported by');
    expect(errors.join('\n')).toContain('named export');
});

test('corrects recorded test import depth only against the dependency exports', () => {
    const {repairGeneratedImportDepth} = require('../../src/utils/plugins/validation/generatedWorkspaceImports');
    const file = source('/tests/json-inspector.test.ts', 'import {validateAndSummarize} from "./features/json-inspector/logic";\nimport type {JsonSummary} from "./features/json-inspector/logic";');
    const dependency = source('/features/json-inspector/logic.ts', 'export function validateAndSummarize() {} export interface JsonSummary {}');
    const result = repairGeneratedImportDepth(file, [dependency]);
    expect(result.repaired).toBe(true);
    expect(result.content.match(/"\.\.\/features\/json-inspector\/logic.ts"/g)).toHaveLength(2);
    expect(validate([source(file.path, result.content), dependency])).toEqual([]);
    expect(repairGeneratedImportDepth(source(file.path, result.content), [dependency]).repaired).toBe(false);
});
test('does not guess a dependency when its exports or path are ambiguous', () => {
    const {repairGeneratedImportDepth} = require('../../src/utils/plugins/validation/generatedWorkspaceImports');
    const file = source('/tests/check.test.ts', 'import {inspect} from "./logic";');
    for (const dependencies of [
        [source('/logic.ts', 'export const other = 1;')],
        [source('/logic.ts', 'export const inspect = 1;'), source('/features/logic.ts', 'export const inspect = 2;')],
        [source('/logic.ts', 'export * from "./other";')],
    ]) expect(repairGeneratedImportDepth(file, dependencies)).toEqual({content: file.content, repaired: false});
});

test('removes a nonexistent type-only import only when its concrete type is already local', () => {
    const {repairGeneratedImportDepth} = require('../../src/utils/plugins/validation/generatedWorkspaceImports');
    const content = 'import type {ValidationOutcome} from "./logic.types";\nexport interface ValidationOutcome {valid: boolean;}\nexport function inspect(): ValidationOutcome {return {valid: true};}';
    const result = repairGeneratedImportDepth(source('/features/json/logic.ts', content), []);
    expect(result.repaired).toBe(true);
    expect(result.content).not.toContain('import type');
    expect(result.content).toContain('export interface ValidationOutcome {valid: boolean;}');
    expect(result.content).toContain('return {valid: true}');
});

test.each([
    'import type {ValidationOutcome} from "./logic.types"; export type {ValidationOutcome};',
    'import {ValidationOutcome} from "./logic.types"; export interface ValidationOutcome {valid: boolean;}',
    'import type {ValidationOutcome, Other} from "./logic.types"; export interface ValidationOutcome {valid: boolean;}',
])('does not erase a missing declaration or runtime import: %s', content => {
    const {repairGeneratedImportDepth} = require('../../src/utils/plugins/validation/generatedWorkspaceImports');
    expect(repairGeneratedImportDepth(source('/logic.ts', content), []).repaired).toBe(false);
});
