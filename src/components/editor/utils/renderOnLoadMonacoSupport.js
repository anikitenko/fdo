const FALLBACK_SDK_MODULE_ID = "@anikitenko/fdo-sdk";
const ONLOAD_FILE_PATTERN = /\.onload\.[cm]?[jt]sx?$/i;

let sdkModulePromise = null;
let renderOnLoadTemplatesPromise = null;

export function __resetRenderOnLoadSdkSupportCacheForTests() {
    sdkModulePromise = null;
    renderOnLoadTemplatesPromise = null;
}

function normalizeVirtualPath(pathValue = "", fallback = "") {
    const normalized = String(pathValue || "").trim();
    if (!normalized) {
        return fallback;
    }
    return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
}

export const RENDER_ON_LOAD_FALLBACK_D_TS = `declare namespace FDOOnLoad {
  type BackendReq = (type: string, data?: unknown) => Promise<unknown>;
  type WaitForElement = (selector: string, callback: (element: Element) => void, timeout?: number) => void;
  interface Context {
    window: Window;
    document: Document;
    createBackendReq: BackendReq;
    waitForElement: WaitForElement;
    addGlobalEventListener: Window["addGlobalEventListener"];
    removeGlobalEventListener: Window["removeGlobalEventListener"];
    executeInjectedScript: Window["executeInjectedScript"];
    applyClassToSelector: Window["applyClassToSelector"];
    Notyf?: Window["Notyf"];
    hljs?: Window["hljs"];
    ace?: Window["ace"];
  }
}
`;

export const FALLBACK_RENDER_ON_LOAD_MONACO_HINTS = Object.freeze([
    {
        label: "defineRenderOnLoadActions click binding",
        kind: "snippet",
        detail: "Declarative click binding with typed async handler",
        documentation: "Prefer defineRenderOnLoadActions(...) over hand-written querySelector/addEventListener loops when the plugin has multiple UI actions.",
        insertText: [
            "return defineRenderOnLoadActions({",
            "    handlers: {",
            "        ${1:refreshStatus}: async ({ element, event }) => {",
            "            const response = await window.createBackendReq(\"UI_MESSAGE\", {",
            "                handler: \"${2:refreshStatus}\",",
            "                content: { ${3:source}: \"renderOnLoad\" },",
            "            });",
            "            const target = document.querySelector(\"${4:[data-role=\\\"status\\\"]}\");",
            "            if (target) {",
            "                target.textContent = String(response?.message || \"Updated\");",
            "            }",
            "            if (element instanceof HTMLElement) {",
            "                element.dataset.state = \"ready\";",
            "            }",
            "        },",
            "    },",
            "    bindings: [",
            "        {",
            "            selector: \"${5:[data-role=\\\"refresh\\\"]}\",",
            "            event: \"click\",",
            "            handler: \"${2:refreshStatus}\",",
            "            preventDefault: true,",
            "            required: true,",
            "        },",
            "    ],",
            "    // strict: true makes selector mismatches visible during development.",
            "    strict: true,",
            "    language: \"typescript\",",
            "});",
        ].join("\n"),
        sortText: "0_defineRenderOnLoadActions_click",
    },
    {
        label: "defineRenderOnLoad callback",
        kind: "snippet",
        detail: "Return a typed onLoad callback module",
        documentation: "Use defineRenderOnLoad() to author renderOnLoad without raw string templates.",
        insertText: [
            "return defineRenderOnLoad(() => {",
            "    ${1:// Runs after the plugin UI mounts}",
            "    ${2:console.log(\"Plugin UI mounted\");}",
            "}, { language: \"typescript\" });",
        ].join("\n"),
        sortText: "0_defineRenderOnLoad_callback",
    },
    {
        label: "defineRenderOnLoad waitForElement",
        kind: "snippet",
        detail: "Wait for a selector before mutating the DOM",
        documentation: "Helpful when the onLoad logic needs to target a node rendered by the plugin markup.",
        insertText: [
            "return defineRenderOnLoad(() => {",
            "    waitForElement(\"${1:#plugin-root}\", (element) => {",
            "        ${2:element.classList.add(\"is-ready\");}",
            "    });",
            "}, { language: \"typescript\" });",
        ].join("\n"),
        sortText: "0_defineRenderOnLoad_waitForElement",
    },
    {
        label: "defineRenderOnLoad event listener",
        kind: "snippet",
        detail: "Register a global event listener",
        documentation: "Uses the host-provided addGlobalEventListener bridge instead of direct raw templates.",
        insertText: [
            "return defineRenderOnLoad(() => {",
            "    const onResize = () => {",
            "        ${1:console.log(window.innerWidth);}",
            "    };",
            "    addGlobalEventListener(\"resize\", onResize);",
            "}, { language: \"typescript\" });",
        ].join("\n"),
        sortText: "0_defineRenderOnLoad_listener",
    },
    {
        label: "defineRenderOnLoad executeInjectedScript",
        kind: "snippet",
        detail: "Inject a script block into the plugin host page",
        documentation: "Use when the onLoad logic needs a small imperative bootstrap script.",
        insertText: [
            "return defineRenderOnLoad(() => {",
            "    executeInjectedScript(`",
            "        ${1:console.log(\"Injected onLoad script\");}",
            "    `);",
            "}, { language: \"typescript\" });",
        ].join("\n"),
        sortText: "0_defineRenderOnLoad_script",
    },
]);

