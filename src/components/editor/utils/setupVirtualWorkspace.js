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
        module: monaco.languages.typescript.ModuleKind.ES2015,
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
    })
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
    })
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    const resultFiles = await window.electron.GetModuleFiles()
    for (const file of resultFiles.files) {
        let plaintext = false
        if (file.path.startsWith("@babel/")) {
            continue
        }

        monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/${file.path}`)

        if (file.path.endsWith('.bundle.js') || file.path.endsWith('.js.map') || file.path.endsWith('.min.js')) {
            plaintext = true
        }
        createVirtualFile(`/node_modules/${file.path}`, file.content, undefined, false, plaintext)
    }

    if (!virtualFS.isInitWorkspace()) {
        const sandboxName = "sandbox_"+name
        virtualFS.setInitWorkspace(sandboxName)
        const sandbox = localStorage.getItem(sandboxName)
        if (sandbox) {
            virtualFS.restoreSandbox(sandbox)
            return
        }
        virtualFS.setTreeObjectItemRoot(name)
        createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, name, template)
        createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, name, template)
        createVirtualFile("/package.json", packageJsonContent(name))
        virtualFS.fs.create()
    }
}
