import {app} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {ensureExecutableEsbuildBinary, getHostPluginNodeModulesPath, loadHostEsbuild} from "./pluginRuntimeBundle";

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

export function formatNoPluginTestsMessage() {
    return "No plugin tests found. Add node:test files like /index.test.ts, /src/foo.spec.ts, or /__tests__/bar.test.ts to run tests before build.";
}

export function isPluginTestFile(filePath) {
    if (typeof filePath !== "string") {
        return false;
    }

    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.includes("/node_modules/") || normalized.startsWith("/node_modules/")) {
        return false;
    }
    if (normalized.includes("/dist/") || normalized.startsWith("/dist/")) {
        return false;
    }

    return (
        /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/.test(normalized) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    );
}

export function collectPluginWorkspaceFiles(latestContent = {}) {
    return Object.entries(latestContent)
        .filter(([filePath]) => {
            if (typeof filePath !== "string" || !filePath.startsWith("/")) {
                return false;
            }
            return !filePath.startsWith("/node_modules/") && !filePath.startsWith("/dist/");
        })
        .map(([filePath, content]) => ({
            path: filePath,
            content: typeof content === "string" ? content : String(content ?? ""),
        }));
}

function toWorkspacePath(rootDir, virtualPath) {
    return path.join(rootDir, virtualPath.replace(/^\/+/, ""));
}

async function materializeWorkspace(rootDir, files) {
    for (const file of files) {
        const diskPath = toWorkspacePath(rootDir, file.path);
        await fs.mkdir(path.dirname(diskPath), {recursive: true});
        await fs.writeFile(diskPath, file.content, "utf8");
    }
}

async function transpilePluginTests(workspaceDir, compiledDir, testFiles) {
    const nodeModulesPath = getHostPluginNodeModulesPath();
    ensureExecutableEsbuildBinary(nodeModulesPath);
    const esbuild = loadHostEsbuild(nodeModulesPath);

    await esbuild.build({
        entryPoints: testFiles.map((filePath) => toWorkspacePath(workspaceDir, filePath)),
        absWorkingDir: workspaceDir,
        outdir: compiledDir,
        outbase: workspaceDir,
        bundle: true,
        platform: "node",
        format: "cjs",
        write: true,
        sourcemap: "inline",
        target: "es2022",
        external: ["@anikitenko/fdo-sdk"],
        logLevel: "silent",
        tsconfigRaw: {
            compilerOptions: {
                target: "ES2022",
                module: "CommonJS",
                jsx: "react-jsx",
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                useDefineForClassFields: false,
                strict: true,
            }
        }
    });

    return {
        compiledTestFiles: testFiles.map((filePath) => {
            const ext = path.extname(filePath);
            const outExt = CODE_EXTENSIONS.has(ext) ? ".js" : ext;
            return path.join(compiledDir, filePath.replace(/^\/+/, "").replace(new RegExp(`${ext}$`), outExt));
        }),
        nodeModulesPath,
    };
}

function formatSpawnError(error) {
    if (!error) {
        return "Unknown test runner failure";
    }
    return error.message || String(error);
}

async function executeNodeTestFiles(compiledDir, compiledTestFiles, nodeModulesPath) {
    return await new Promise((resolve) => {
        const child = spawn(
            process.execPath,
            ["--test", ...compiledTestFiles],
            {
                cwd: compiledDir,
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: "1",
                    NODE_PATH: nodeModulesPath,
                },
                stdio: ["ignore", "pipe", "pipe"],
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            resolve({
                success: false,
                output: stderr || stdout,
                error: formatSpawnError(error),
            });
        });

        child.on("close", (code) => {
            const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
            resolve({
                success: code === 0,
                output,
                error: code === 0 ? null : `Plugin tests failed with exit code ${code}.`,
            });
        });
    });
}

export async function runPluginWorkspaceTests(latestContent = {}) {
    const files = collectPluginWorkspaceFiles(latestContent);
    const testFiles = files.map((file) => file.path).filter(isPluginTestFile);

    if (testFiles.length === 0) {
        return {
            success: true,
            testFiles: [],
            output: formatNoPluginTestsMessage(),
            skipped: true,
        };
    }

    const tempRoot = await fs.mkdtemp(path.join(app.getPath("temp") || os.tmpdir(), "fdo-plugin-tests-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    const compiledDir = path.join(tempRoot, "compiled");

    try {
        await materializeWorkspace(workspaceDir, files);
        const {compiledTestFiles, nodeModulesPath} = await transpilePluginTests(workspaceDir, compiledDir, testFiles);
        const result = await executeNodeTestFiles(compiledDir, compiledTestFiles, nodeModulesPath);
        return {
            ...result,
            skipped: false,
            testFiles,
        };
    } finally {
        await fs.rm(tempRoot, {recursive: true, force: true});
    }
}