function normalizeHint(hint = {}) {
    return {
        label: String(hint?.label || "").trim(),
        insertText: typeof hint?.insertText === "string" ? hint.insertText : "",
        detail: typeof hint?.detail === "string" ? hint.detail : "",
        documentation: typeof hint?.documentation === "string" ? hint.documentation : "",
        kind: typeof hint?.kind === "string" ? hint.kind : "",
        sortText: typeof hint?.sortText === "string" ? hint.sortText : "",
        filterText: typeof hint?.filterText === "string" ? hint.filterText : "",
    };
}

function normalizeRenderOnLoadTemplate(template = {}) {
    const id = String(template?.id || "").trim();
    if (!id) {
        return null;
    }
    return {
        id,
        label: typeof template?.label === "string" && template.label.trim() ? template.label.trim() : id,
        description: typeof template?.description === "string" ? template.description : "",
        context: template?.context === "runtime-source" ? "runtime-source" : "plugin-method",
        language: String(template?.language || "").trim().toLowerCase() === "javascript" ? "javascript" : "typescript",
        source: typeof template?.source === "string" ? template.source : "",
    };
}

async function loadSdkModule() {
    if (!sdkModulePromise) {
        sdkModulePromise = Promise.resolve()
            .then(async () => {
                const getter = window?.electron?.system?.getFdoSdkEditorSupport;
                if (typeof getter !== "function") {
                    return null;
                }
                const result = await getter();
                if (!result || result.success === false || !result.bundle || typeof result.bundle !== "object") {
                    return null;
                }
                return result.bundle;
            })
            .catch(() => null);
    }
    return sdkModulePromise;
}

async function loadSdkRenderOnLoadTemplates() {
    if (!renderOnLoadTemplatesPromise) {
        renderOnLoadTemplatesPromise = Promise.resolve()
            .then(async () => {
                const getter = window?.electron?.system?.getFdoSdkRenderOnLoadTemplates;
                if (typeof getter !== "function") {
                    return [];
                }
                const result = await getter();
                if (!result || result.success === false || !Array.isArray(result.templates)) {
                    return [];
                }
                return result.templates.map(normalizeRenderOnLoadTemplate).filter(Boolean);
            })
            .catch(() => []);
    }
    return renderOnLoadTemplatesPromise;
}

