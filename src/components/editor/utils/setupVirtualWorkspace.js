import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {workspaceTsCompilerOptions} from "../../../utils/workspaceTsCompilerOptions";
import darkTheme from "../monaco/EditorDarkTheme"
import {AppToaster} from "../../AppToaster.jsx";

export async function setupVirtualWorkspace(name, template, dir) {
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
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    if (!virtualFS.isInitWorkspace()) {
        const sandboxName = "sandbox_" + name
        virtualFS.setInitWorkspace(name, sandboxName)
        const sandbox = localStorage.getItem(sandboxName)
        if (dir === "sandbox" || dir.includes(sandboxName)) {
            if (sandbox) {
                virtualFS.restoreSandbox(sandbox)
            } else {
                createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, name, template)
                createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, name, template)
                createVirtualFile("/package.json", packageJsonContent(name))
                virtualFS.fs.create()
            }
        } else {
            const data = await window.electron.plugin.getData(dir)
            if (data.success) {
                for (const file of data.content) {
                    createVirtualFile(file.path, file.content)
                }
                virtualFS.fs.create()
            } else {
                (AppToaster).show({message: `${data.error}`, intent: "danger"});
            }
        }
    }
}
