import {pluginBuildSource} from './pluginBuildArtifact';
import {createVerifiedSourcePlugin,readVerifiedSource} from '../security/verifiedSourceBundle';
import {app} from "electron";
import fs, {chmodSync, existsSync, mkdirSync, statSync} from "node:fs";
import Module from "node:module";
import path from "node:path";
import {compileCssStyleModule} from "../../esbuild/plugins/cssStyleModule";
import {pluginCompatibilityBanner} from '../../sdk/pluginCompatibility';
import {pluginCompatibilityHost} from '../../sdk/pluginCompatibilityHost';

function resolveHostNodeModulesPath() {
    return !app.isPackaged
        ? path.join(app.getAppPath(), "dist", "main", "node_modules")
        : path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "node_modules");
}

export function ensureExecutableEsbuildBinary(nodeModulesPath) {
    const esbuildBinary = path.join(nodeModulesPath, "@esbuild", `${process.platform}-${process.arch}`,
        ...(process.platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild']));

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

export function resolvePluginSourceEntrypoint(packageJsonText, verifiedFiles) {
    if (typeof packageJsonText !== "string" || !packageJsonText.trim()) {
        return null;
    }

    if (verifiedFiles) {
        // Registry publishing also accepts TypeScript main and conventional
        // entries. Resolve only from the verified inventory, never generated files.
        const inventory = Object.fromEntries(Object.keys(verifiedFiles).map(name => ['/' + name, '']));
        return pluginBuildSource({...inventory, '/package.json': packageJsonText})
            || ['src/index.ts', 'src/index.tsx'].find(name => Object.hasOwn(verifiedFiles, name)) || null;
    }
    const parsed = JSON.parse(packageJsonText);
    return typeof parsed.source === "string" && parsed.source.trim()
        ? parsed.source
        : null;
}

export function getHostPluginNodeModulesPath() {
    return resolveHostNodeModulesPath();
}

// Startup recompilation must use the same CSS style-map contract as the
// editor and plugin tests. Native esbuild CSS loading exports an empty object.
export function createRuntimeCssPlugin(pluginHome, verifiedFiles) {
    let workspace;
    const readWorkspace = async () => {
        const root = await fs.promises.realpath(pluginHome);
        const files = Object.create(null);
        const visit = async directory => {
            for (const entry of await fs.promises.readdir(directory, {withFileTypes: true})) {
                if (entry.name === "node_modules" || entry.name === ".git") continue;
                const diskPath = path.join(directory, entry.name);
                if (entry.isDirectory()) await visit(diskPath);
                else if (entry.isFile() && entry.name.endsWith(".css")) {
                    files['/' + path.relative(root, diskPath).split(path.sep).join('/')] = await fs.promises.readFile(diskPath, 'utf8');
                }
            }
        };
        if (verifiedFiles) {
            for (const name of Object.keys(verifiedFiles).filter(file=>file.endsWith('.css'))) files['/'+name]=(await readVerifiedSource(root,path.join(root,name),verifiedFiles)).toString('utf8');
        } else await visit(root);
        return {root, files};
    };
    return {name: "fdo-runtime-css", setup(build) {
        build.onLoad({filter: /\.css$/}, async ({path: diskPath}) => {
            const {root, files} = await (workspace ??= readWorkspace());
            const relative = path.relative(root, await fs.promises.realpath(diskPath));
            if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                throw new Error('Runtime CSS must stay inside the plugin workspace.');
            }
            const virtualPath = '/' + relative.split(path.sep).join('/');
            if (!Object.hasOwn(files, virtualPath)) throw new Error('Runtime CSS is not an authored workspace file.');
            return {contents: await compileCssStyleModule(files, virtualPath), loader: 'js'};
        });
    }};
}

export async function buildPluginRuntimeBundle(pluginId, pluginHome, {verifiedFiles} = {}) {
    const packageJsonPath = path.join(pluginHome, "package.json");
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    const packageContents=verifiedFiles ? (await readVerifiedSource(pluginHome,packageJsonPath,verifiedFiles)).toString('utf8') : fs.readFileSync(packageJsonPath,'utf8');
    const sourceEntrypoint = resolvePluginSourceEntrypoint(packageContents, verifiedFiles);
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
        banner: {js: pluginCompatibilityBanner(JSON.parse(packageContents).fdo?.compatibility, pluginCompatibilityHost())},
        plugins: [...(verifiedFiles ? [createVerifiedSourcePlugin(pluginHome,verifiedFiles,nodeModulesPath)] : []), createRuntimeCssPlugin(pluginHome,verifiedFiles)],
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