export async function getSdkEditorSupportBundleWithFallback() {
    const sdkBundle = await loadSdkModule();
    const moduleId = (
        typeof sdkBundle?.moduleId === "string" && sdkBundle.moduleId.trim()
            ? sdkBundle.moduleId.trim()
            : FALLBACK_SDK_MODULE_ID
    );
    const fallbackIndexTypesVirtualPath = `/node_modules/${moduleId}/index.d.ts`;
    const fallbackPackageJsonVirtualPath = `/node_modules/${moduleId}/package.json`;

    if (sdkBundle && typeof sdkBundle === "object") {
        const packageJson = (
            typeof sdkBundle.packageJson === "string" && sdkBundle.packageJson.trim()
                ? sdkBundle.packageJson
                : null
        );
        const packageManifest = (
            sdkBundle.packageManifest && typeof sdkBundle.packageManifest === "object"
                ? sdkBundle.packageManifest
                : null
        );
        return {
            moduleId,
            indexTypesVirtualPath: normalizeVirtualPath(sdkBundle.indexTypesVirtualPath, fallbackIndexTypesVirtualPath),
            packageJsonVirtualPath: normalizeVirtualPath(sdkBundle.packageJsonVirtualPath, fallbackPackageJsonVirtualPath),
            packageJson,
            packageManifest,
            renderOnLoadTypeDefinitions: (
                typeof sdkBundle.renderOnLoadTypeDefinitions === "string" && sdkBundle.renderOnLoadTypeDefinitions.trim()
                    ? sdkBundle.renderOnLoadTypeDefinitions
                    : RENDER_ON_LOAD_FALLBACK_D_TS
            ),
            renderOnLoadHints: Array.isArray(sdkBundle.renderOnLoadHints)
                ? sdkBundle.renderOnLoadHints.map(normalizeHint).filter((hint) => hint.label && hint.insertText)
                : null,
        };
    }

    return {
        moduleId,
        indexTypesVirtualPath: fallbackIndexTypesVirtualPath,
        packageJsonVirtualPath: fallbackPackageJsonVirtualPath,
        packageJson: null,
        packageManifest: null,
        renderOnLoadTypeDefinitions: RENDER_ON_LOAD_FALLBACK_D_TS,
    };
}

function normalizeMonacoPolicy(policy = {}, defaults = {}) {
    const includeSdkModuleFallbackTypes = (
        typeof policy?.includeSdkModuleFallbackTypes === "boolean"
            ? policy.includeSdkModuleFallbackTypes
            : defaults.includeSdkModuleFallbackTypes
    );
    const includePackageJsonVirtualFile = (
        typeof policy?.includePackageJsonVirtualFile === "boolean"
            ? policy.includePackageJsonVirtualFile
            : defaults.includePackageJsonVirtualFile
    );
    const includeRenderOnLoadNamespaceFallback = (
        typeof policy?.includeRenderOnLoadNamespaceFallback === "boolean"
            ? policy.includeRenderOnLoadNamespaceFallback
            : defaults.includeRenderOnLoadNamespaceFallback
    );
    const indexTypesVirtualPath = normalizeVirtualPath(policy?.indexTypesVirtualPath, defaults.indexTypesVirtualPath);
    const packageJsonVirtualPath = normalizeVirtualPath(policy?.packageJsonVirtualPath, defaults.packageJsonVirtualPath);
    return {
        includeSdkModuleFallbackTypes: includeSdkModuleFallbackTypes !== false,
        includePackageJsonVirtualFile: includePackageJsonVirtualFile !== false,
        includeRenderOnLoadNamespaceFallback: includeRenderOnLoadNamespaceFallback !== false,
        indexTypesVirtualPath,
        packageJsonVirtualPath,
    };
}

