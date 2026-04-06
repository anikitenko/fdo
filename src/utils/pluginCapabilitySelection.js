const SCOPE_PREFIX_BY_BASE = Object.freeze({
    "system.hosts.write": "system.fs.scope.",
    "system.process.exec": "system.process.scope.",
});

function getScopeCapabilityPrefix(scope = {}) {
    return scope?.kind === "process"
        ? "system.process.scope."
        : "system.fs.scope.";
}

export function buildScopeCapabilities(scopePolicies = []) {
    const scopes = Array.isArray(scopePolicies) ? scopePolicies : [];
    return scopes.map((scope) => ({
        id: scope.scope,
        kind: scope.kind === "process" ? "process" : "filesystem",
        description: scope.description || "",
        capability: `${getScopeCapabilityPrefix(scope)}${scope.scope}`,
        baseCapability: scope.kind === "process" ? "system.process.exec" : "system.hosts.write",
        allowedRoots: Array.isArray(scope.allowedRoots) ? scope.allowedRoots : [],
        allowedCwdRoots: Array.isArray(scope.allowedCwdRoots) ? scope.allowedCwdRoots : [],
        allowedOperationTypes: Array.isArray(scope.allowedOperationTypes) ? scope.allowedOperationTypes : [],
        allowedExecutables: Array.isArray(scope.allowedExecutables) ? scope.allowedExecutables : [],
        allowedEnvKeys: Array.isArray(scope.allowedEnvKeys) ? scope.allowedEnvKeys : [],
        timeoutCeilingMs: Number.isFinite(scope.timeoutCeilingMs) ? scope.timeoutCeilingMs : null,
        requireConfirmation: scope.requireConfirmation !== false,
    }));
}

export function applyCapabilityToggle(previousCapabilities = [], {
    capability,
    checked,
    baseCapability = "system.hosts.write",
} = {}) {
    const effectiveBaseCapability = Object.prototype.hasOwnProperty.call(SCOPE_PREFIX_BY_BASE, capability)
        ? capability
        : baseCapability;
    const current = Array.isArray(previousCapabilities) ? previousCapabilities : [];
    let next = checked
        ? [...new Set([...current, capability])]
        : current.filter((item) => item !== capability);

    if (capability === effectiveBaseCapability && !checked) {
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
