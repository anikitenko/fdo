import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {workspaceTsCompilerOptions} from "../../../utils/workspaceTsCompilerOptions";

export async function setupVirtualWorkspace(name, template) {
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
        jsx: monaco.languages.typescript.JsxEmit.React,
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
    const resultFiles = await window.electron.GetModuleFiles()
    for (const file of resultFiles.files) {
        let plaintext = false
        if (file.path.endsWith('fdo-sdk.bundle.js') || file.path.endsWith('fdo-sdk.bundle.js.map')) {
            plaintext = true
        }
        monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/${file.path}`)
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
        createVirtualFile(virtualFS.DEFAULT_FILE, name, template)
        createVirtualFile("/package.json", packageJsonContent(name))
        virtualFS.fs.create()
    }
}
