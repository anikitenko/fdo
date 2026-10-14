import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {IconNames} from "@blueprintjs/icons";
import {validateGeneratedFileSyntax} from "../../../utils/plugins/validation/generatedFileSyntax";
import {validateGeneratedCallbackParameters} from "../../../utils/plugins/validation/generatedCallbackParameters";
import {resolveGeneratedImport, validateGeneratedWorkspaceImports} from "../../../utils/plugins/validation/generatedWorkspaceImports";
import {hasInvalidBackendRequest} from "../../../utils/plugins/validation/generatedBackendRequests";

const BLUEPRINT_ICON_SET = new Set(
    Object.values(IconNames)
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase())
);

function normalizeLineEndings(value = "") {
    return String(value || "").replace(/\r\n/g, "\n");
}

function findPluginEntryFile(files = []) {
    // Nested index modules and extracted SDK subclasses are dependencies, not
    // entry points. They must not start an additional plugin instance.
    return files.find((file) => /^\/index\.[cm]?[jt]sx?$/.test(file?.path || ''));
}

// Inspect the deployed dependency graph, excluding test-only and unused
// composition modules. This is a conservative diagnostic, not visual proof.
export function findWorkspaceStyleIssues(files = []) {
    const entry = findPluginEntryFile(files);
    if (!entry) return [];
    const byPath = new Map(files.map(file => [file.path, file]));
    const paths = new Set(byPath.keys());
    const visited = new Set();
    const queue = [entry.path];
    const styleOwners = new Set();
    let registration = false;
    while (queue.length) {
        const path = queue.pop();
        if (visited.has(path) || isPluginTestFilePath(path)) continue;
        visited.add(path);
        const file = byPath.get(path);
        if (!file || !/\.[cm]?[jt]sx?$/.test(path)) continue;
        try {
            const ast = parse(file.content, {sourceType: 'module', plugins: ['typescript', 'jsx']});
            const traverse = traverseModule.default || traverseModule;
            traverse(ast, {
                MemberExpression(member) {
                    const node = member.node;
                    if ((!node.computed && node.property.name === 'createClassFromStyle')
                        || (node.computed && node.property.value === 'createClassFromStyle')) registration = true;
                },
            });
            for (const statement of ast.program.body) {
                if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type)
                    || !statement.source || statement.importKind === 'type' || statement.exportKind === 'type') continue;
                const specifier = statement.source.value;
                if (/\.css$/.test(specifier)) styleOwners.add(path);
                const target = resolveGeneratedImport(path, specifier, paths);
                if (target) queue.push(target);
            }
        } catch { /* Source validation owns parser errors. */ }
    }
    if (styleOwners.size && !registration) {
        return [...new Set([entry.path, ...styleOwners])].map(file => ({severity: 'warning', file,
            issue: 'Plugin-local stylesheet imports have no SDK style registration in the deployed rendering dependency graph.',
            evidence: `Entry ${entry.path} reaches CSS imports in ${[...styleOwners].join(', ')} with no createClassFromStyle reference. Unused composition modules and tests are excluded.`,
            repair: 'Inspect the deployed render call chain. CSS entries are objects, not class-name strings: replace string-only style lookups and literal-name fallbacks with registration on one shared SDK DOM instance. Register palette styles on an ancestor, pass that DOM through child renderers, and finish the full markup with dom.renderHTML(...). Route plugin render() through this composition while preserving state, handlers and working behavior. Verify emitted CSS; class-name and stylesheet-text assertions alone do not verify styling.',
        }));
    }
    return [];
}

