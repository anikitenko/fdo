import {app} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import {ensureExecutableEsbuildBinary, getHostPluginNodeModulesPath, loadHostEsbuild} from "./pluginRuntimeBundle";
import {compileCssStyleModule} from '../../esbuild/plugins/cssStyleModule';

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

async function transpilePluginTests(workspaceDir, compiledDir, testFiles, latestContent) {
    // esbuild canonicalizes /var -> /private/var on macOS before onLoad.
    workspaceDir = await fs.realpath(workspaceDir);
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
        // Workspace package.json files may declare ESM, including in nested
        // directories. The bundle extension must match its actual format.
        outExtension: {".js": ".cjs"},
        write: true,
        sourcemap: "inline",
        target: "es2022",
        external: ["@anikitenko/fdo-sdk"],
        plugins: [{name: 'fdo-test-css', setup(build) {
            build.onLoad({filter: /\.css$/}, async ({path: diskPath}) => {
                const virtualPath = '/' + path.relative(workspaceDir, diskPath).split(path.sep).join('/');
                if (!Object.hasOwn(latestContent, virtualPath)) throw new Error(`CSS file is outside the plugin workspace: ${virtualPath}`);
                return {contents: await compileCssStyleModule(latestContent, virtualPath), loader: 'js'};
            });
        }}],
        define: {
            "import.meta.url": "__fdoImportMetaUrl",
        },
        banner: {
            js: 'const __fdoImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
        },
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
            return path.join(compiledDir, filePath.replace(/^\/+/, "").replace(/\.[cm]?[jt]sx?$/, ".cjs"));
        }),
        nodeModulesPath,
    };
}

async function copyWorkspaceRuntimeFiles(workspaceDir, compiledDir, files, testFiles, compiledTestFiles) {
    const bundlePaths = new Set(compiledTestFiles);
    const testFileSet = new Set(testFiles.map((filePath) => filePath.replace(/^\/+/, "")));
    await Promise.all(files
        .filter((file) => !testFileSet.has(file.path.replace(/^\/+/, "")))
        .map(async (file) => {
            const sourcePath = toWorkspacePath(workspaceDir, file.path);
            const compiledPath = toWorkspacePath(compiledDir, file.path);
            // A source asset must never overwrite an emitted test bundle.
            if (bundlePaths.has(compiledPath)) return;
            await fs.mkdir(path.dirname(compiledPath), {recursive: true});
            await fs.copyFile(sourcePath, compiledPath);
        }));
}

function formatSpawnError(error) {
    if (!error) {
        return "Unknown test runner failure";
    }
    return error.message || String(error);
}

async function executeNodeTestFiles(compiledDir, compiledTestFiles, nodeModulesPath) {
    const reporter = path.join(path.dirname(compiledDir), 'fdo-results.cjs');
    const resultsPath = path.join(path.dirname(compiledDir), 'fdo-results.jsonl');
    await fs.writeFile(reporter, `module.exports = async function* (events) {
        for await (const event of events) if (event.type === 'test:pass' || event.type === 'test:fail') {
            const {name, file, skip, todo} = event.data;
            yield JSON.stringify({name, file, passed: event.type === 'test:pass', skipped: !!skip, todo: !!todo}) + "\\n";
        }
    };`);
    return await new Promise((resolve) => {
        const child = spawn(
            process.execPath,
            ["--enable-source-maps", "--test", "--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${pathToFileURL(reporter).href}`, `--test-reporter-destination=${resultsPath}`, ...compiledTestFiles],
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

        child.on("close", async (code) => {
            const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
            let results = [];
            try { results = (await fs.readFile(resultsPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
            catch { /* Missing structured evidence cannot satisfy acceptance criteria. */ }
            resolve({
                results,
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
        const {compiledTestFiles, nodeModulesPath} = await transpilePluginTests(workspaceDir, compiledDir, testFiles, Object.fromEntries(files.map(file => [file.path, file.content])));
        await copyWorkspaceRuntimeFiles(workspaceDir, compiledDir, files, testFiles, compiledTestFiles);
        const result = await executeNodeTestFiles(compiledDir, compiledTestFiles, nodeModulesPath);
        return {
            ...result,
            results: (result.results || []).map(item => ({...item, file: (() => {
                const compiledIndex = compiledTestFiles.indexOf(item.file);
                if (compiledIndex >= 0) return testFiles[compiledIndex];
                // Node source-map paths on macOS can duplicate /private when
                // resolving the /var alias. Compare normalized absolute roots.
                const normalize = value => value?.replace(/^(?:\/private)+\//, '/');
                const sourceFile = normalize(item.file);
                const sourceRoot = normalize(workspaceDir);
                return sourceFile?.startsWith(sourceRoot + path.sep) ? '/' + path.relative(sourceRoot, sourceFile).split(path.sep).join('/') : item.file;
            })()})),
            skipped: false,
            testFiles,
        };
    } finally {
        await fs.rm(tempRoot, {recursive: true, force: true});
    }
}
