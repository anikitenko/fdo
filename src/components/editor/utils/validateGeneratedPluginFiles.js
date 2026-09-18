import {IconNames} from "@blueprintjs/icons";

const BLUEPRINT_ICON_SET = new Set(
    Object.values(IconNames)
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase())
);

function normalizeLineEndings(value = "") {
    return String(value || "").replace(/\r\n/g, "\n");
}

function findPluginEntryFile(files = []) {
    return files.find((file) => file?.path === "/index.ts")
        || files.find((file) => file?.path?.endsWith("/index.ts"))
        || files.find((file) => /\bclass\s+\w+\s+extends\s+FDO[_]?SDK\b/.test(file?.content || ""));
}

function extractPluginClassName(content = "") {
    const match = String(content || "").match(/\bclass\s+([A-Za-z_]\w*)\s+extends\s+FDO[_]?SDK\b/);
    return match?.[1] || null;
}

function extractMetadataIconLiteral(content = "") {
    const match = String(content || "").match(/\bicon\s*:\s*["'`]([^"'`]+)["'`]/);
    return match?.[1] || null;
}

function looksLikeCustomIconAsset(value = "") {
    return /[\\/]|\.png\b|\.svg\b|\.ico\b|\.jpg\b|\.jpeg\b|\.webp\b|\.gif\b/i.test(String(value || ""));
}

function containsNonUiWindowAccess(content = "") {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split("\n");
    const suspicious = [];

    lines.forEach((line, index) => {
        if (!/window\./.test(line)) return;
        if (/onClick|onclick|addEventListener|=>/.test(line)) {
            return;
        }
        suspicious.push(index + 1);
    });

    return suspicious;
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
    const backendRequestPath = uiFiles.find((file) => /\bwindow\.createBackendReq\s*\(/.test(file?.content || ""))?.path
        || primaryUiPath;
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
    if (/\bwindow\.createBackendReq\s*\(/.test(source) && !/\bwindow\.createBackendReq\s*\(\s*["']UI_MESSAGE["']\s*,\s*\{[\s\S]{0,600}\bhandler\s*:[\s\S]{0,600}\bcontent\s*:/.test(source)) {
        errors.push(`${backendRequestPath}: window.createBackendReq must call "UI_MESSAGE" and pass an object with handler and content. Example: window.createBackendReq("UI_MESSAGE", {handler: "myHandler", content: {...}}).`);
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
            errors.push(`${file.path || "/render.tsx"}: React JSX is unsupported in plugin workspace files. Use DOM.createElement(...) or DOMText/DOMNested helpers and pass their rendered HTML string to dom.renderHTML(...); use "class", not JSX className.`);
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
    const bindingPath = uiFiles.find((file) => /\baddEventListener\s*\(\s*["']submit["']/.test(file?.content || ""))?.path || "/render.tsx";
    errors.push(`${bindingPath}: backend UI actions must use defineRenderOnLoadActions(...) with a click binding on a type="button" control. Do not attach a manual form submit listener in the plugin iframe.`);
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

export function validateGeneratedPluginFiles(files = []) {
    const warnings = [];
    const errors = [];

    files.forEach((file) => {
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

    const pluginEntry = findPluginEntryFile(files);
    if (!pluginEntry) {
        return { warnings, errors };
    }

    const content = normalizeLineEndings(pluginEntry.content);
    const className = extractPluginClassName(content);
    const metadataIcon = extractMetadataIconLiteral(content);

    if (metadataIcon && looksLikeCustomIconAsset(metadataIcon)) {
        errors.push(`/index.ts: metadata.icon must use a BlueprintJS v6 icon name string, not a custom asset path (${metadataIcon})`);
    } else if (metadataIcon && !BLUEPRINT_ICON_SET.has(metadataIcon.trim().toLowerCase())) {
        errors.push(`/index.ts: metadata.icon "${metadataIcon}" is not a valid BlueprintJS v6 icon name. Use a verified icon such as "data-search" or "cog".`);
    }

    if (className && !new RegExp(`\\bnew\\s+${className}\\s*\\(`).test(content)) {
        errors.push(`/index.ts: plugin entry file must end with explicit instantiation like new ${className}();`);
    }

    const suspiciousWindowLines = containsNonUiWindowAccess(content);
    if (suspiciousWindowLines.length > 0) {
        warnings.push(`/index.ts: direct window.* access appears outside obvious UI/event code paths on line(s) ${suspiciousWindowLines.join(", ")}`);
    }

    validateInjectedUiFoundation(files, errors);
    validatePluginRenderingSyntax(files, errors);
    validatePluginDomHelperUsage(files, errors);
    validateReservedHostBindingMarkers(files, errors);
    validateBackendFormSubmitBindings(files, errors);
    validateUiMessageHandlerPayloadShape(files, errors);

    return { warnings, errors };
}
