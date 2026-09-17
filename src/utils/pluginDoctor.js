import {evaluatePluginHandshakeCompatibility, getHostHandshakeExpectations} from "./pluginHandshakeCompatibility";

const DEFAULT_PLUGIN_DOCTOR_OPTIONS = Object.freeze({
    includeInfo: true,
    includeNotificationFindings: true,
});

function createFallbackPanelModel(report = null, options = {}) {
    if (!report || typeof report !== "object") {
        return null;
    }
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const maxPrioritizedFindings = Math.max(1, Number(options?.maxPrioritizedFindings || 8));
    const byCategory = new Map();
    findings.forEach((finding) => {
        const category = String(finding?.category || "other").trim() || "other";
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category).push(finding);
    });
    const sections = [...byCategory.entries()].map(([category, sectionFindings]) => {
        const counts = sectionFindings.reduce((acc, finding) => {
            const severity = String(finding?.severity || "").trim().toLowerCase();
            if (severity === "error") acc.error += 1;
            if (severity === "warning") acc.warning += 1;
            if (severity === "info") acc.info += 1;
            acc.total += 1;
            return acc;
        }, {total: 0, error: 0, warning: 0, info: 0});
        return {
            category,
            title: category.charAt(0).toUpperCase() + category.slice(1),
            counts,
            findings: sectionFindings,
        };
    });
    const counts = {
        total: findings.length,
        error: Number(report?.counts?.error || 0),
        warning: Number(report?.counts?.warning || 0),
        info: Number(report?.counts?.info || 0),
    };
    const prioritizedFindings = findings.slice(0, maxPrioritizedFindings);
    const blocking = prioritizedFindings.some((finding) => finding?.isBlocking === true || String(finding?.severity || "").trim().toLowerCase() === "error");
    return {
        pluginId: String(report?.pluginId || ""),
        generatedAt: String(report?.generatedAt || ""),
        status: String(report?.status || ""),
        summary: String(report?.summary || ""),
        blocking,
        counts,
        prioritizedFindings,
        sections,
    };
}

let cachedOptionalSdkModule;

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

export function normalizePluginDoctorOptions(options = {}) {
    return {
        includeInfo: options?.includeInfo !== false,
        includeNotificationFindings: options?.includeNotificationFindings !== false,
    };
}

export function createPluginDoctorPresentation(diagnostics, options = {}) {
    const normalizedOptions = normalizePluginDoctorOptions({
        ...DEFAULT_PLUGIN_DOCTOR_OPTIONS,
        ...options,
    });
    const sdkModule = getOptionalSdkModule();
    const handshakeOptions = getHostHandshakeExpectations();
    const handshakeCompatibility = evaluatePluginHandshakeCompatibility({
        handshake: diagnostics?.handshake || null,
        ...handshakeOptions,
    });

    if (
        diagnostics
        && typeof diagnostics === "object"
        && typeof sdkModule?.createPluginDoctorReport === "function"
    ) {
        try {
            let report = sdkModule.createPluginDoctorReport(diagnostics, {
                ...normalizedOptions,
                handshake: handshakeOptions,
            });
            if (!report || typeof report !== "object") {
                report = sdkModule.createPluginDoctorReport(diagnostics, normalizedOptions);
            }
            if (report && typeof report === "object") {
                let panelModel = null;
                if (typeof sdkModule?.createPluginDoctorPanelModel === "function") {
                    try {
                        panelModel = sdkModule.createPluginDoctorPanelModel(report, {
                            maxPrioritizedFindings: 8,
                        });
                    } catch (_) {
                        panelModel = null;
                    }
                }
                if (!panelModel) {
                    panelModel = createFallbackPanelModel(report, {
                        maxPrioritizedFindings: 8,
                    });
                }
                return {
                    mode: "doctor",
                    report,
                    panelModel,
                    options: normalizedOptions,
                    handshakeOptions,
                    handshakeCompatibility,
                };
            }
        } catch (_) {
            // Fall through to legacy mode.
        }
    }

    return {
        mode: "legacy",
        report: null,
        panelModel: null,
        options: normalizedOptions,
        handshakeOptions,
        handshakeCompatibility,
    };
}

export function groupPluginDoctorFindingsBySeverity(findings = []) {
    const groups = {
        error: [],
        warning: [],
        info: [],
    };

    (Array.isArray(findings) ? findings : []).forEach((finding) => {
        const severity = String(finding?.severity || "").trim().toLowerCase();
        if (severity === "error" || severity === "warning" || severity === "info") {
            groups[severity].push(finding);
        }
    });

    return groups;
}

export {DEFAULT_PLUGIN_DOCTOR_OPTIONS};
