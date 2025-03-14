import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {workspaceTsCompilerOptions} from "../../../utils/workspaceTsCompilerOptions";
import darkTheme from "../monaco/EditorDarkTheme"

export async function setupVirtualWorkspace(name, template) {
    monaco.editor.defineTheme('editor-dark', darkTheme);

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2016,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        typeRoots: ["/node_modules/"],
        noImplicitAny: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        isolatedModules: true,
        suppressImplicitAnyIndexErrors: true,
        noImplicitThis: true,
        strict: true,
        jsx: monaco.languages.typescript.JsxEmit.ReactNative,
        skipDefaultLibCheck: true,
        ...workspaceTsCompilerOptions
    })
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false
    })
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
    })
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);
    if (!virtualFS.isInitWorkspace()) {
        const sandboxName = "sandbox_" + name
        virtualFS.setInitWorkspace(name, sandboxName)
        const sandbox = localStorage.getItem(sandboxName)
        if (sandbox) {
            virtualFS.restoreSandbox(sandbox)
        } else {
            createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, name, template)
            createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, name, template)
            createVirtualFile("/package.json", packageJsonContent(name))
            virtualFS.fs.create()
        }
    }
}
