import { workspaceTsCompilerOptions } from "../../../utils/plugins/validation/workspaceTsCompilerOptions";

export function buildWorkspaceMonacoCompilerOptions(monacoTs) {
    const scriptTarget = monacoTs?.ScriptTarget?.ES2022
        ?? monacoTs?.ScriptTarget?.ES2021
        ?? monacoTs?.ScriptTarget?.Latest;
    const moduleResolution = monacoTs?.ModuleResolutionKind?.Bundler
        ?? monacoTs?.ModuleResolutionKind?.Node10
        ?? monacoTs?.ModuleResolutionKind?.NodeJs;
    const jsxMode = monacoTs?.JsxEmit?.ReactJSX
        ?? monacoTs?.JsxEmit?.React;

    return {
        target: scriptTarget,
        lib: ["es2022", "dom", "dom.iterable"],
        allowNonTsExtensions: true,
        moduleResolution,
        module: monacoTs?.ModuleKind?.ESNext,
        typeRoots: ["/node_modules/@types", "/node_modules/"],
        types: ["node"],
        noImplicitAny: true,
        // Unused declarations are quality findings, not workspace correctness
        // failures. The backend retains them separately as warnings.
        noUnusedLocals: false,
        noUnusedParameters: false,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        isolatedModules: true,
        noImplicitThis: true,
        strict: true,
        jsx: jsxMode,
        skipDefaultLibCheck: true,
        ...workspaceTsCompilerOptions,
        // Bundled @types/node publishes node:test, node:assert/strict and the
        // other builtins as ambient modules. Map the protocol onto those files
        // so Monaco resolves them without a directory listing of typeRoots.
        paths: {
            "node:*": ["/node_modules/@types/node/*"],
        },
    };
}
