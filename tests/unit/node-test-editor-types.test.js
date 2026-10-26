import fs from "node:fs";
import path from "node:path";
import {buildWorkspaceMonacoCompilerOptions} from "../../src/components/editor/utils/workspaceMonacoCompilerOptions";
import {NODE_TYPES_FALLBACK, NODE_TYPES_SHIM} from "../../src/components/editor/utils/nodeBuiltinEditorTypes";

test("Monaco resolves Node test imports with the bundled declarations", () => {
    const ts = require('../helpers/loadMonacoTypeScript.cjs')();
    const files = {};
    function collect(directory, prefix) {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const disk = path.join(directory, entry.name);
            const virtual = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) collect(disk, virtual);
            else if (/\.d\.ts$|package\.json$/.test(entry.name)) files[virtual] = fs.readFileSync(disk, "utf8");
        }
    }
    collect("node_modules/@types/node", "/node_modules/@types/node");
    collect("node_modules/undici-types", "/node_modules/undici-types");
    files["/example.test.ts"] = 'import {test} from "node:test"; import assert from "node:assert/strict"; test("example", () => { assert.equal(1, 1); assert.match("hello", /hello/); });';
    collect("node_modules/@anikitenko/fdo-sdk/dist/@types", "/node_modules/@anikitenko/fdo-sdk");
    files["/render.tsx"] = 'export const Render = () => "hello";';
    files["/index.ts"] = 'import {FDO_SDK} from "@anikitenko/fdo-sdk"; import {Render} from "./render"; declare const sdk: FDO_SDK; sdk.info(Render());';
    // Monaco 0.53 exposes only NodeJs, not the newer Bundler enum.
    const options = {...buildWorkspaceMonacoCompilerOptions({...ts, ModuleResolutionKind: {NodeJs: 2}}), noLib: true};
    delete options.lib;
    const host = {
        getSourceFile: (p, language) => files[p] === undefined ? undefined : ts.createSourceFile(p, files[p], language),
        getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => "/", getDirectories: () => [],
        fileExists: p => files[p] !== undefined, readFile: p => files[p], getCanonicalFileName: p => p,
        useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    };
    const program = ts.createProgram(Object.keys(files).filter(p => /\.tsx?$/.test(p)), options, host);
    files["/node_modules/@types/fdo-node-builtins.d.ts"] = NODE_TYPES_SHIM;
    const diagnostics = ["/example.test.ts", "/index.ts"].flatMap(file => program.getSemanticDiagnostics(program.getSourceFile(file)));
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
});

test("Monaco accepts node builtins from the fallback when packaged types are absent", () => {
    const ts = require('../helpers/loadMonacoTypeScript.cjs')();
    const source = [
        'import {test, describe} from "node:test";',
        'import assert from "node:assert/strict";',
        'import {strictEqual} from "node:assert";',
        'import {readFileSync} from "node:fs";',
        'import {join} from "node:path";',
        'import {platform} from "node:os";',
        'describe("suite", () => { test("example", () => { assert.equal(platform(), platform()); assert.match(join("a", "b"), /a/); strictEqual(readFileSync("x").length, 0); }); });',
    ].join("\n");
    const files = {"/example.test.ts": source, "/fallback.d.ts": NODE_TYPES_FALLBACK};
    const options = {...buildWorkspaceMonacoCompilerOptions(ts), noLib: true, types: []};
    delete options.lib;
    const host = {
        getSourceFile: (filePath, language) => files[filePath] === undefined ? undefined : ts.createSourceFile(filePath, files[filePath], language),
        getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => "/", getDirectories: () => [],
        fileExists: filePath => files[filePath] !== undefined, readFile: filePath => files[filePath], getCanonicalFileName: filePath => filePath,
        useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    };
    const program = ts.createProgram(Object.keys(files), options, host);
    const diagnostics = program.getSemanticDiagnostics(program.getSourceFile("/example.test.ts"));
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
});
