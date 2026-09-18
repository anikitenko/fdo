import fs from "node:fs";
import path from "node:path";
import {buildWorkspaceMonacoCompilerOptions} from "../../src/components/editor/utils/workspaceMonacoCompilerOptions";

test("Monaco resolves Node test imports with the bundled declarations", () => {
    const servicesPath = path.resolve("node_modules/monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js");
    const source = fs.existsSync(servicesPath)
        ? fs.readFileSync(servicesPath, "utf8").replace(/export \{[^}]+\};\s*$/, "return typescript;")
        : (() => {
            const worker = fs.readFileSync(path.resolve("node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js"), "utf8");
            return worker.slice(worker.indexOf("var ts ="), worker.indexOf("// src/language/typescript/lib/lib.ts")) + "\nreturn typescript;";
        })();
    const ts = new Function(source)();
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
    const diagnostics = ["/example.test.ts", "/index.ts"].flatMap(file => program.getSemanticDiagnostics(program.getSourceFile(file)));
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
});
