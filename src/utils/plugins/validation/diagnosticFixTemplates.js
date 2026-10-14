let cachedOptionalSdkModule;
const reportedUnknownTemplateKeys = new Set();
const LOCAL_DIAGNOSTIC_FIX_TEMPLATES = Object.freeze({
    PROCESS_SPAWN_ENOENT: {
        title: "Install or re-point executable",
        summary: "The requested executable is not available at an allowlisted host path.",
        exactFix: "Install the missing tool or configure the process scope allowlist to a valid executable path.",
        steps: [
            "Install the requested executable on the host.",
            "Verify the executable path exists on the host machine.",
            "Update the plugin process scope allowlist to include the executable path.",
        ],
        docsLinks: [],
    },
    PROCESS_EXIT_NON_ZERO: {
        title: "Resolve process exit failures",
        summary: "The process executed but exited with a non-zero status.",
        exactFix: "Inspect process stderr/stdout and update plugin handling for expected non-zero outcomes.",
        steps: [
            "Capture stderr/stdout from the host process result.",
            "Verify command arguments, cwd, and environment inputs.",
            "Map expected non-zero exit statuses to explicit remediation in plugin UX.",
        ],
        docsLinks: [],
    },
    HANDSHAKE_API_INCOMPATIBLE: {
        title: "Align SDK and host API majors",
        summary: "Plugin and host API major versions are incompatible.",
        exactFix: "Upgrade the plugin SDK or host so both sides report the same API major version.",
        steps: [
            "Check diagnostics.handshake.apiVersion in the plugin runtime.",
            "Compare host expected API major with plugin reported API major.",
            "Upgrade the plugin SDK or host to align API majors.",
        ],
        docsLinks: [],
    },
    HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH: {
        title: "Align capability schema versions",
        summary: "Capability schema versions differ between plugin runtime and host.",
        exactFix: "Upgrade plugin SDK or host capability schema to the same version.",
        steps: [
            "Check diagnostics.handshake.capabilitySchemaVersion.",
            "Align plugin SDK and host capability schema versions.",
        ],
        docsLinks: [],
    },
    HANDSHAKE_FEATURE_FLAG_MISSING: {
        title: "Enable required SDK feature flags",
        summary: "The plugin runtime is missing feature flags required by host UX paths.",
        exactFix: "Upgrade SDK runtime or enable required handshake feature flags in the plugin environment.",
        steps: [
            "Review handshake featureFlags reported by diagnostics.",
            "Enable the missing feature flag(s) required by the host.",
        ],
        docsLinks: [],
    },
});

function getOptionalSdkModule() {
    if (cachedOptionalSdkModule !== undefined) {
        return cachedOptionalSdkModule;
    }

    try {
        cachedOptionalSdkModule = typeof __non_webpack_require__ === "function"
            ? __non_webpack_require__("@anikitenko/fdo-sdk")
            : null;
    } catch (_) {
        cachedOptionalSdkModule = null;
    }

    return cachedOptionalSdkModule;
}

export function __setOptionalSdkModuleForTests(value) {
    cachedOptionalSdkModule = value;
}

export function __resetReportedUnknownFixTemplatesForTests() {
    reportedUnknownTemplateKeys.clear();
}

function normalizeCode(code = "") {
    return String(code || "").trim().toUpperCase();
}

function normalizeSteps(steps = []) {
    if (!Array.isArray(steps)) {
        return [];
    }
    return steps
        .map((step) => String(step || "").trim())
        .filter(Boolean);
}

function normalizeDocsLinks(links = []) {
    if (!Array.isArray(links)) {
        return [];
    }
    return links
        .map((entry) => {
            if (typeof entry === "string") {
                const url = entry.trim();
                if (!url) return null;
                return {title: url, url};
            }
            if (!entry || typeof entry !== "object") {
                return null;
            }
            const url = String(entry.url || entry.href || "").trim();
            if (!url) return null;
            const title = String(entry.title || entry.label || url).trim();
            return {title: title || url, url};
        })
        .filter(Boolean);
}

function normalizeTemplate(template = null) {
    if (!template || typeof template !== "object") {
        return null;
    }

    const title = String(template.title || "").trim();
    const summary = String(template.summary || "").trim();
    const exactFix = String(template.exactFix || "").trim();
    const steps = normalizeSteps(template.steps);
    const docsLinks = normalizeDocsLinks(template.docsLinks || template.docs || template.links);

    if (!title && !summary && !exactFix && steps.length === 0 && docsLinks.length === 0) {
        return null;
    }

    return {
        title,
        summary,
        exactFix,
        steps,
        docsLinks,
    };
}

function getTemplateCoverageList(sdkModule = null) {
    if (!sdkModule || typeof sdkModule.listDiagnosticFixTemplates !== "function") {
        return [];
    }
    try {
        const result = sdkModule.listDiagnosticFixTemplates();
        if (!Array.isArray(result)) {
            return [];
        }
        return result
            .map((entry) => {
                if (typeof entry === "string") {
                    return normalizeCode(entry);
                }
                if (entry && typeof entry === "object") {
                    return normalizeCode(entry.code || entry.id);
                }
                return "";
            })
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function reportUnknownTemplateCode(code = "", context = "", sdkModule = null) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode || !sdkModule || typeof sdkModule.getDiagnosticFixTemplate !== "function") {
        return;
    }
    const contextLabel = String(context || "unknown-context").trim() || "unknown-context";
    const reportKey = `${contextLabel}:${normalizedCode}`;
    if (reportedUnknownTemplateKeys.has(reportKey)) {
        return;
    }
    reportedUnknownTemplateKeys.add(reportKey);
    const knownCodes = getTemplateCoverageList(sdkModule);
    console.warn("[DIAGNOSTIC_FIX_TEMPLATE_MISSING]", JSON.stringify({
        context: contextLabel,
        code: normalizedCode,
        knownTemplateCount: knownCodes.length,
        sampleKnownCodes: knownCodes.slice(0, 10),
    }));
}

export function getDiagnosticFixTemplateForCode(code = "", options = {}) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
        return null;
    }
    const sdkModule = getOptionalSdkModule();
    if (!sdkModule || typeof sdkModule.getDiagnosticFixTemplate !== "function") {
        return null;
    }

    let template = null;
    try {
        template = sdkModule.getDiagnosticFixTemplate(normalizedCode);
        if (!template && normalizedCode !== String(code || "").trim()) {
            template = sdkModule.getDiagnosticFixTemplate(String(code || "").trim());
        }
    } catch (_) {
        template = null;
    }

    const normalizedTemplate = normalizeTemplate(template)
        || normalizeTemplate(LOCAL_DIAGNOSTIC_FIX_TEMPLATES[normalizedCode] || null);
    if (!normalizedTemplate) {
        reportUnknownTemplateCode(normalizedCode, options?.context, sdkModule);
        return null;
    }
    return normalizedTemplate;
}

export function formatDiagnosticExactFixForCode(code = "", fallbackTemplate = null) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
        return "";
    }
    const sdkModule = getOptionalSdkModule();
    if (sdkModule && typeof sdkModule.formatDiagnosticExactFix === "function") {
        try {
            const formatted = sdkModule.formatDiagnosticExactFix(normalizedCode);
            if (typeof formatted === "string" && formatted.trim()) {
                return formatted.trim();
            }
        } catch (_) {
            // Fall through to template exactFix.
        }
    }

    return String(fallbackTemplate?.exactFix || "").trim();
}
