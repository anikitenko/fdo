import {HOST_WRITE_CAPABILITY, HOST_WRITE_CAPABILITY_LEGACY, toCanonicalCapabilityId} from "./pluginCapabilities";

const SCOPE_PREFIX_BY_BASE = Object.freeze({
    [HOST_WRITE_CAPABILITY]: "system.fs.scope.",
    [HOST_WRITE_CAPABILITY_LEGACY]: "system.fs.scope.",
    "system.network": "system.network.scope.",
    "system.process.exec": "system.process.scope.",
});

function getScopeCapabilityPrefix(scope = {}) {
    if (scope?.kind === "process") {
        return "system.process.scope.";
    }
    if (scope?.kind === "network") {
        return "system.network.scope.";
    }
    return "system.fs.scope.";
}

export function buildScopeCapabilities(scopePolicies = []) {
    const scopes = Array.isArray(scopePolicies) ? scopePolicies : [];
    return scopes.map((scope) => ({
        id: scope.scope,
        title: typeof scope.title === "string" ? scope.title : "",
        kind: scope.kind === "process" ? "process" : scope.kind === "network" ? "network" : "filesystem",
        category: typeof scope.category === "string" && scope.category.trim()
            ? scope.category.trim()
            : (scope.kind === "process" ? "Other Process Tools" : scope.kind === "network" ? "Network" : "Filesystem"),
        description: scope.description || "",
        fallback: scope.fallback === true,
        userDefined: scope.userDefined === true,
        capability: `${getScopeCapabilityPrefix(scope)}${scope.scope}`,
        baseCapability: scope.kind === "process" ? "system.process.exec" : scope.kind === "network" ? "system.network" : HOST_WRITE_CAPABILITY,
        allowedRoots: Array.isArray(scope.allowedRoots) ? scope.allowedRoots : [],
        allowedCwdRoots: Array.isArray(scope.allowedCwdRoots) ? scope.allowedCwdRoots : [],
        allowedOperationTypes: Array.isArray(scope.allowedOperationTypes) ? scope.allowedOperationTypes : [],
        allowedExecutables: Array.isArray(scope.allowedExecutables) ? scope.allowedExecutables : [],
        allowedEnvKeys: Array.isArray(scope.allowedEnvKeys) ? scope.allowedEnvKeys : [],
        allowedSchemes: Array.isArray(scope.allowedSchemes) ? scope.allowedSchemes : [],
        allowedHostPatterns: Array.isArray(scope.allowedHostPatterns) ? scope.allowedHostPatterns : [],
        allowedPorts: Array.isArray(scope.allowedPorts) ? scope.allowedPorts : [],
        allowedTransports: Array.isArray(scope.allowedTransports) ? scope.allowedTransports : [],
        additionalAllowedFirstArgs: Array.isArray(scope.additionalAllowedFirstArgs) ? scope.additionalAllowedFirstArgs : [],
        additionalAllowedFirstArgsByExecutable: (scope.additionalAllowedFirstArgsByExecutable && typeof scope.additionalAllowedFirstArgsByExecutable === "object")
            ? scope.additionalAllowedFirstArgsByExecutable
            : {},
        additionalAllowedLeadingOptions: Array.isArray(scope.additionalAllowedLeadingOptions) ? scope.additionalAllowedLeadingOptions : [],
        additionalAllowedLeadingOptionsByExecutable: (scope.additionalAllowedLeadingOptionsByExecutable && typeof scope.additionalAllowedLeadingOptionsByExecutable === "object")
            ? scope.additionalAllowedLeadingOptionsByExecutable
            : {},
        argumentPolicy: (scope.argumentPolicy && typeof scope.argumentPolicy === "object")
            ? scope.argumentPolicy
            : null,
        timeoutCeilingMs: Number.isFinite(scope.timeoutCeilingMs) ? scope.timeoutCeilingMs : null,
        requireConfirmation: scope.requireConfirmation !== false,
    }));
}

export function applyCapabilityToggle(previousCapabilities = [], {
    capability,
    checked,
    baseCapability = HOST_WRITE_CAPABILITY,
} = {}) {
    const normalizedCapability = toCanonicalCapabilityId(capability);
    const normalizedBaseCapability = toCanonicalCapabilityId(baseCapability);
    const effectiveBaseCapability = Object.prototype.hasOwnProperty.call(SCOPE_PREFIX_BY_BASE, normalizedCapability)
        ? normalizedCapability
        : normalizedBaseCapability;
    const current = Array.isArray(previousCapabilities) ? previousCapabilities : [];
    let next = checked
        ? [...new Set([...current, normalizedCapability])]
        : current.filter((item) => toCanonicalCapabilityId(item) !== normalizedCapability);

    if (normalizedCapability === effectiveBaseCapability && !checked) {
        const prefix = SCOPE_PREFIX_BY_BASE[effectiveBaseCapability] || "";
        next = prefix ? next.filter((item) => !item.startsWith(prefix)) : next;
    }

    return next;
}

export function hasCapabilitySelectionChanges(savedCapabilities = [], draftCapabilities = []) {
    const normalize = (list) => [...new Set(Array.isArray(list) ? list : [])].sort();
    return JSON.stringify(normalize(savedCapabilities)) !== JSON.stringify(normalize(draftCapabilities));
}

export function getSelectedScopeCapabilities(draftCapabilities = [], scopeCapabilities = []) {
    const scopeIds = new Set((Array.isArray(scopeCapabilities) ? scopeCapabilities : []).map((item) => item.capability));
    return (Array.isArray(draftCapabilities) ? draftCapabilities : [])
        .filter((capability) => scopeIds.has(capability));
}
