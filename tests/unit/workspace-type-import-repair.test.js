import {applyWorkspaceTypeImportRepair, prepareWorkspaceTypeImportRepair} from '../../src/utils/plugins/validation/workspaceTypeImportRepair';
import {validateGeneratedWorkspaceImports} from '../../src/utils/plugins/validation/generatedWorkspaceImports';
const fixture = require('../fixtures/ai/workspace-type-import-repair.cjs');
const names = ['CategoryToolDefinition', 'CategoryToolResult', 'TextToolResult'];

test('assembled interfaces satisfy imports and strict TypeScript checking of consumer object shapes', () => {
    const repair = prepareWorkspaceTypeImportRepair(fixture.broken, names);
    const fixed = applyWorkspaceTypeImportRepair(repair, fixture.header);
    expect(fixed.endsWith(repair.body)).toBe(true);
    expect(fixed).toContain(fixture.body);
    const files = [fixture.consumer, fixture.types, fixture.text, fixed, 'export {};']
        .map((content, index) => ({path: fixture.files[index].path, content}));
    expect(validateGeneratedWorkspaceImports(files)).toEqual([]);
    // Use the same TypeScript service bundled into the editor; no second
    // compiler dependency or generated-code execution is needed.
    const worker = require('node:fs').readFileSync('node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', 'utf8');
    const ts = new Function(worker.slice(worker.indexOf('var ts ='), worker.indexOf('// src/language/typescript/lib/lib.ts'))
        + '\nreturn typescript;')();
    const options = {strict: true, noEmit: true, noLib: true, types: [], module: ts.ModuleKind.CommonJS};
    const sources = new Map(files.map(file => [file.path, file.content]));
    sources.set('/globals.d.ts', 'interface String {toUpperCase(): string;}');
    const host = {
        getSourceFile: (path, language) => sources.has(path) ? ts.createSourceFile(path, sources.get(path), language) : undefined,
        getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '/', getDirectories: () => [],
        fileExists: path => sources.has(path), readFile: path => sources.get(path), getCanonicalFileName: path => path,
        useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    };
    host.resolveModuleNames = (names, importer) => names.map(name => {
        const path = require('node:path').posix.resolve(require('node:path').posix.dirname(importer), name) + '.ts';
        return sources.has(path) ? {resolvedFileName: path, extension: ts.Extension.Ts} : undefined;
    });
    const program = ts.createProgram([...sources.keys()], options, host);
    const diagnostics = files.flatMap(file => program.getSemanticDiagnostics(program.getSourceFile(file.path)));
    expect(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
});

test.each([
    'export const replaced = 1;', 'export function run() {}', 'class Replaced {}', 'run();',
    'export * from "./types";', 'export * as all from "./types";', 'declare const invented: string;',
    'enum Invented {Value}', 'namespace Invented {}', '"use strict";',
])('rejects executable or unconstrained interface headers: %s', header => {
    const repair = prepareWorkspaceTypeImportRepair(fixture.broken, names);
    expect(() => applyWorkspaceTypeImportRepair(repair, header)).toThrow();
});

test('does not select value-only imports, unrelated types, invalid syntax or directive-sensitive source', () => {
    expect(prepareWorkspaceTypeImportRepair('import {Thing} from "./types"; export const value = Thing;', ['Thing'])).toBeNull();
    expect(prepareWorkspaceTypeImportRepair('import type {Other} from "./types";', names)).toBeNull();
    expect(prepareWorkspaceTypeImportRepair('export const = ;', names)).toBeNull();
    expect(prepareWorkspaceTypeImportRepair('"use client";\n' + fixture.broken, names)).toBeNull();
});

test('supports inline type imports and explicit type re-exports without rewriting implementations', () => {
    const repair = prepareWorkspaceTypeImportRepair('import {type Shape, value} from "./types";\nexport const run = () => value;', ['Shape']);
    const fixed = applyWorkspaceTypeImportRepair(repair, 'import {value} from "./types";\nexport type {Shape} from "./types";');
    expect(fixed.endsWith('\nexport const run = () => value;')).toBe(true);
});
