import {normalizeCapabilityList} from "./pluginCapabilities";

function normalizeList(values = []) {
    return normalizeCapabilityList(Array.isArray(values) ? values : []);
}

export function buildCapabilityDeclarationComparison({
    declared = [],
    granted = [],
    diagnosticsAvailable = false,
} = {}) {
    const normalizedDeclared = normalizeList(declared);
    const normalizedGranted = normalizeList(granted);
    const grantedSet = new Set(normalizedGranted);
    const declaredSet = new Set(normalizedDeclared);
    const missingDeclared = normalizedDeclared.filter((capability) => !grantedSet.has(capability));
    const undeclaredGranted = normalizedGranted.filter((capability) => !declaredSet.has(capability));
    const hasDeclaration = normalizedDeclared.length > 0;

    return {
        available: diagnosticsAvailable || hasDeclaration || normalizedGranted.length > 0,
        hasDeclaration,
        declared: normalizedDeclared,
        granted: normalizedGranted,
        missingDeclared,
        undeclaredGranted,
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
            summary: `Host grants ${undeclaredCount} ${undeclaredCount === 1 ? "capability" : "capabilities"}, but the plugin did not declare its intent via declareCapabilities().`,
        };
    }

    if (missingCount > 0) {
        return {
            status: "missing",
            intent: "warning",
            title: "Declared capability gaps",
            summary: `Plugin declared ${declaredCount} ${declaredCount === 1 ? "capability" : "capabilities"} and is still missing ${missingCount}.`,
        };
    }

    if (undeclaredCount > 0) {
        return {
            status: "extra-grants",
            intent: "primary",
            title: "Declared intent with extra grants",
            summary: `Declared capabilities are satisfied, but ${undeclaredCount} granted ${undeclaredCount === 1 ? "capability" : "capabilities"} are not declared by the plugin.`,
        };
    }

    return {
        status: "aligned",
        intent: "success",
        title: "Declared and granted aligned",
        summary: hasDeclaration
            ? `Declared capability intent matches current grants (${declaredCount} total).`
            : "Plugin does not declare capabilities and currently has no granted privileged capabilities.",
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
    });
}
