import {normalizeCapabilityList} from "./pluginCapabilities";

function normalizeList(values = []) {
    return normalizeCapabilityList(Array.isArray(values) ? values : []);
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

function describeCapabilityWithFallback(capability = "") {
    const sdkModule = getOptionalSdkModule();
    const normalizedCapability = String(capability || "").trim();
    if (!normalizedCapability) {
        return {
            capability: "",
            label: "",
            description: "",
            category: "unknown",
        };
    }

    if (typeof sdkModule?.describeCapability === "function") {
        try {
            const descriptor = sdkModule.describeCapability(normalizedCapability);
            if (descriptor && typeof descriptor === "object") {
                return {
                    capability: typeof descriptor.capability === "string" ? descriptor.capability : normalizedCapability,
                    label: typeof descriptor.label === "string" && descriptor.label.trim()
                        ? descriptor.label
                        : normalizedCapability,
                    description: typeof descriptor.description === "string" ? descriptor.description : "",
                    category: typeof descriptor.category === "string" ? descriptor.category : "unknown",
                };
            }
        } catch (_) {
            // Fall through to a deterministic local descriptor.
        }
    }

    return {
        capability: normalizedCapability,
        label: normalizedCapability,
        description: "",
        category: "unknown",
    };
}

function runCapabilityPreflightWithFallback({
    declared = [],
    granted = [],
    action = "plugin privileged actions",
} = {}) {
    const sdkModule = getOptionalSdkModule();
    if (typeof sdkModule?.runCapabilityPreflight !== "function") {
        return null;
    }
    try {
        const report = sdkModule.runCapabilityPreflight({
            declared,
            granted,
            action,
        });
        return report && typeof report === "object" ? report : null;
    } catch (_) {
        return null;
    }
}

export function buildCapabilityDeclarationComparison({
    declared = [],
    granted = [],
    diagnosticsAvailable = false,
    action = "plugin privileged actions",
} = {}) {
    const normalizedDeclared = normalizeList(declared);
    const normalizedGranted = normalizeList(granted);
    const grantedSet = new Set(normalizedGranted);
    const declaredSet = new Set(normalizedDeclared);
    const missingDeclared = normalizedDeclared.filter((capability) => !grantedSet.has(capability));
    const undeclaredGranted = normalizedGranted.filter((capability) => !declaredSet.has(capability));
    const hasDeclaration = normalizedDeclared.length > 0;
    const preflight = runCapabilityPreflightWithFallback({
        declared: normalizedDeclared,
        granted: normalizedGranted,
        action,
    });
    const missingDiagnostics = Array.isArray(preflight?.missing) && preflight.missing.length > 0
        ? preflight.missing
        : missingDeclared.map((capability) => {
            const descriptor = describeCapabilityWithFallback(capability);
            return {
                ...descriptor,
                action,
                requiredCapabilities: [capability],
                missingPrerequisites: [capability],
                grantedPrerequisites: [],
                remediation: `Grant "${capability}" in Manage Plugins -> Capabilities.`,
            };
        });
    const undeclaredGrantedDetails = Array.isArray(preflight?.undeclaredGranted) && preflight.undeclaredGranted.length > 0
        ? preflight.undeclaredGranted
        : undeclaredGranted.map((capability) => describeCapabilityWithFallback(capability));
    const remediations = Array.isArray(preflight?.remediations)
        ? preflight.remediations.filter((entry) => typeof entry === "string" && entry.trim())
        : [];

    return {
        available: diagnosticsAvailable || hasDeclaration || normalizedGranted.length > 0,
        hasDeclaration,
        action,
        declared: normalizedDeclared,
        granted: normalizedGranted,
        missingDeclared,
        undeclaredGranted,
        missingDiagnostics,
        undeclaredGrantedDetails,
        remediations,
        summaryText: typeof preflight?.summary === "string" ? preflight.summary : "",
        preflight,
    };
}

export function buildCapabilityDeclarationSummary(comparison = {}) {
    const declaredCount = Array.isArray(comparison?.declared) ? comparison.declared.length : 0;
    const missingCount = Array.isArray(comparison?.missingDeclared) ? comparison.missingDeclared.length : 0;
    const undeclaredCount = Array.isArray(comparison?.undeclaredGranted) ? comparison.undeclaredGranted.length : 0;
    const hasDeclaration = comparison?.hasDeclaration === true;

    if (!comparison?.available) {
        return {
            status: "unavailable",
            intent: "none",
            title: "Capability intent unavailable",
            summary: "Load the plugin to inspect its declareCapabilities() manifest.",
        };
    }

    if (!hasDeclaration && undeclaredCount > 0) {
        return {
            status: "undeclared",
            intent: "warning",
            title: "No declared capability manifest",
            summary: comparison?.summaryText || `Host grants ${undeclaredCount} ${undeclaredCount === 1 ? "capability" : "capabilities"}, but the plugin did not declare its intent via declareCapabilities().`,
        };
    }

    if (missingCount > 0) {
        return {
            status: "missing",
            intent: "warning",
            title: "Declared capability gaps",
            summary: comparison?.summaryText || `Plugin declared ${declaredCount} ${declaredCount === 1 ? "capability" : "capabilities"} and is still missing ${missingCount}.`,
        };
    }

    if (undeclaredCount > 0) {
        return {
            status: "extra-grants",
            intent: "primary",
            title: "Declared intent with extra grants",
            summary: comparison?.summaryText || `Declared capabilities are satisfied, but ${undeclaredCount} granted ${undeclaredCount === 1 ? "capability" : "capabilities"} are not declared by the plugin.`,
        };
    }

    return {
        status: "aligned",
        intent: "success",
        title: "Declared and granted aligned",
        summary: comparison?.summaryText || (hasDeclaration
            ? `Declared capability intent matches current grants (${declaredCount} total).`
            : "Plugin does not declare capabilities and currently has no granted privileged capabilities."),
    };
}

export function extractCapabilityDeclarationComparison(diagnostics = null, grantedCapabilities = []) {
    const diagnosticsDeclaration = diagnostics?.capabilities?.declaration;
    const grantedFromDiagnostics = diagnostics?.capabilities?.permissions?.granted;
    const hasGrantedCapabilitiesArg = Array.isArray(grantedCapabilities);
    return buildCapabilityDeclarationComparison({
        declared: diagnosticsDeclaration?.declared || [],
        granted: hasGrantedCapabilitiesArg
            ? grantedCapabilities
            : (Array.isArray(grantedFromDiagnostics) ? grantedFromDiagnostics : []),
        diagnosticsAvailable: !!(diagnostics && typeof diagnostics === "object"),
        action: "plugin privileged actions",
    });
}
