import path from "node:path";
import fs from "node:fs";
import {extractCssStyles} from "../../../components/editor/utils/extractCssStyles";
import {resolveCssImports} from "../../../components/editor/utils/resolveCssImports";

export function EsbuildVirtualFsPlugin(latestContent) {
    const normalizeVirtualPath = (targetPath = "", {preserveRelative = false} = {}) => {
        const normalized = String(targetPath || "")
            .replace(/^virtual:/, "")
            .replace(/\\/g, "/")
            .replace(/\/+/g, "/");

        if (!normalized) {
            return normalized;
        }

        if (preserveRelative && (normalized.startsWith("./") || normalized.startsWith("../"))) {
            return normalized;
        }

        return normalized.startsWith("/") ? normalized : `/${normalized}`;
    };

    return {
        name: "virtual-fs",
        setup(build) {
            const NATIVE_MODULES = new Set(require("module").builtinModules);

            build.onResolve({filter: /^[^.\/]/}, (args) => {
                // Handle native modules
                if (
                    NATIVE_MODULES.has(args.path)
                ) {
                    return {external: true};
                }
                if (
                    args.path.startsWith("electron") ||
                    args.path.startsWith("crypto") ||
                    args.path.startsWith("react")
                ) {
                    return {external: true}; // Let Node.js resolve them
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

                    return {path: `${moduleBase}/${entryFile}`, namespace: "virtual"};
                } else {
                    const mainNodeModules = process.env.NODE_MODULES || process.env.NODE_PATH;
                    moduleBase = path.join(mainNodeModules, args.path);
                    packageJsonPath = `${moduleBase}/package.json`;
                    if (fs.existsSync(packageJsonPath)) {
                        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                        let entryFile = packageJson.module || packageJson.main || "index.js";
                        if (!fs.existsSync(`${moduleBase}/${entryFile}`)) {
                            entryFile = "index.js"; // Fallback
                        }
                        return {path: `${moduleBase}/${entryFile}`};
                    } else {
                        return {errors: [{text: `Could not resolve module on filesystem (no package.json) at ${args.path}`}]};
                    }
                }
            });

            const resolveFile = (basePath, importerPath) => {
                let normalizedBasePath = normalizeVirtualPath(basePath, {preserveRelative: true});
                const normalizedImporterPath = normalizeVirtualPath(importerPath);

                // Normalize relative paths based on the importer
                if (normalizedBasePath.startsWith("./") || normalizedBasePath.startsWith("../")) {
                    if (normalizedImporterPath) {
                        const importerDir = path.posix.dirname(normalizedImporterPath);
                        normalizedBasePath = path.posix.join(importerDir, normalizedBasePath);
                    }
                }

                normalizedBasePath = normalizeVirtualPath(normalizedBasePath);

                // Possible file resolutions
                const possibleFiles = [
                    normalizedBasePath,
                    `${normalizedBasePath}.js`,
                    `${normalizedBasePath}.jsx`,
                    `${normalizedBasePath}.mjs`,
                    `${normalizedBasePath}.cjs`,
                    `${normalizedBasePath}.ts`,
                    `${normalizedBasePath}.tsx`,
                    `${normalizedBasePath}.mts`,
                    `${normalizedBasePath}.cts`,
                    `${normalizedBasePath}/index.js`,
                    `${normalizedBasePath}/index.jsx`,
                    `${normalizedBasePath}/index.mjs`,
                    `${normalizedBasePath}/index.cjs`,
                    `${normalizedBasePath}/index.ts`,
                    `${normalizedBasePath}/index.tsx`,
                    `${normalizedBasePath}/index.mts`,
                    `${normalizedBasePath}/index.cts`,
                ];
                return possibleFiles.find(p => latestContent[p]) || null;
            };

            build.onResolve({filter: /^(\.\/|\.\.|\/)/}, (args) => {
                const resolvedPath = resolveFile(args.path, args.importer);
                if (resolvedPath) {
                    return {path: resolvedPath, namespace: "virtual"};
                }

                // If not found in current location, try as local file
                const absoluteResolvedPath = resolveFile(`/${args.path}`, args.importer);
                if (absoluteResolvedPath) {
                    return {path: absoluteResolvedPath, namespace: "virtual"};
                }

                return {errors: [{text: `File not found: ${args.path}`}]};
            });
            build.onLoad({filter: /\.(js|cjs|mjs|jsx)$/}, async (args) => {
                return {
                    contents: latestContent[args.path],
                    loader: "js",
                };
            });
            build.onLoad({filter: /\.(ts|mts|cts|tsx)$/}, async (args) => {
                return {
                    contents: latestContent[args.path],
                    loader: "ts",
                };
            });
            build.onLoad({filter: /\.json$/}, async (args) => {
                return {
                    contents: latestContent[args.path],
                    loader: "json",
                };
            });
            build.onLoad({filter: /\.css$/}, async (args) => {
                const classMap = extractCssStyles(latestContent[args.path])
                const importsResolved = await resolveCssImports(classMap, args.path, latestContent, extractCssStyles)
                const merged = {...importsResolved, ...classMap}
                return {
                    contents: `export default ${JSON.stringify(merged)};`,
                    loader: "js",
                };
            });
            build.onLoad({filter: /\.*$/}, async (args) => {
                return {
                    contents: latestContent[args.path],
                    loader: "text",
                };
            });
        },
    }
}
