import { workspaceTsCompilerOptions } from "../../../utils/workspaceTsCompilerOptions";

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
        typeRoots: ["/node_modules/"],
        noImplicitAny: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        isolatedModules: true,
        noImplicitThis: true,
        strict: true,
        jsx: jsxMode,
        skipDefaultLibCheck: true,
        ...workspaceTsCompilerOptions,
    };
}