export async function getSdkEditorSupportMonacoPolicyWithFallback({
    hasSdkIndex = false,
    moduleId = FALLBACK_SDK_MODULE_ID,
    indexTypesVirtualPath = `/node_modules/${moduleId}/index.d.ts`,
    packageJsonVirtualPath = `/node_modules/${moduleId}/package.json`,
    namespaceFallbackTypeDefinitions = "",
} = {}) {
    const defaults = {
        includeSdkModuleFallbackTypes: !hasSdkIndex,
        includePackageJsonVirtualFile: hasSdkIndex,
        includeRenderOnLoadNamespaceFallback: true,
        indexTypesVirtualPath: normalizeVirtualPath(indexTypesVirtualPath, `/node_modules/${moduleId}/index.d.ts`),
        packageJsonVirtualPath: normalizeVirtualPath(packageJsonVirtualPath, `/node_modules/${moduleId}/package.json`),
    };
    const getter = window?.electron?.system?.getFdoSdkEditorMonacoPolicy;
    if (typeof getter !== "function") {
        return defaults;
    }
    try {
        const result = await getter({
            hasSdkIndex: hasSdkIndex === true,
            namespaceFallbackTypeDefinitions: typeof namespaceFallbackTypeDefinitions === "string"
                ? namespaceFallbackTypeDefinitions
                : "",
        });
        if (!result || result.success === false || !result.policy || typeof result.policy !== "object") {
            return defaults;
        }
        return normalizeMonacoPolicy(result.policy, defaults);
    } catch (_) {
        return defaults;
    }
}

export async function getRenderOnLoadMonacoTypeDefinitionsWithFallback() {
    const sdkBundle = await loadSdkModule();
    if (typeof sdkBundle?.renderOnLoadTypeDefinitions === "string" && sdkBundle.renderOnLoadTypeDefinitions.trim()) {
        return sdkBundle.renderOnLoadTypeDefinitions;
    }
    return RENDER_ON_LOAD_FALLBACK_D_TS;
}

export async function getRenderOnLoadMonacoHintsWithFallback() {
    const sdkBundle = await loadSdkModule();
    if (Array.isArray(sdkBundle?.renderOnLoadHints) && sdkBundle.renderOnLoadHints.length > 0) {
        return sdkBundle.renderOnLoadHints.map(normalizeHint).filter((hint) => hint.label && hint.insertText);
    }
    return FALLBACK_RENDER_ON_LOAD_MONACO_HINTS.map(normalizeHint);
}

export async function listRenderOnLoadTemplatesWithFallback() {
    return loadSdkRenderOnLoadTemplates();
}

export async function getRenderOnLoadTemplateWithFallback(templateId) {
    const normalizedTemplateId = String(templateId || "").trim();
    if (!normalizedTemplateId) {
        return null;
    }
    const getter = window?.electron?.system?.getFdoSdkRenderOnLoadTemplate;
    if (typeof getter === "function") {
        try {
            const result = await getter(normalizedTemplateId);
            if (result && result.success !== false && result.template) {
                return normalizeRenderOnLoadTemplate(result.template);
            }
        } catch (_) {
            // Fall through to list lookup.
        }
    }
    const templates = await loadSdkRenderOnLoadTemplates();
    return templates.find((template) => template.id === normalizedTemplateId) || null;
}

export function applyRenderOnLoadActionsStrictMode(source = "", strict = true) {
    const normalizedSource = typeof source === "string" ? source : "";
    const callIndex = normalizedSource.indexOf("defineRenderOnLoadActions(");
    if (callIndex < 0) {
        return normalizedSource;
    }

    const optionsStart = normalizedSource.indexOf("{", callIndex);
    if (optionsStart < 0) {
        return normalizedSource;
    }

    let depth = 0;
    let optionsEnd = -1;
    for (let i = optionsStart; i < normalizedSource.length; i += 1) {
        if (normalizedSource[i] === "{") depth += 1;
        if (normalizedSource[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                optionsEnd = i;
                break;
            }
        }
    }
    if (optionsEnd < 0) {
        return normalizedSource;
    }

    const beforeOptions = normalizedSource.slice(0, optionsStart + 1);
    const optionsBody = normalizedSource.slice(optionsStart + 1, optionsEnd);
    const afterOptions = normalizedSource.slice(optionsEnd);
    const strictValue = strict ? "true" : "false";
    const strictPattern = /strict\s*:\s*(true|false)\s*,?/m;
    if (strictPattern.test(optionsBody)) {
        return `${beforeOptions}${optionsBody.replace(strictPattern, `strict: ${strictValue},`)}${afterOptions}`;
    }

    const indentMatch = optionsBody.match(/\n([ \t]*)[^\n]*$/);
    const indent = indentMatch ? indentMatch[1] : "  ";
    const insertion = `${optionsBody.trimEnd()}\n${indent}strict: ${strictValue},\n`;
    return `${beforeOptions}${insertion}${afterOptions}`;
}

