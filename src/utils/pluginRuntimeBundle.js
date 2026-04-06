import {app} from "electron";
import fs, {chmodSync, existsSync, mkdirSync, statSync} from "node:fs";
import Module from "node:module";
import path from "node:path";

function resolveHostNodeModulesPath() {
    return !app.isPackaged
        ? path.join(app.getAppPath(), "dist", "main", "node_modules")
        : path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "node_modules");
}

export function ensureExecutableEsbuildBinary(nodeModulesPath) {
    const esbuildBinary = path.join(nodeModulesPath, "@esbuild", `${process.platform}-${process.arch}`, "bin", "esbuild");

    try {
        if (existsSync(esbuildBinary)) {
            const mode = statSync(esbuildBinary).mode & 0o777;
            if ((mode & 0o111) !== 0o111) {
                chmodSync(esbuildBinary, 0o755);
            }
        }
    } catch {
        // Best-effort only. Packaged builds should already have correct permissions.
    }

    process.env.ESBUILD_BINARY_PATH = esbuildBinary;
}

export function loadHostEsbuild(nodeModulesPath) {
    const esbuildMainPath = path.join(nodeModulesPath, "esbuild", "lib", "main.js");
    return Module._load(esbuildMainPath, module, false);
}

export function resolvePluginSourceEntrypoint(packageJsonText) {
    if (typeof packageJsonText !== "string" || !packageJsonText.trim()) {
        return null;
    }

    const parsed = JSON.parse(packageJsonText);
    return typeof parsed.source === "string" && parsed.source.trim()
        ? parsed.source
        : null;
}

export function getHostPluginNodeModulesPath() {
    return resolveHostNodeModulesPath();
}

export async function buildPluginRuntimeBundle(pluginId, pluginHome) {
    const packageJsonPath = path.join(pluginHome, "package.json");
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    const sourceEntrypoint = resolvePluginSourceEntrypoint(fs.readFileSync(packageJsonPath, "utf8"));
    if (!sourceEntrypoint) {
        return null;
    }

    const sourceEntryPath = path.join(pluginHome, sourceEntrypoint);
    if (!existsSync(sourceEntryPath)) {
        return null;
    }

    const nodeModulesPath = resolveHostNodeModulesPath();
    ensureExecutableEsbuildBinary(nodeModulesPath);
    process.env.NODE_PATH = nodeModulesPath;

    const esbuild = loadHostEsbuild(nodeModulesPath);
    const outputDir = path.join(app.getPath("userData"), "plugin-runtime-cache", pluginId);
    mkdirSync(outputDir, { recursive: true });
    const outfile = path.join(outputDir, "index.cjs");

    await esbuild.build({
        entryPoints: [sourceEntryPath],
        bundle: true,
        format: "cjs",
        platform: "node",
        outfile,
        external: ["@anikitenko/fdo-sdk"],
        absWorkingDir: pluginHome,
        tsconfigRaw: {
            compilerOptions: {
                target: "ES2022",
                module: "CommonJS",
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                useDefineForClassFields: false,
                strict: true,
            },
        },
    });

    return {
        entry: outfile,
        nodeModulesPath,
    };
}
