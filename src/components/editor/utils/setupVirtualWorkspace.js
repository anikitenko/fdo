import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent, packageLockContent} from "./packageJsonContent";
import {packageDefaultContent} from "./packageDefaultContent";
import * as monaco from "monaco-editor";

export async function setupVirtualWorkspace(name, template) {
    const defaultFile = createVirtualFile("/index.ts", name, template)
    const defaultNewFile = createVirtualFile("/__default_new_file__.txt", packageDefaultContent(name))
    const sampleFileContent = packageDefaultContent(name)
    const models =[
        createVirtualFile("/package.json", packageJsonContent(name)),
        createVirtualFile("/package-lock.json", packageLockContent(name)),
    ]

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2016,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ES2015,
        typeRoots: ["/node_modules"]
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
    })
    const resultFiles = await window.electron.GetModuleFiles()
    for (const idx in resultFiles.files) {
        const dts = await fetch(`/node_modules/${resultFiles.files[idx]}`).then(res => res.text())
        monaco.languages.typescript.typescriptDefaults.addExtraLib(dts, `/node_modules/${resultFiles.files[idx]}`);
        const model = createVirtualFile(`/node_modules/${resultFiles.files[idx]}`, dts);
        models.push({
            filePath: model.filePath,
            model: model.model
        })
    }
    return {sampleFileContent:sampleFileContent, defaultNewFile, defaultFile, models}
}
