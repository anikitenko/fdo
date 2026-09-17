import {createVirtualFile} from "./createVirtualFile";
import {packageJsonContent} from "./packageJsonContent";
import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import {buildWorkspaceMonacoCompilerOptions} from "./workspaceMonacoCompilerOptions";
import darkTheme from "../monaco/EditorDarkTheme"

const SUPPORTED_TEMPLATES = new Set(["blank", "horDivided", "verDivided"]);

function resolveWorkspaceTemplate(template) {
    const normalized = String(template || "").trim();
    if (!normalized) {
        return "blank";
    }
    return SUPPORTED_TEMPLATES.has(normalized) ? normalized : "blank";
}

async function scaffoldFreshWorkspace(name, displayName, template) {
    const resolvedTemplate = resolveWorkspaceTemplate(template);
    const templateDisplayName = String(displayName || name || "").trim() || name;
    createVirtualFile(virtualFS.DEFAULT_FILE_MAIN, templateDisplayName, resolvedTemplate)
    createVirtualFile(virtualFS.DEFAULT_FILE_RENDER, templateDisplayName, resolvedTemplate)
    createVirtualFile("/package.json", packageJsonContent(name))
    await virtualFS.fs.setupNodeModules()
}

export async function setupVirtualWorkspace(name, displayName, template, dir) {
    monaco.editor.defineTheme('editor-dark', darkTheme);

    const monacoTs = monaco?.typescript || monaco?.default?.typescript;
    const tsDefaults = monacoTs?.typescriptDefaults;
    const jsDefaults = monacoTs?.javascriptDefaults;
    if (tsDefaults && jsDefaults) {
        tsDefaults.setCompilerOptions(
            buildWorkspaceMonacoCompilerOptions(monacoTs)
        )
        tsDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            noSuggestionDiagnostics: false
        })
        tsDefaults.setEagerModelSync(true);
        jsDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: true,
            noSuggestionDiagnostics: true
        })
        jsDefaults.setEagerModelSync(true);
    } else {
        console.warn("[Editor] Monaco TypeScript defaults are unavailable; continuing with reduced IntelliSense.");
    }
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
            await scaffoldFreshWorkspace(name, displayName, template)
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
                await scaffoldFreshWorkspace(name, displayName, template)
            }
        }
    }
}
