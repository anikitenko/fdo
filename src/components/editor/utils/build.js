import * as esbuild from "esbuild-wasm";
import virtualFS from "./VirtualFS";
import {createVirtualFile} from "./createVirtualFile";
import {workspaceTsCompilerOptions} from "./setupVirtualWorkspace";

const build = async () => {
    virtualFS.build.setInProgress()
    virtualFS.build.addProgress(10)
    virtualFS.build.addMessage("Initializing compiler...")
    try {
        if (!virtualFS.build.getInit()) {
            virtualFS.build.setInit()

            const wasmURL = await window.electron.getEsbuildWasmPath();
            if (!wasmURL) {
                console.error("Failed to get esbuild.wasm path.");
                virtualFS.build.addMessage("Failed to get esbuild.wasm path.",  true)
                setTimeout(() => virtualFS.build.stopProgress(), 500)
            }

            await esbuild.initialize({
                wasmURL
            });
        }

        virtualFS.build.addProgress(20)
        virtualFS.build.addMessage("Compiler initialized...")

        const latestContent = virtualFS.getLatestContent()
        const totalFiles = Object.keys(latestContent).length
        let loadedFiles = 0

        let pluginEntrypoint;
        let pluginMetadata = null

        virtualFS.build.addProgress(30)
        virtualFS.build.addMessage("Building plugin...")

        const result = await esbuild.build({
            entryPoints: ["/index.ts"],
            bundle: true,
            format: "esm",
            minify: true,
            treeShaking: true,
            platform: "node",
            sourcesContent: false,
            jsx: "automatic",
            tsconfigRaw: {
                compilerOptions: {
                    target: "ES2016",
                    module: "ES2015",
                    moduleResolution: "node",
                    jsxFragmentFactory: "React.Fragment",
                    ...workspaceTsCompilerOptions
                },
            },
            plugins: [
                {
                    name: "virtual-fs",
                    setup(build) {
                        build.onResolve({ filter: /^[^.\/]/ }, (args) => {
                            // If path does not start with "." or "/", assume it's a node module
                            const moduleBase = `/node_modules/${args.path}`
                            const packageJsonPath = `${moduleBase}/package.json`
                            if (latestContent[packageJsonPath]) {
                                const packageJson = JSON.parse(latestContent[packageJsonPath])
                                const entryFile = packageJson.module || packageJson.main || "index.ts"
                                return { path: `${moduleBase}/${entryFile}`, namespace: "virtual" };
                            }
                            return { errors: [{ text: `Module not found: ${args.path}` }] };
                        });

                        build.onResolve({ filter: /.*/ }, args => {
                            if (args.path in latestContent) {
                                return { path: args.path, namespace: "virtual" };
                            }
                            return { errors: [{ text: `File not found: ${args.path}` }] };
                        });

                        build.onLoad({ filter: /.*/, namespace: "virtual" }, async (args) => {
                            loadedFiles++;
                            virtualFS.build.addProgress(30 + Math.floor((loadedFiles / totalFiles) * 50))
                            virtualFS.build.addMessage(`Compiling ${args.path} (${loadedFiles}/${totalFiles})...`)

                            return {
                                contents: latestContent[args.path],
                                loader: "ts", // Adjust based on file type
                            };
                        });
                    },
                },
            ],
        });
        virtualFS.build.addProgress(90)
        virtualFS.build.addMessage("Build complete, writing output...")

        const metadataMatch = result.outputFiles[0].text.match(/_metadata\s*=\s*({[\s\S]*?});/);
        if (metadataMatch) {
            try {
                const rawExtracted = metadataMatch[1].replace(/(\w+):/g, '"$1":');
                const rawExtractedMatch = rawExtracted.match(/{\s*"name":\s*".*?",\s*"version":\s*".*?",\s*"author":\s*".*?",\s*"description":\s*".*?",\s*"icon":\s*".*?"\s*}/s);
                if (rawExtractedMatch) {
                    pluginMetadata = JSON.parse(rawExtractedMatch[0])
                } else {
                    console.error("Failed to parse metadata: no match found");
                    virtualFS.build.addMessage("Failed to parse metadata: no match found", true)
                    setTimeout(() => virtualFS.build.stopProgress(), 500)
                }
            } catch (err) {
                console.error("Failed to parse metadata:", err);
                virtualFS.build.addMessage("Failed to parse metadata: " + err.toString(),  true)
                setTimeout(() => virtualFS.build.stopProgress(), 500)
            }
        }

        const srcJson = JSON.parse(latestContent["/package.json"])
        pluginEntrypoint = srcJson.module || srcJson.main || "dist/index.mjs"
        createVirtualFile(pluginEntrypoint, result.outputFiles[0].text, undefined, false, true)

        virtualFS.build.setEntrypoint(pluginEntrypoint)
        virtualFS.build.setMetadata(pluginMetadata)
        virtualFS.build.setContent(result.outputFiles[0].text)

        virtualFS.build.addProgress(100)
        virtualFS.build.addMessage("Compilation successful!")
    } catch (error) {
        virtualFS.build.addMessage("Compilation failed: " + error.message,  true)
        console.error("Compilation failed:", error);
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
}

export default build;