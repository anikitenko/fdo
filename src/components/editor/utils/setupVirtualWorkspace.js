import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {buildWorkspaceMonacoCompilerOptions} from "./workspaceMonacoCompilerOptions";
import darkTheme from "../monaco/EditorDarkTheme"
import {AppToaster} from "../../AppToaster.jsx";

export async function setupVirtualWorkspace(name, displayName, template, dir) {
    monaco.editor.defineTheme('editor-dark', darkTheme);

    monaco.typescript.typescriptDefaults.setCompilerOptions(
        buildWorkspaceMonacoCompilerOptions(monaco.typescript)
    )
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false
    })
    monaco.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
    })
    monaco.typescript.javascriptDefaults.setEagerModelSync(true);
    if (!virtualFS.isInitWorkspace()) {
        const sandboxName = "sandbox_" + name
        const normalizedDir = String(dir || "");
        const dirSegments = normalizedDir.split(/[\\/]/).filter(Boolean);
        const dirBaseName = dirSegments[dirSegments.length - 1] || normalizedDir;
        const isSandboxWorkspace = normalizedDir === "sandbox" || dirBaseName === sandboxName;
        virtualFS.setInitWorkspace(name, sandboxName)
        const sandbox = localStorage.getItem(sandboxName)
        if (sandbox) {
            virtualFS.restoreSandbox(sandbox)
            await virtualFS.fs.setupNodeModules()
        } else if (isSandboxWorkspace) {
            createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, name, template)
            createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, name, template)
            createVirtualFile("/package.json", packageJsonContent(name))
            await virtualFS.fs.setupNodeModules()
        } else {
            const data = await window.electron.plugin.getData(dir)
            if (data.success) {
                for (const file of data.content) {
                    createVirtualFile(file.path, file.content)
                }
                await virtualFS.fs.setupNodeModules()
            } else {
                (AppToaster).show({message: `${data.error}`, intent: "danger"});
            }
        }
    }
}
