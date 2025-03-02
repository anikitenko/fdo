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
            await esbuild.initialize({
                wasmURL: `/assets/esbuild-wasm/esbuild.wasm`,
            });
        }

        virtualFS.build.addProgress(20)
        virtualFS.build.addMessage("Compiler initialized...")

        const latestContent = virtualFS.getLatestContent()
        const totalFiles = Object.keys(latestContent).length
        let loadedFiles = 0

        virtualFS.build.addProgress(30)
        virtualFS.build.addMessage("Building project...")

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
                                let entryFile = packageJson.module || packageJson.main || "index.ts"
                                return { path: `${moduleBase}/${entryFile}`, namespace: "virtual" };
                            }
                            return { errors: [{ text: `Module not found: ${args.path}` }] };
                        });

                        build.onResolve({ filter: /.*/ }, args => {
                            if (args.path in latestContent) {
                                return { path: args.path, namespace: "virtual" };
                            }
                            return null;
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

        createVirtualFile("/dist/index.mjs", result.outputFiles[0].text, undefined, false, true)

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