function extractMetadataIconLiterals(content = "") {
    const icons = [];
    const unwrap = node => ["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(node?.type)
        ? unwrap(node.expression) : node;
    const key = node => !node?.computed && node?.key?.type === "Identifier" ? node.key.name
        : node?.key?.type === "StringLiteral" ? node.key.value : null;
    try {
        const ast = parse(content, {sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy"]});
        const sdkNames = new Set(["FDO_SDK"]);
        for (const statement of ast.program.body) {
            if (statement.type === "ImportDeclaration" && statement.source.value === "@anikitenko/fdo-sdk") {
                for (const specifier of statement.specifiers) {
                    if (specifier.imported?.name === "FDO_SDK") sdkNames.add(specifier.local.name);
                }
            }
        }
        const traverse = traverseModule.default || traverseModule;
        traverse(ast, {Class(classPath) {
            if (!sdkNames.has(classPath.node.superClass?.name)) return;
            const members = classPath.node.body.body;
            const resolve = (node, scope, seen = new Set()) => {
                node = unwrap(node);
                if (!node || seen.has(node)) return null;
                seen.add(node);
                if (node.type === "ObjectExpression") return node;
                if (node.type === "Identifier") {
                    const binding = scope.getBinding(node.name);
                    if (binding?.constant) return resolve(binding.path.node.init, binding.path.scope, seen);
                }
                if (node.type === "MemberExpression" && node.object.type === "ThisExpression") {
                    const name = node.computed ? node.property.value : node.property.name;
                    const field = members.find(member => member.type === "ClassProperty" && key(member) === name);
                    return resolve(field?.value, scope, seen);
                }
                return null;
            };
            const inspect = (node, scope) => {
                const metadata = resolve(node, scope);
                for (const property of metadata?.properties || []) {
                    if (property.type !== "ObjectProperty" || key(property) !== "icon") continue;
                    const value = unwrap(property.value);
                    if (value?.type === "StringLiteral") icons.push(value.value);
                    if (value?.type === "TemplateLiteral" && !value.expressions.length) icons.push(value.quasis[0].value.cooked);
                }
            };
            for (const member of classPath.get("body.body")) {
                if (member.isClassProperty() && ["metadata", "_metadata"].includes(key(member.node))) inspect(member.node.value, member.scope);
                if (member.isClassMethod() && member.node.kind === "get" && key(member.node) === "metadata") {
                    member.traverse({ReturnStatement(returnPath) {
                        if (returnPath.getFunctionParent() === member) inspect(returnPath.node.argument, returnPath.scope);
                    }});
                }
            }
        }});
    } catch { /* Syntax validation reports malformed source separately. */ }
    return [...new Set(icons)];
}

function looksLikeCustomIconAsset(value = "") {
    return /[\\/]|\.png\b|\.svg\b|\.ico\b|\.jpg\b|\.jpeg\b|\.webp\b|\.gif\b/i.test(String(value || ""));
}

function containsNonUiWindowAccess(content = "") {
    const suspicious = new Set();
    try {
        const ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        const traverse = traverseModule.default || traverseModule;
        traverse(ast, {MemberExpression(path) {
            if (path.node.object.type !== 'Identifier' || path.node.object.name !== 'window') return;
            const uiCallback = path.findParent(parent => parent.isCallExpression()
                && (parent.node.callee?.property?.name === 'addEventListener'
                    || parent.node.callee?.name === 'defineRenderOnLoadActions'));
            if (!uiCallback) suspicious.add(path.node.loc.start.line);
        }});
    } catch { /* Syntax errors are reported by the syntax validator. */ }
    return [...suspicious];
}

function findForbiddenHostImports(content = "") {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split("\n");
    const violations = [];

    lines.forEach((line, index) => {
        const importMatch = line.match(/(?:from\s+["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\))/);
        const rawPath = importMatch?.[1] || importMatch?.[2];
        if (!rawPath) return;

        const normalizedImportPath = String(rawPath || "").replace(/\\/g, "/");

        if (
            /(?:^|\/)components\/editor\//.test(normalizedImportPath) ||
            /(?:^|\/)components\/plugin\/PluginPage\.jsx$/.test(normalizedImportPath) ||
            /(?:^|\/)components\/PluginContainer\.jsx$/.test(normalizedImportPath) ||
            /(?:^|\/)ipc\//.test(normalizedImportPath) ||
            /(?:^|\/)utils\/pluginTestRunner\.js$/.test(normalizedImportPath) ||
            /(?:^|\/)components\/editor\/utils\/VirtualFS\.js$/.test(normalizedImportPath) ||
            /(?:^|\/)components\/editor\/utils\/validateGeneratedPluginFiles\.js$/.test(normalizedImportPath)
        ) {
            violations.push({ line: index + 1, path: rawPath });
        }
    });

    return violations;
}

function findCopiedHostRuntimeBootstrapMarkers(content = "") {
    const normalized = normalizeLineEndings(content);
    const rules = [
        { pattern: /\bcreateESModule\s*\(/, label: "createESModule(...)" },
        { pattern: /\bSetPluginComponent\s*\(/, label: "SetPluginComponent(...)" },
        { pattern: /\bpluginTimeout\b/, label: "pluginTimeout" },
        { pattern: /\bPLUGIN_HELLO\b/, label: "PLUGIN_HELLO" },
        { pattern: /\bPLUGIN_RENDER\b/, label: "PLUGIN_RENDER" },
        { pattern: /\bimport\s*\(\s*\/\*\s*webpackIgnore:\s*true\s*\*\/\s*moduleURL\s*\)/, label: "dynamic moduleURL import" },
    ];

    return rules
        .filter((rule) => rule.pattern.test(normalized))
        .map((rule) => rule.label);
}

function isPluginTestFilePath(filePath = "") {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    return (
        /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/.test(normalized) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    );
}

function analyzePluginTestFrameworkUsage(content = "") {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split("\n");
    const nodeTestImportPattern = /\bfrom\s+["'`]node:test["'`]|\brequire\(\s*["'`]node:test["'`]\s*\)/;
    const jestImportPattern = /\bfrom\s+["'`](?:@jest\/globals|jest|vitest)["'`]|\brequire\(\s*["'`](?:@jest\/globals|jest|vitest)["'`]\s*\)/;
    const bareJestGlobalPattern = /\b(describe|it|test|beforeEach|afterEach|beforeAll|afterAll|expect)\s*\(/;
    const warnings = [];
    const errors = [];
    const hasNodeTestImport = nodeTestImportPattern.test(normalized);

    lines.forEach((line, index) => {
        if (jestImportPattern.test(line)) {
            errors.push(`${index + 1}: plugin tests must use node:test and node:assert/strict. Do not import Jest or Vitest in the FDO plugin test runner.`);
            return;
        }

        const match = line.match(bareJestGlobalPattern);
        if (!match) {
            return;
        }

        const symbol = match[1];
        if (symbol === "expect") {
            errors.push(`${index + 1}: plugin tests must use node:assert/strict instead of Jest/Vitest expect().`);
            return;
        }

        if (!hasNodeTestImport) {
            errors.push(`${index + 1}: plugin tests use ${symbol}(...) without importing from node:test. Import the test API from node:test for FDO's bundled test runner.`);
        }
    });

    if (hasNodeTestImport && /\bexpect\s*\(/.test(normalized)) {
        warnings.push("plugin tests import node:test but still use expect(). Prefer node:assert/strict so tests run cleanly in FDO's bundled runner.");
    }

    return {warnings, errors};
}

function validateInjectedUiFoundation(files, errors) {
    const uiFiles = files.filter((file) => !isPluginTestFilePath(file?.path));
    const source = uiFiles.map((file) => normalizeLineEndings(file?.content || "")).join("\n");
    const primaryUiPath = uiFiles.find((file) => /(?:<textarea\b|<input\b|<select\b|createElement\s*\(\s*["'](?:textarea|input|select)["'])/i.test(file?.content || ""))?.path
        || "/render.tsx";
    const hasFormField = /(?:<textarea\b|<input\b|<select\b|createElement\s*\(\s*["'](?:textarea|input|select)["'])/i.test(source);
    const hasActionButton = /(?:<button\b|createElement\s*\(\s*["']button["'])/i.test(source);

    if (hasFormField && (!/\bpure-form\b/.test(source) || !/\bpure-form-stacked\b/.test(source))) {
        errors.push(`${primaryUiPath}: interactive forms must use the injected Pure CSS foundation. Add a "pure-form pure-form-stacked" wrapper; do not import Pure CSS.`);
    }
    if (hasFormField && hasActionButton && (!/\bpure-button\b/.test(source) || !/\bpure-button-primary\b/.test(source))) {
        errors.push(`${primaryUiPath}: an interactive plugin needs a primary action styled with injected Pure CSS. Add "pure-button pure-button-primary" to its main button; do not import Pure CSS.`);
    }
    if (hasFormField && /(?:from\s+["']purecss(?:\/[^"']*)?["']|import\s+["']purecss(?:\/[^"']*)?["'])/i.test(source)) {
        errors.push(`${primaryUiPath}: Pure CSS is already injected into every plugin iframe. Remove the Pure CSS import and use its class names directly.`);
    }
}

function validateBackendRequestEnvelopes(files, errors) {
    for (const file of files.filter(file => !isPluginTestFilePath(file?.path))) {
        const source = normalizeLineEndings(file?.content || '');
        const invalid = hasInvalidBackendRequest(source);
        if (invalid) errors.push(`${file.path}: window.createBackendReq must call "UI_MESSAGE" and pass an object with handler and content. Example: window.createBackendReq("UI_MESSAGE", {handler: "myHandler", content: {...}}).`);
    }
}

function validatePluginRenderingSyntax(files, errors) {
    files.filter((file) => !isPluginTestFilePath(file?.path)).forEach((file) => {
        const content = normalizeLineEndings(file?.content || "");
        // The virtual plugin build treats workspace source as TypeScript and
        // the SDK's DOM helpers render HTML strings. React JSX (especially
        // className/htmlFor) therefore cannot be passed to dom.renderHTML().
        const jsxPassedToRenderHtml = /\brenderHTML\s*\(\s*<\s*[A-Za-z][\w.-]*(?=[\s>])[\s\S]{0,500}\b(?:className|htmlFor)\s*=/m.test(content);
        if (jsxPassedToRenderHtml) {
            errors.push(`${file.path || "/render.tsx"}: React JSX is unsupported in plugin workspace files. Use an SDK DOM instance’s createElement(...) or DOMText/DOMNested helpers and pass their rendered HTML string to dom.renderHTML(...); use "class", not JSX className.`);
        }
    });
}

function validatePluginDomHelperUsage(files, errors) {
    files.filter((file) => !isPluginTestFilePath(file?.path)).forEach((file) => {
        const content = file?.content || "";
        if (/\bDOM\.createElement\s*\(/.test(content)) {
            errors.push(`${file.path || "/render.tsx"}: DOM.createElement(...) is not an SDK static method. Create one instance, for example const dom = new DOM(), then call dom.createElement(...).`);
        }
        if (/\bnew\s+DOMNested\s*\(\s*\[/.test(content) || /\bnew\s+DOMText\s*\(\s*["'`]/.test(content)) {
            errors.push(`${file.path || "/render.tsx"}: DOMNested and DOMText constructors do not create markup from constructor arguments. Compose the returned strings from dom.createElement(...); if needed, call explicit instance factory methods such as new DOMText().createPText(...).`);
        }
    });
}

function validateReservedHostBindingMarkers(files, errors) {
    files.filter((file) => !isPluginTestFilePath(file?.path)).forEach((file) => {
        const content = normalizeLineEndings(file?.content || "");
        if (/(?:\bdataset\s*\.\s*bound\b|["'`]data-bound["'`])/.test(content)) {
            errors.push(`${file.path || "/render.tsx"}: data-bound and element.dataset.bound are reserved for FDO host bindings. Use a plugin-specific marker such as element.dataset.myPluginBound when a manual listener must be attached once.`);
        }
    });
}

function validateBackendFormSubmitBindings(files, errors) {
    const uiFiles = files.filter((file) => !isPluginTestFilePath(file?.path));
    const source = uiFiles.map((file) => normalizeLineEndings(file?.content || "")).join("\n");
    if (!/\bwindow\.createBackendReq\s*\(/.test(source) || !/\baddEventListener\s*\(\s*["']submit["']/.test(source)) {
        return;
    }
    for (const file of uiFiles.filter(file => /\baddEventListener\s*\(\s*["']submit["']/.test(file?.content || ""))) {
        errors.push(`${file.path}: backend UI actions must use defineRenderOnLoadActions(...) with a click binding on a type="button" control. Do not attach a manual form submit listener in the plugin iframe.`);
    }
}

function escapeRegExp(value = "") {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateUiMessageHandlerPayloadShape(files, errors) {
    const uiFiles = files.filter((file) => !isPluginTestFilePath(file?.path));
    const source = uiFiles.map((file) => normalizeLineEndings(file?.content || "")).join("\n");
    const handlerNames = new Set();
    const requestPattern = /window\.createBackendReq\s*\(\s*["']UI_MESSAGE["']\s*,\s*\{[\s\S]{0,700}?\bhandler\s*:\s*["']([A-Za-z_$][\w$-]*)["'][\s\S]{0,700}?\bcontent\s*:\s*\{\s*[A-Za-z_$][\w$-]*\s*:/g;
    let match;
    while ((match = requestPattern.exec(source))) {
        handlerNames.add(match[1]);
    }

    for (const handlerName of handlerNames) {
        const escapedHandlerName = escapeRegExp(handlerName);
        const inlineHandlerReadsNestedContent = new RegExp(
            `PluginRegistry\\.registerHandler\\s*\\(\\s*["']${escapedHandlerName}["'][\\s\\S]{0,2200}?\\b(?:data|request|payload)\\s*\\??\\.\\s*content\\s*\\??\\.`,
        ).test(source);
        const namedHandlerReadsNestedContent = new RegExp(
            `(?:function\\s+${escapedHandlerName}|(?:const|let)\\s+${escapedHandlerName}\\s*=)[\\s\\S]{0,1800}?\\b(?:data|request|payload)\\s*\\??\\.\\s*content\\s*\\??\\.`,
        ).test(source);
        const destructuredNestedContent = new RegExp(
            `(?:function\\s+${escapedHandlerName}|(?:const|let)\\s+${escapedHandlerName}\\s*=|PluginRegistry\\.registerHandler\\s*\\(\\s*["']${escapedHandlerName}["'])[\\s\\S]{0,700}?\\(\\s*\\{\\s*content\\b`,
        ).test(source);

        if (inlineHandlerReadsNestedContent || namedHandlerReadsNestedContent || destructuredNestedContent) {
            const handlerPath = uiFiles.find((file) => new RegExp(`registerHandler\\s*\\(\\s*["']${escapedHandlerName}["']|(?:function|const|let)\\s+${escapedHandlerName}\\b`).test(file?.content || ""))?.path || "/index.ts";
            errors.push(`${handlerPath}: the "${handlerName}" UI handler receives createBackendReq(..., {content: {...}}).content directly. Read data.json (or destructure ({json})); do not read data.content.json or destructure ({content}).`);
        }
    }
}

// This is a safe mechanical repair rather than a model-quality judgment. The
// host owns data-bound, while generated plugins sometimes use it as a generic
// "listener attached" flag. Rename both forms consistently before validation
// so a valid workspace does not need a second, expensive provider request.
export function normalizeReservedHostBindingMarkers(files = []) {
    const normalizedPaths = [];
    const normalizedFiles = files.map((file) => {
        if (isPluginTestFilePath(file?.path)) {
            return file;
        }
        const content = normalizeLineEndings(file?.content || "");
        const normalizedContent = content
            .replace(/\bdataset\s*(?:\.\s*bound\b|\[\s*["']bound["']\s*\])/g, "dataset.pluginListenerBound")
            .replace(/(["'`])data-bound\1/g, "$1data-plugin-listener-bound$1");
        if (normalizedContent !== content) {
            normalizedPaths.push(file?.path || "/render.tsx");
            return {...file, content: normalizedContent};
        }
        return file;
    });
    return {files: normalizedFiles, normalizedPaths};
}

export function validateGeneratedPluginFiles(files = [], {partial = false, workspaceFiles = []} = {}) {
    const warnings = [];
    const errors = validateGeneratedWorkspaceImports(files, {sources: [], paths: files.map(file => file.path), checkMissing: false});
    const pluginEntry = findPluginEntryFile(files);

    files.forEach((file) => {
        const syntaxErrors = validateGeneratedFileSyntax(file, {entry: file === pluginEntry});
        errors.push(...syntaxErrors);
        // Scope-based SDK/bridge inspections can throw on duplicate bindings
        // even when Babel's recovery parser produced an AST. Keep the source
        // diagnostic as the repair owner; inspect this file after it parses.
        if (syntaxErrors.length) return;
        warnings.push(...validateGeneratedCallbackParameters(file));
        const content = normalizeLineEndings(file?.content || "");
        const forbiddenImports = findForbiddenHostImports(content);
        forbiddenImports.forEach(({ line, path }) => {
            errors.push(`${file.path || "/unknown"}:${line}: plugin code must not import FDO host/editor implementation files (${path}). This generated file is targeting FDO internals instead of plugin-local code. Use local plugin files, Node built-ins, or exported SDK APIs only.`);
        });
        const copiedBootstrapMarkers = findCopiedHostRuntimeBootstrapMarkers(content);
        if (copiedBootstrapMarkers.length > 0) {
            errors.push(`${file.path || "/unknown"}: plugin code appears to copy FDO host runtime bootstrap logic (${copiedBootstrapMarkers.join(", ")}). Do not copy PluginPage/PluginContainer host code into a plugin workspace.`);
        }

        if (isPluginTestFilePath(file?.path)) {
            const testFrameworkUsage = analyzePluginTestFrameworkUsage(content);
            testFrameworkUsage.errors.forEach((message) => {
                errors.push(`${file.path || "/unknown"}:${message}`);
            });
            testFrameworkUsage.warnings.forEach((message) => {
                warnings.push(`${file.path || "/unknown"}: ${message}`);
            });
        }
    });

    if (pluginEntry) {
        const content = normalizeLineEndings(pluginEntry.content);
        for (const metadataIcon of extractMetadataIconLiterals(content)) {
            if (metadataIcon && looksLikeCustomIconAsset(metadataIcon)) {
                errors.push(`/index.ts: metadata.icon must use a BlueprintJS v6 icon name string, not a custom asset path (${metadataIcon})`);
            } else if (metadataIcon && !BLUEPRINT_ICON_SET.has(metadataIcon.trim().toLowerCase())) {
                errors.push(`/index.ts: metadata.icon "${metadataIcon}" is not a valid BlueprintJS v6 icon name. Use a verified icon such as "data-search" or "cog".`);
            }
        }

        const suspiciousWindowLines = containsNonUiWindowAccess(content);
        if (suspiciousWindowLines.length > 0) {
            warnings.push(`/index.ts: direct window.* access appears outside obvious UI/event code paths on line(s) ${suspiciousWindowLines.join(", ")}`);
        }
    }

    validatePluginRenderingSyntax(files, errors);
    validatePluginDomHelperUsage(files, errors);
    validateReservedHostBindingMarkers(files, errors);
    // These contracts can be rejected within a leaf module. Run them during
    // generation, before the remaining workspace consumes more requests.
    const candidateFiles = partial ? files
        : [...new Map([...workspaceFiles, ...files].map(file => [file.path, file])).values()];
    validateBackendRequestEnvelopes(candidateFiles, errors);
    validateBackendFormSubmitBindings(candidateFiles, errors);
    // A leaf module can rely on wrappers, actions and handlers in pending files.
    // Cross-file rules run only on a complete workspace in the editor.
    if (!partial) {
        // Repairs return replacements, not a complete workspace. Resolve
        // cross-file contracts against retained files plus those replacements.
        validateInjectedUiFoundation(candidateFiles, errors);
        validateUiMessageHandlerPayloadShape(candidateFiles, errors);
        const styleIssues = findWorkspaceStyleIssues(candidateFiles);
        if (styleIssues.length) warnings.push(`${styleIssues[0].file}: reachable CSS imports (${styleIssues.slice(1).map(issue => issue.file).join(', ') || styleIssues[0].file}) have no SDK createClassFromStyle registration. ${styleIssues[0].repair}`);
    }

    return { warnings, errors };
}
