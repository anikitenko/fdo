import {app, dialog, ipcMain} from "electron";
import ValidatePlugin from "./components/plugin/ValidatePlugin";
import {readFileSync, writeFileSync} from "node:fs";
import PluginORM from "./utils/PluginORM";
import path from "node:path";
import UserORM from "./utils/UserORM";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "./main";
import {getFilesTree} from "./utils/getFilesTree";
import PluginManager from "./utils/PluginManager";
import ensureAndWrite from "./utils/ensureAndWrite";
import generatePluginName from "./components/editor/utils/generatePluginName";
import {workspaceTsCompilerOptions} from "./utils/workspaceTsCompilerOptions";
import * as fs from "node:fs";

ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Select a file',
        buttonLabel: 'Upload',
        properties: ['openFile'],
        filters: [{name: 'FDO Modules (ES)', extensions: ['mjs']},]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0]; // Return the selected file path
    }
    return null; // Return null if no file was selected
});

ipcMain.handle('get-plugin-data', async (event, filePath) => {
    try {
        const plugin = ValidatePlugin(filePath);
        if (!plugin) {
            return {success: false, error: "Problem with validating plugin"};
        }
        const data = readFileSync(filePath, 'utf8');
        return {success: true, content: data, metadata: plugin.metadata};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('save-plugin', async (event, content) => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    try {
        const pluginName = generatePluginName(content.name)
        const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.mjs`);
        if (!pluginORM.isInstalled(pluginName)) {
            writeFileSync(pluginPath, content.data);
            const plugin = ValidatePlugin(pluginPath);
            /*if (!plugin) {
                unlink(pluginPath, (err) => {
                    return { success: false, error: err };
                })
            }
            pluginORM.addPlugin(pluginName, plugin.metadata, pluginPath);
            return { success: true, pluginID: pluginName, metadata: plugin.metadata }*/
        } else {
            return {success: false, error: "Plugin already installed!"};
        }
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('get-all-plugins', async () => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    try {
        const plugins = pluginORM.getAllPlugins();
        return {success: true, plugins: plugins};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('get-plugin', async (event, id) => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    try {
        const plugin = pluginORM.getPlugin(id);
        return {success: true, plugin: plugin};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('activate-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.loadPlugin(id)
        userORM.activatePlugin(id)
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('deactivate-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.unLoadPlugin(id)
        userORM.deactivatePlugin(id)
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('deactivate-user-plugin', async (event, id) => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    userORM.deactivatePlugin(id)
    return {success: true};
});

ipcMain.handle('get-activated-plugins', async () => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        const plugins = userORM.getActivatedPlugins()
        return {success: true, plugins: plugins};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('deactivate-all-plugins', async () => {
    const userORM = new UserORM(USER_CONFIG_FILE);
    try {
        PluginManager.unLoadPlugins()
        userORM.deactivateAllPlugins()
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
})

ipcMain.handle('get-module-files', async () => {
    try {
        const filesTree = getFilesTree(path.join(app.getAppPath(), '.webpack/renderer', 'assets'), 'node_modules')
        return {success: true, files: filesTree};
    } catch (error) {
        return {success: false, error: error.message};
    }
})

ipcMain.handle('get-babel-path', async () => {
    try {
        const babel = path.join(app.getAppPath(), '.webpack/renderer', 'assets', 'node_modules', '@babel', 'standalone')
        return {success: true, babel};
    } catch (error) {
        return {success: false, error: error.message};
    }
})

ipcMain.handle('build', async (event, data) => {
    try {
        let esbuildBinary;
        if (process.env.NODE_ENV === "development") {
            // In development, use the normal esbuild path
            const paths = [
                app.getAppPath(),
                ".webpack",
                "main",
                "node_modules",
                "@esbuild",
                process.platform + "-" + process.arch,
                "bin",
                "esbuild"
            ]
            esbuildBinary = path.join(...paths);
        } else {
            // In production, point to the unpacked binary
            const paths = [
                process.resourcesPath,
                "app.asar.unpacked",
                ".webpack",
                "main",
                "node_modules",
                "@esbuild",
                process.platform + "-" + process.arch,
                "bin",
                "esbuild"
            ]
            esbuildBinary = path.join(...paths);
        }
        // Set permissions
        fs.chmodSync(esbuildBinary, 0o755)

        // Ensure esbuild uses the correct binary
        process.env.ESBUILD_BINARY_PATH = esbuildBinary;
        const latestContent = data.latestContent
        const esbuild = require("esbuild")
        const result = await esbuild.build({
            entryPoints: ["/index.ts"],
            bundle: true,
            format: "esm",
            minify: false,
            treeShaking: false,
            platform: "node",
            sourcesContent: false,
            jsx: "automatic",
            keepNames: true,
            write: false,
            tsconfigRaw: {
                compilerOptions: {
                    target: "ESNext",
                    moduleResolution: "node",
                    ...workspaceTsCompilerOptions
                },
            },
            plugins: [
                {
                    name: "virtual-fs",
                    setup(build) {
                        const NATIVE_MODULES = new Set(require("module").builtinModules);

                        build.onResolve({ filter: /^[^.\/]/ }, (args) => {
                            // Handle native modules
                            if (
                                NATIVE_MODULES.has(args.path)
                            ) {
                                return { external: true };
                            }
                            if (
                                args.path.startsWith("electron") ||
                                args.path.startsWith("crypto")
                            ) {
                                return { external: true }; // Let Node.js resolve them
                            }

                            // Check if it's a node module
                            let moduleBase = `/node_modules/${args.path}`;
                            let packageJsonPath = `${moduleBase}/package.json`;

                            if (latestContent[packageJsonPath]) {
                                const packageJson = JSON.parse(latestContent[packageJsonPath]);
                                let entryFile = packageJson.module || packageJson.main || "index.js";

                                // Ensure the resolved file exists
                                if (!latestContent[`${moduleBase}/${entryFile}`]) {
                                    entryFile = "index.js"; // Fallback
                                }

                                return { path: `${moduleBase}/${entryFile}`, namespace: "virtual" };
                            } else {
                                const mainNodeModules = path.join(__dirname, "node_modules");
                                moduleBase = path.join(mainNodeModules, args.path);
                                packageJsonPath = `${moduleBase}/package.json`;
                                if (fs.existsSync(packageJsonPath)) {
                                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                                    let entryFile = packageJson.module || packageJson.main || "index.js";
                                    if (!fs.existsSync(`${moduleBase}/${entryFile}`)) {
                                        entryFile = "index.js"; // Fallback
                                    }
                                    return { path: `${moduleBase}/${entryFile}`};
                                } else {
                                    return { errors: [{ text: `Could not resolve module on filesystem (no package.json) at ${args.path}` }] };
                                }
                            }
                        });

                        const resolveFile = (basePath, importerPath) => {
                            // Normalize relative paths based on the importer
                            if (basePath.startsWith("./") || basePath.startsWith("../")) {
                                if (importerPath) {
                                    const importerDir = path.dirname(importerPath);
                                    basePath = path.join(importerDir, basePath);
                                }
                            }

                            // Possible file resolutions
                            const possibleFiles = [
                                basePath,
                                `${basePath}.js`,
                                `${basePath}.jsx`,
                                `${basePath}.mjs`,
                                `${basePath}.cjs`,
                                `${basePath}.ts`,
                                `${basePath}.tsx`,
                                `${basePath}.mts`,
                                `${basePath}.cts`,
                                `${basePath}/index.js`,
                                `${basePath}/index.jsx`,
                                `${basePath}/index.mjs`,
                                `${basePath}/index.cjs`,
                                `${basePath}/index.ts`,
                                `${basePath}/index.tsx`,
                                `${basePath}/index.mts`,
                                `${basePath}/index.cts`,
                            ];
                            return possibleFiles.find(p => latestContent[p]) || null;
                        };

                        build.onResolve({ filter: /^(\.\/|\.\.|\/)/ }, (args) => {
                            const resolvedPath = resolveFile(args.path, args.importer);
                            if (resolvedPath) {
                                return { path: resolvedPath, namespace: "virtual" };
                            }

                            // If not found in current location, try as local file
                            const absoluteResolvedPath = resolveFile(`/${args.path}`, args.importer);
                            if (absoluteResolvedPath) {
                                return { path: absoluteResolvedPath, namespace: "virtual" };
                            }

                            return { errors: [{ text: `File not found: ${args.path}` }] };
                        });
                        build.onLoad({ filter: /\.(js|cjs|mjs|jsx)$/ }, async (args) => {
                            return {
                                contents: latestContent[args.path],
                                loader: "js",
                            };
                        });
                        build.onLoad({ filter: /\.(ts|mts|cts|tsx)$/ }, async (args) => {
                            return {
                                contents: latestContent[args.path],
                                loader: "ts",
                            };
                        });
                        build.onLoad({ filter: /\.json$/ }, async (args) => {
                            return {
                                contents: latestContent[args.path],
                                loader: "json",
                            };
                        });
                        build.onLoad({ filter: /\.css$/ }, async (args) => {
                            return {
                                contents: latestContent[args.path],
                                loader: "css",
                            };
                        });
                        build.onLoad({ filter: /\.*$/ }, async (args) => {
                            return {
                                contents: latestContent[args.path],
                                loader: "text",
                            };
                        });
                    },
                },
            ],
        });

        return {success: true, files: result}

    } catch (error) {
        console.log(error)
        return {success: false, error: "Build error: "+error.toString()};
    }
});

ipcMain.handle('deploy-to-main-from-editor', async (event, data) => {
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    const pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
    const pathToPlugin = path.join(pathToDir, data.entrypoint)
    const metadata = data.metadata
    metadata.icon = metadata.icon.toLowerCase()

    await ensureAndWrite(pathToPlugin, data.content)
    pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true)

    const mainWindow = PluginManager.mainWindow
    if (mainWindow) {
        mainWindow.focus()
    }
    mainWindow.webContents.send("deploy-from-editor", data.name);
})

ipcMain.handle('plugin-init', async (event, id) => {
    const plugin = PluginManager.getLoadedPlugin(id)
    if (plugin.ready) {
        plugin.instance.postMessage({message: 'PLUGIN_INIT'})
        plugin.instance.once('message', (message) => {
            if (message.type === 'PLUGIN_INIT') {
                const mainWindow = PluginManager.mainWindow
                mainWindow.webContents.send("on-plugin-init", message.response)
            }
        });
    }
})

ipcMain.handle('plugin-render', async (event, id) => {
    const plugin = PluginManager.getLoadedPlugin(id)
    if (plugin.ready) {
        plugin.instance.postMessage({message: 'PLUGIN_RENDER'})
        plugin.instance.once('message', (message) => {
            if (message.type === 'PLUGIN_RENDER') {
                const mainWindow = PluginManager.mainWindow
                mainWindow.webContents.send("on-plugin-render", message.response)
            }
        });
    }
})
