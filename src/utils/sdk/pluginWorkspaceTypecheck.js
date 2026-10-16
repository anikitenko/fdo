import Module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {getHostPluginNodeModulesPath} from '../plugins/runtime/pluginRuntimeBundle';
import {sanitizeVirtualWorkspacePath} from '../../components/editor/utils/aiCodingAgentWorkspacePath';
import {workspaceTsCompilerOptions} from '../plugins/validation/workspaceTsCompilerOptions';
import {PLUGIN_CSS_TYPES, PLUGIN_UI_TYPES} from './pluginCssTypes';
import {loadTypeScriptRuntime} from './typeScriptRuntime';

// All candidate sources stay in memory. Do not load candidate tsconfig plugins,
// execute workspace code, or modify live editor models to obtain diagnostics.
export function typecheckPluginWorkspace(latestContent, nodeModules = getHostPluginNodeModulesPath()) {
    const requireRuntime = Module.createRequire(path.join(nodeModules, 'fdo-typecheck.cjs'));
    const {API, DiagnosticCategory, createVirtualFileSystem, nativeBinary} = loadTypeScriptRuntime(requireRuntime);
    const normalize = name => path.resolve(name).replace(/\\/g, '/');
    const root = normalize(path.join(nodeModules, '..', '.fdo-typecheck-candidate'));
    const sources = new Map();
    for (const [name, content] of Object.entries(latestContent || {})) {
        if (sanitizeVirtualWorkspacePath(name) !== name || name.startsWith('/node_modules/') || name.startsWith('/dist/')) continue;
        if (typeof content === 'string') sources.set(root + name, content);
    }
    const sdkTypes = normalize(path.join(nodeModules, '@anikitenko/fdo-sdk/dist/@types/index.d.ts'));
    sources.set(root + '/__fdo_types__.d.ts', 'import "@anikitenko/fdo-sdk";\n');
    sources.set(root + '/__fdo_css__.d.ts', PLUGIN_CSS_TYPES + '\n' + PLUGIN_UI_TYPES);
    const files = [...sources.keys()].filter(name => /\.[cm]?[jt]sx?$/.test(name));
    const configPath = root + '/tsconfig.json';
    sources.set(configPath, JSON.stringify({files, compilerOptions: {
        noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: false,
        allowImportingTsExtensions: workspaceTsCompilerOptions.allowImportingTsExtensions,
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
        experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false,
        skipLibCheck: true, allowJs: true, checkJs: true, resolveJsonModule: true,
        jsx: 'react-jsx', types: ['node'], typeRoots: [normalize(path.join(nodeModules, '@types'))],
        paths: {'@anikitenko/fdo-sdk': [sdkTypes],
            '@anikitenko/fdo-sdk/ui': [normalize(path.join(nodeModules, '@anikitenko/fdo-sdk/dist/@types/ui/index.d.ts'))]},
    }}));
    const virtual = createVirtualFileSystem(Object.fromEntries(sources));
    const allowed = name => normalize(name) === normalize(nodeModules) || normalize(name).startsWith(normalize(nodeModules) + '/');
    const isDirectory = name => {try {return fs.statSync(name).isDirectory();} catch {return false;}};
    const api = new API({cwd: root, tsserverPath: nativeBinary, fs: {
        readFile: name => sources.get(normalize(name)) ?? (allowed(name) ? (() => {try {return fs.readFileSync(name, 'utf8');} catch {return null;}})() : null),
        fileExists: name => sources.has(normalize(name)) || (allowed(name) && fs.existsSync(name) && !isDirectory(name)),
        directoryExists: name => virtual.directoryExists(normalize(name)) || (allowed(name + '/') && isDirectory(name)),
        getAccessibleEntries: name => {
            const entries = virtual.getAccessibleEntries(normalize(name));
            if (entries) return entries;
            if (!allowed(name + '/')) return {files: [], directories: []};
            try {
                const children = fs.readdirSync(name, {withFileTypes: true});
                return {files: children.filter(item => !item.isDirectory()).map(item => item.name),
                    directories: children.filter(item => item.isDirectory()).map(item => item.name)};
            } catch {return {files: [], directories: []};}
        },
        realpath: name => name,
    }});
    let findings;
    try {
        const snapshot = api.updateSnapshot({openProjects: [configPath]});
        try {
            const program = snapshot.getProject(configPath)?.program;
            if (!program) throw new Error('TypeScript did not create a candidate project');
            const diagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
                ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
            const flatten = item => [item.text, ...(item.messageChain || []).map(flatten)].join('\n');
            findings = diagnostics.filter(item => item.category === DiagnosticCategory.Error).map(item => {
                const file = item.fileName ? normalize(item.fileName) : null;
                const content = sources.get(file) || '';
                const prefix = content.slice(0, Math.max(0, item.pos));
                const lines = prefix.split('\n');
                return {path: file?.startsWith(root + '/') ? file.slice(root.length) : null,
                    line: lines.length, column: lines[lines.length - 1].length + 1,
                    code: item.code, message: flatten(item)};
            });
        } finally {snapshot.dispose();}
    } finally {api.close();}
    // Keep noUnusedLocals enabled to report quality findings, but don't spend
    // generation repairs on unused imports, private methods or declarations.
    const unusedCodes = new Set([6133, 6192, 6196]);
    const warnings = findings.filter(item => unusedCodes.has(item.code));
    const diagnostics = findings.filter(item => !unusedCodes.has(item.code));
    return {success: diagnostics.length === 0, diagnostics, warnings, compilerVersion: requireRuntime('typescript').version};
}

// A scoped repair sees the entire latest candidate, but owns only its file's
// diagnostics. Remaining owners are verified at their step and the final gate.
export function validatePluginTypeScriptRepair(file, candidate) {
    const result = typecheckPluginWorkspace(Object.fromEntries(candidate.map(item => [item.path, item.content])));
    const environmentErrors = result.diagnostics.filter(item => !item.path || item.path.startsWith('/__fdo_'));
    if (environmentErrors.length) throw new Error(`Plugin TypeScript environment failed: ${environmentErrors.map(item => item.message).join(' ; ')}`);
    return result.diagnostics.filter(item => item.path === file.path).map(item =>
        `${item.path}:${item.line}:${item.column}: TS${item.code}: ${item.message}`);
}
