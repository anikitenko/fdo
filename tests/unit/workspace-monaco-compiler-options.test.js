import { buildWorkspaceMonacoCompilerOptions } from "../../src/components/editor/utils/workspaceMonacoCompilerOptions.js";

describe("workspace monaco compiler options", () => {
    test("uses modern TS target/module/jsx settings without deprecated flags", () => {
        const options = buildWorkspaceMonacoCompilerOptions({
            ScriptTarget: { ES2021: 8, ES2022: 9, Latest: 99 },
            ModuleResolutionKind: { NodeJs: 2, Node10: 3, Bundler: 100 },
            ModuleKind: { ESNext: 99 },
            JsxEmit: { React: 2, ReactJSX: 4 },
        });

        expect(options.target).toBe(9);
        expect(options.moduleResolution).toBe(100);
        expect(options.module).toBe(99);
        expect(options.jsx).toBe(4);
        expect(options.lib).toEqual(["es2022", "dom", "dom.iterable"]);
        expect(options.suppressImplicitAnyIndexErrors).toBeUndefined();
        expect(options.jsxFactory).toBeUndefined();
        expect(options.jsxFragmentFactory).toBeUndefined();
    });

    test("falls back safely when newer Monaco enums are unavailable", () => {
        const options = buildWorkspaceMonacoCompilerOptions({
            ScriptTarget: { ES2021: 8, Latest: 99 },
            ModuleResolutionKind: { NodeJs: 2 },
            ModuleKind: { ESNext: 99 },
            JsxEmit: { React: 2 },
        });

        expect(options.target).toBe(8);
        expect(options.moduleResolution).toBe(2);
        expect(options.jsx).toBe(2);
    });
});
