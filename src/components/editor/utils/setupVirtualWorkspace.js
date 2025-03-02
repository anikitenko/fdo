import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent, packageLockContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";

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
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        emitDecoratorMetadata: true,
        isolatedModules: true,
        experimentalDecorators: true,
        allowSyntheticDefaultImports: true,
        strictNullChecks: true,
        suppressImplicitAnyIndexErrors: true,
        noImplicitThis: true,
        strict: true,
        jsx: monaco.languages.typescript.JsxEmit.React,
        jsxFactory: "React.createElement",
        allowJs: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        baseUrl: "/",
    })
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
    })
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
    })
    const resultFiles = await window.electron.GetModuleFiles()
    for (const file of resultFiles.files) {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/${file.path}`)
        createVirtualFile(`/node_modules/${file.path}`, file.content)
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
        createVirtualFile("/package-lock.json", packageLockContent(name))
        virtualFS.fs.create()
    }
}
