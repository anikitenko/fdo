import {isHostFallbackProcessScopeId} from "./processScopeCatalog";

const BASIC_TIER = Object.freeze({
    id: "basic-ui-data",
    title: "Basic UI/Data Plugin",
    description: "No privileged host actions granted. Intended for UI, storage, and non-privileged workflows.",
    intent: "none",
});

const SCOPED_OPERATOR_TIER = Object.freeze({
    id: "scoped-operator",
    title: "Scoped Operator Plugin",
    description: "Uses scoped host actions with broad capability plus narrow scope. Suitable for operator workflows with explicit approval and audit.",
    intent: "primary",
});

const HIGH_TRUST_TIER = Object.freeze({
    id: "high-trust-administrative",
    title: "High-Trust Administrative Plugin",
    description: "Uses higher-risk host power or broader fallback scopes. Requires stronger review, tighter policy scrutiny, and clear operator trust.",
    intent: "warning",
});

function normalizeCapabilities(capabilities = []) {
    return [...new Set((Array.isArray(capabilities) ? capabilities : []).filter((value) => typeof value === "string" && value.trim()))];
}

export function getPluginTrustTier(capabilities = []) {
    const normalized = normalizeCapabilities(capabilities);
    const capabilitySet = new Set(normalized);
    const processScopes = normalized
        .filter((capability) => capability.startsWith("system.process.scope."))
        .map((capability) => capability.slice("system.process.scope.".length));

    const hasPrivilegedBroad = capabilitySet.has("system.process.exec")
        || capabilitySet.has("system.hosts.write")
        || capabilitySet.has("system.clipboard.read")
        || capabilitySet.has("system.clipboard.write");
    const hasHighTrustSignals = capabilitySet.has("sudo.prompt")
        || capabilitySet.has("system.hosts.write")
        || capabilitySet.has("system.clipboard.read")
        || processScopes.some((scopeId) => isHostFallbackProcessScopeId(scopeId));

    if (hasHighTrustSignals) {
        return HIGH_TRUST_TIER;
    }
    if (hasPrivilegedBroad || processScopes.length > 0 || normalized.some((capability) => capability.startsWith("system.fs.scope."))) {
        return SCOPED_OPERATOR_TIER;
    }
    return BASIC_TIER;
}

export function summarizePrivilegedRuntime(events = []) {
    const ordered = (Array.isArray(events) ? events : []).slice().sort((left, right) => String(right?.timestamp || "").localeCompare(String(left?.timestamp || "")));
    const latestFailure = ordered.find((event) => event?.success === false) || null;
    return {
        totalEvents: ordered.length,
        successCount: ordered.filter((event) => event?.success === true).length,
        failureCount: ordered.filter((event) => event?.success === false).length,
        workflowCount: ordered.filter((event) => typeof event?.workflowId === "string" && event.workflowId.trim()).length,
        approvalDenialCount: ordered.filter((event) => String(event?.confirmationDecision || "") === "denied").length,
        latestFailureCode: latestFailure?.error?.code || "",
        latestFailureAt: latestFailure?.timestamp || "",
    };
}
