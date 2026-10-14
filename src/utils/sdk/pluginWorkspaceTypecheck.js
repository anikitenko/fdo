import Module from 'node:module';
import path from 'node:path';
import {getHostPluginNodeModulesPath} from '../plugins/runtime/pluginRuntimeBundle';
import {sanitizeVirtualWorkspacePath} from '../../components/editor/utils/aiCodingAgentWorkspacePath';
import {workspaceTsCompilerOptions} from '../plugins/validation/workspaceTsCompilerOptions';

// All candidate sources stay in memory. Do not load candidate tsconfig plugins,
// execute workspace code, or modify live editor models to obtain diagnostics.
export function typecheckPluginWorkspace(latestContent, nodeModules = getHostPluginNodeModulesPath()) {
    const requireRuntime = Module.createRequire(path.join(nodeModules, 'fdo-typecheck.cjs'));
    const ts = requireRuntime('typescript');
    const root = '/__fdo_candidate__';
    const sources = new Map();
    for (const [name, content] of Object.entries(latestContent || {})) {
        if (sanitizeVirtualWorkspacePath(name) !== name || name.startsWith('/node_modules/') || name.startsWith('/dist/')) continue;
        if (typeof content === 'string') sources.set(root + name, content);
    }
    const sdkTypes = path.join(nodeModules, '@anikitenko/fdo-sdk/dist/@types/index.d.ts');
    sources.set(root + '/__fdo_types__.d.ts', 'import "@anikitenko/fdo-sdk";\n');
    sources.set(root + '/__fdo_css__.d.ts', 'declare module "*.css" { const styles: Record<string, Record<string, string>>; export default styles; }');
    const options = {noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: false,
        allowImportingTsExtensions: workspaceTsCompilerOptions.allowImportingTsExtensions,
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false,
        esModuleInterop: true, skipLibCheck: true, allowJs: true, checkJs: true, resolveJsonModule: true,
        jsx: ts.JsxEmit.ReactJSX, types: ['node'], typeRoots: [path.join(nodeModules, '@types')],
        baseUrl: root, paths: {'@anikitenko/fdo-sdk': [sdkTypes]}};
    const host = ts.createCompilerHost(options);
    const libraryRoot = path.dirname(requireRuntime.resolve('typescript'));
    const allowed = name => [nodeModules, libraryRoot].some(base => path.resolve(name).startsWith(path.resolve(base) + path.sep));
    host.getCurrentDirectory = () => root;
    host.fileExists = name => sources.has(name) || (allowed(name) && ts.sys.fileExists(name));
    host.readFile = name => sources.get(name) ?? (allowed(name) ? ts.sys.readFile(name) : undefined);
    host.directoryExists = name => [...sources.keys()].some(file => file.startsWith(name + '/')) || (allowed(name + '/') && ts.sys.directoryExists(name));
    host.getDirectories = name => allowed(name) ? ts.sys.getDirectories(name) : [];
    host.realpath = name => name;
    host.getSourceFile = (name, languageVersion) => {
        const content = host.readFile(name);
        return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion, true);
    };
    const program = ts.createProgram([...sources.keys()].filter(name => /\.[cm]?[jt]sx?$/.test(name)), options, host);
    const findings = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => {
        const file = item.file?.fileName;
        const position = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : {line: 0, character: 0};
        const owner = file?.startsWith(root + '/') ? file.slice(root.length) : null;
        return {path: owner, line: position.line + 1, column: position.character + 1, code: item.code,
            message: ts.flattenDiagnosticMessageText(item.messageText, '\n')};
    });
    // Keep noUnusedLocals enabled to report quality findings, but don't spend
    // generation repairs on unused imports, private methods or declarations.
    const unusedCodes = new Set([6133, 6192, 6196]);
    const warnings = findings.filter(item => unusedCodes.has(item.code));
    const diagnostics = findings.filter(item => !unusedCodes.has(item.code));
    return {success: diagnostics.length === 0, diagnostics, warnings, compilerVersion: ts.version};
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
