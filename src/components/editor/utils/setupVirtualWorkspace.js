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
        typeRoots: ["/node_modules"],
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
    });
    virtualFS.setTreeObjectItemRoot(name)
    if (!virtualFS.getModel(virtualFS.DEFAULT_FILE)) {
        createVirtualFile(virtualFS.DEFAULT_FILE, name, template)
        createVirtualFile("/package.json", packageJsonContent(name))
        createVirtualFile("/package-lock.json", packageLockContent(name))
        const resultFiles = await window.electron.GetModuleFiles()
        for (const idx in resultFiles.files) {
            const dts = await fetch(`/node_modules/${resultFiles.files[idx]}`).then(res => res.text())
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dts, `/node_modules/${resultFiles.files[idx]}`);
            createVirtualFile(`/node_modules/${resultFiles.files[idx]}`, dts)
        }
    }
}