export function isLikelyRenderOnLoadContext(model, position) {
    const modelPath = String(model?.uri?.path || model?.uri?.toString?.() || "").trim();
    if (ONLOAD_FILE_PATTERN.test(modelPath)) {
        return true;
    }

    const normalizedPosition = position && typeof position === "object"
        ? {
            lineNumber: Number(position.lineNumber || position.startLineNumber || 1),
            column: Number(position.column || position.startColumn || 1),
        }
        : {lineNumber: 1, column: 1};

    const source = model?.getValue?.();
    if (typeof source !== "string" || !source) {
        return false;
    }

    const offset = (() => {
        try {
            if (typeof model?.getOffsetAt === "function") {
                return model.getOffsetAt(normalizedPosition);
            }
        } catch (_) {
            // Ignore and fall back to prefix scan.
        }
        return source.length;
    })();
    const prefix = source.slice(0, Math.max(0, offset));
    const recentWindow = prefix.slice(Math.max(0, prefix.length - 2400));

    if (/renderOnLoad\s*\([^)]*\)\s*\{[\s\S]*$/m.test(recentWindow)) {
        return true;
    }
    if (/return\s+defineRenderOnLoad\s*\(/m.test(recentWindow)) {
        return true;
    }
    return false;
}

export function buildRenderOnLoadMigrationFix({model, range}) {
    if (!model?.getValue || !range) {
        return null;
    }
    const source = model.getValue();
    const selectedText = typeof model.getValueInRange === "function"
        ? model.getValueInRange(range)
        : "";
    const lineNumber = Number(range?.startLineNumber || 1);
    const lineContent = typeof model.getLineContent === "function"
        ? model.getLineContent(lineNumber)
        : "";

    if (!isLikelyRenderOnLoadContext(model, range)) {
        return null;
    }
    const returnLineMatch = lineContent.match(/^(\s*)return\s+(`[\s\S]*`|'[\s\S]*'|"[\s\S]*")\s*;?\s*$/);
    if (!returnLineMatch) {
        return null;
    }

    return {
        title: "Wrap raw renderOnLoad string with defineRenderOnLoad()",
        edit: {
            range: {
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: lineContent.length + 1,
            },
            text: [
                `${returnLineMatch[1]}return defineRenderOnLoad(() => {`,
                `${returnLineMatch[1]}    ${selectedText || "// Migrate the template body into typed callback logic"}`,
                `${returnLineMatch[1]}}, { language: "typescript" });`,
            ].join("\n"),
        },
    };
}

export function mapRenderOnLoadHintKind(monacoInstance, kind = "") {
    const CompletionItemKind = monacoInstance?.languages?.CompletionItemKind || {};
    switch (String(kind || "").trim().toLowerCase()) {
        case "function":
            return CompletionItemKind.Function;
        case "method":
            return CompletionItemKind.Method;
        case "keyword":
            return CompletionItemKind.Keyword;
        case "module":
            return CompletionItemKind.Module;
        case "property":
            return CompletionItemKind.Property;
        case "text":
            return CompletionItemKind.Text;
        case "variable":
            return CompletionItemKind.Variable;
        case "snippet":
        default:
            return CompletionItemKind.Snippet || CompletionItemKind.Function;
    }
}
