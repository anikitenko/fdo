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
    }

    if (className && !new RegExp(`\\bnew\\s+${className}\\s*\\(`).test(content)) {
        errors.push(`/index.ts: plugin entry file must end with explicit instantiation like new ${className}();`);
    }

    const suspiciousWindowLines = containsNonUiWindowAccess(content);
    if (suspiciousWindowLines.length > 0) {
        warnings.push(`/index.ts: direct window.* access appears outside obvious UI/event code paths on line(s) ${suspiciousWindowLines.join(", ")}`);
    }

    return { warnings, errors };
}
