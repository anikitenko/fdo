import {parse} from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;
const SDK_MODULE = "@anikitenko/fdo-sdk";
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/i;

function workspaceEntries(workspace) {
    if (Array.isArray(workspace)) {
        return workspace.map((file) => ({
            path: String(file?.path || ""),
            content: String(file?.content || ""),
        }));
    }
    return Object.entries(workspace || {}).map(([path, content]) => ({
        path: String(path || ""),
        content: String(content || ""),
    }));
}

function isPluginSourceFile(file) {
    return SOURCE_FILE_PATTERN.test(file.path) && !TEST_FILE_PATTERN.test(file.path);
}

function isTypeOnlyReference(referencePath) {
    for (let current = referencePath.parentPath; current; current = current.parentPath) {
        const type = current.node?.type || "";
        // These nodes wrap a runtime expression as well as a type annotation.
        if (type === "TSAsExpression" || type === "TSSatisfiesExpression" || type === "TSNonNullExpression" || type === "TSInstantiationExpression") {
            continue;
        }
        if (type.startsWith("TS")) return true;
    }
    return false;
}

function hasRuntimeReference(importPath) {
    const binding = importPath.scope.getBinding(importPath.node.local.name);
    if (!binding) return true;
    return binding.referencePaths.some((referencePath) => !isTypeOnlyReference(referencePath));
}

function collectRuntimeSdkImports(file) {
    let ast;
    try {
        ast = parse(file.content, {
            sourceType: "unambiguous",
            plugins: ["typescript", "jsx", "decorators-legacy"],
        });
    } catch {
        // esbuild owns syntax diagnostics. Do not mask them with a contract error.
        return [];
    }

    const imports = [];
    traverse(ast, {
        ImportDeclaration(importPath) {
            if (importPath.node.source.value !== SDK_MODULE || importPath.node.importKind === "type") return;
            for (const specifier of importPath.get("specifiers")) {
                if (specifier.node.importKind === "type" || !hasRuntimeReference(specifier)) continue;
                if (specifier.isImportSpecifier()) {
                    imports.push({
                        name: specifier.node.imported.name || specifier.node.imported.value,
                        line: specifier.node.loc?.start.line || 1,
                    });
                } else if (specifier.isImportDefaultSpecifier()) {
                    imports.push({name: "default", line: specifier.node.loc?.start.line || 1});
                }
                // Namespace imports are a supported runtime module access pattern.
            }
        },
    });
    return imports;
}

function collectActionSourceErrors(file, createActionSource) {
    if (typeof createActionSource !== "function") return [];
    let ast;
    try {
        ast = parse(file.content, {sourceType: "unambiguous", plugins: ["typescript", "jsx", "decorators-legacy"]});
    } catch {
        return []; // esbuild reports workspace syntax errors.
    }
    const errors = [];
    traverse(ast, {
        CallExpression(call) {
            const callee = call.get("callee");
            let imported;
            if (callee.isIdentifier()) {
                imported = call.scope.getBinding(callee.node.name)?.path;
                if (!imported?.isImportSpecifier()
                    || (imported.node.imported.name || imported.node.imported.value) !== "defineRenderOnLoadActions"
                    || imported.parent.source.value !== SDK_MODULE) return;
            } else if (callee.isMemberExpression() && !callee.node.computed && callee.node.property.name === "defineRenderOnLoadActions") {
                imported = call.scope.getBinding(callee.node.object.name)?.path;
                if (!imported?.isImportNamespaceSpecifier() || imported.parent.source.value !== SDK_MODULE) return;
            } else return;
            const options = call.get("arguments.0")?.resolve();
            if (!options?.isObjectExpression()) return;
            const property = options.get("properties").find(item => item.isObjectProperty()
                && !item.node.computed && (item.node.key.name || item.node.key.value) === "handlers");
            const handlers = property?.get("value").resolve();
            if (!handlers?.isObjectExpression()) return;
            for (const handler of handlers.get("properties")) {
                if (!handler.isObjectProperty()) continue;
                const value = handler.get("value").resolve();
                const source = value.isStringLiteral() ? value.node.value
                    : value.isTemplateLiteral() && value.node.expressions.length === 0 ? value.node.quasis[0].value.cooked
                    : null;
                if (typeof source !== "string") continue;
                try {
                    // Generate with the installed SDK, then parse without executing
                    // plugin code. This follows SDK changes instead of duplicating
                    // its string-handler wrapping rules in the host compiler.
                    const emitted = createActionSource({
                        handlers: {action: source},
                        bindings: [{selector: "[data-action-validation]", event: "click", handler: "action"}],
                    });
                    parse(emitted, {sourceType: "unambiguous", plugins: ["typescript"]});
                } catch (error) {
                    const name = handler.node.key.name || handler.node.key.value || "action";
                    errors.push(`${file.path}:${value.node.loc?.start.line || 1}: renderOnLoad handler "${name}" produces invalid source with the installed SDK: ${error.message}. Use a complete handler function, for example ({document, element}) => { ... }, instead of a bare statement string.`);
                }
            }
        },
    });
    return errors;
}

/**
 * Validates value imports against the SDK module the plugin process will load.
 * Type-only imports are intentionally ignored because TypeScript erases them.
 */
export function validatePluginWorkspaceSdkContract(workspace = {}, {runtimeExports = [], createActionSource} = {}) {
    const availableExports = new Set(runtimeExports);
    if (availableExports.size === 0) {
        throw new Error("Plugin SDK runtime exports were not provided for validation.");
    }

    const errors = [];
    for (const file of workspaceEntries(workspace).filter(isPluginSourceFile)) {
        errors.push(...collectActionSourceErrors(file, createActionSource));
        for (const imported of collectRuntimeSdkImports(file)) {
            if (availableExports.has(imported.name)) continue;
            const exportLabel = imported.name === "default" ? "the default export" : `"${imported.name}"`;
            errors.push(`${file.path}:${imported.line}: @anikitenko/fdo-sdk does not provide ${exportLabel} in the SDK runtime used by this plugin. Use an export available from the installed SDK or change the plugin dependency.`);
        }
    }
    return errors;
}
