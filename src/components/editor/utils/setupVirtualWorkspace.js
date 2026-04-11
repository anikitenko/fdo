import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {buildWorkspaceMonacoCompilerOptions} from "./workspaceMonacoCompilerOptions";
import darkTheme from "../monaco/EditorDarkTheme"

async function scaffoldFreshWorkspace(name, template) {
    createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, name, template)
    createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, name, template)
    createVirtualFile("/package.json", packageJsonContent(name))
    await virtualFS.fs.setupNodeModules()
}

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
            await scaffoldFreshWorkspace(name, template)
        } else {
            const data = await window.electron.plugin.getData(dir).catch((error) => ({
                success: false,
                error: error?.message || String(error || "Failed to load plugin workspace"),
            }))
            const files = Array.isArray(data?.content)
                ? data.content.filter((file) =>
                    typeof file?.path === "string" && file.path.startsWith("/")
                )
                : [];

            if (data?.success && files.length > 0) {
                for (const file of files) {
                    createVirtualFile(file.path, file.content || "")
                }
                await virtualFS.fs.setupNodeModules()
            } else {
                await scaffoldFreshWorkspace(name, template)
            }
        }
    }
}
