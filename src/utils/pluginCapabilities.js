import {getGrantedNetworkScopePolicies, isNetworkScopeCapabilityId} from "./networkScopeRegistry";

export const HOST_WRITE_CAPABILITY = "system.host.write";
export const HOST_WRITE_CAPABILITY_LEGACY = "system.hosts.write";
export const STORAGE_CAPABILITY = "storage";
export const STORAGE_JSON_CAPABILITY = "storage.json";
export const NETWORK_CAPABILITY = "system.network";
export const NETWORK_HTTPS_CAPABILITY = "system.network.https";
export const NETWORK_HTTP_CAPABILITY = "system.network.http";
export const NETWORK_WEBSOCKET_CAPABILITY = "system.network.websocket";
export const NETWORK_TCP_CAPABILITY = "system.network.tcp";
export const NETWORK_UDP_CAPABILITY = "system.network.udp";
export const NETWORK_DNS_CAPABILITY = "system.network.dns";

const CAPABILITY_ALIAS_TO_CANONICAL = Object.freeze({
    [HOST_WRITE_CAPABILITY_LEGACY]: HOST_WRITE_CAPABILITY,
});

const CANONICAL_TO_ALIAS = Object.freeze(
    Object.entries(CAPABILITY_ALIAS_TO_CANONICAL).reduce((acc, [alias, canonical]) => {
        acc[canonical] = Array.isArray(acc[canonical]) ? [...acc[canonical], alias] : [alias];
        return acc;
    }, {})
);

export const PLUGIN_CAPABILITY_DEFINITIONS = Object.freeze({
    [STORAGE_CAPABILITY]: Object.freeze({
        description: "Allows storage capability family grants for plugin persistence features.",
    }),
    [STORAGE_JSON_CAPABILITY]: Object.freeze({
        description: "Allows persistent JSON storage usage in SDK.",
    }),
    [NETWORK_CAPABILITY]: Object.freeze({
        description: "Allows network capability family grants for plugin connectivity features.",
    }),
    [NETWORK_HTTPS_CAPABILITY]: Object.freeze({
        description: "Allows outbound HTTPS requests through host-approved runtime network APIs.",
    }),
    [NETWORK_HTTP_CAPABILITY]: Object.freeze({
        description: "Allows outbound plaintext HTTP requests through host-approved runtime network APIs.",
    }),
    [NETWORK_WEBSOCKET_CAPABILITY]: Object.freeze({
        description: "Allows outbound WebSocket connections through host-approved runtime network APIs.",
    }),
    [NETWORK_TCP_CAPABILITY]: Object.freeze({
        description: "Allows raw TCP socket access through runtime network APIs.",
    }),
    [NETWORK_UDP_CAPABILITY]: Object.freeze({
        description: "Allows raw UDP socket access through runtime network APIs.",
    }),
    [NETWORK_DNS_CAPABILITY]: Object.freeze({
        description: "Allows direct DNS resolution APIs through runtime network modules.",
    }),
    [HOST_WRITE_CAPABILITY]: Object.freeze({
        description: "Allows host-mediated privileged filesystem and host-side write actions.",
    }),
    "system.process.exec": Object.freeze({
        description: "Allows host-mediated scoped process execution with explicit host-side policy checks.",
    }),
    "system.clipboard.read": Object.freeze({
        description: "Allows host-mediated clipboard reads through the trusted host boundary.",
    }),
    "system.clipboard.write": Object.freeze({
        description: "Allows host-mediated clipboard writes through the trusted host boundary.",
    }),
    "sudo.prompt": Object.freeze({
        description: "Allows elevated operations and privileged process modules.",
        grants: Object.freeze({
            modules: Object.freeze(["@expo/sudo-prompt", "child_process", "node:child_process"]),
        }),
    }),
});

export const KNOWN_PLUGIN_CAPABILITIES = Object.freeze(Object.keys(PLUGIN_CAPABILITY_DEFINITIONS));

export function toCanonicalCapabilityId(capability = "") {
    const normalizedCapability = String(capability || "").trim();
    if (!normalizedCapability) {
        return "";
    }
    return CAPABILITY_ALIAS_TO_CANONICAL[normalizedCapability] || normalizedCapability;
}

export function getCapabilityAliases(canonicalCapability = "") {
    const normalizedCanonicalCapability = toCanonicalCapabilityId(canonicalCapability);
    if (!normalizedCanonicalCapability) {
        return [];
    }
    return CANONICAL_TO_ALIAS[normalizedCanonicalCapability] || [];
}

export function hasCapability(capabilities = [], targetCapability = "") {
    const normalizedTargetCapability = toCanonicalCapabilityId(targetCapability);
    if (!normalizedTargetCapability) {
        return false;
    }
    return (Array.isArray(capabilities) ? capabilities : [])
        .some((capability) => toCanonicalCapabilityId(capability) === normalizedTargetCapability);
}

export function normalizeCapabilityList(input) {
    const requested = Array.isArray(input)
        ? input.filter((entry) => typeof entry === "string")
        : [];
    const unique = [...new Set(
        requested
            .map((entry) => toCanonicalCapabilityId(entry))
            .filter(Boolean)
    )];
    return unique.filter((capability) => (
        KNOWN_PLUGIN_CAPABILITIES.includes(capability)
        || capability.startsWith("system.fs.scope.")
        || capability.startsWith("system.process.scope.")
        || isNetworkScopeCapabilityId(capability)
    ));
}

export function buildRuntimeSecurityPolicy(grantedCapabilities = []) {
    const granted = normalizeCapabilityList(grantedCapabilities);
    const grantedSet = new Set(granted);

    const privilegedModules = new Set();
    for (const [capability, definition] of Object.entries(PLUGIN_CAPABILITY_DEFINITIONS)) {
        if (grantedSet.has(capability)) {
            continue;
        }
        const modules = definition?.grants?.modules || [];
        modules.forEach((entry) => privilegedModules.add(entry));
    }

    return {
        grantedCapabilities: granted,
        blockedModules: [...privilegedModules].sort((left, right) => left.localeCompare(right)),
        networkAccess: Object.freeze({
            https: grantedSet.has(NETWORK_HTTPS_CAPABILITY),
            http: grantedSet.has(NETWORK_HTTP_CAPABILITY),
            websocket: grantedSet.has(NETWORK_WEBSOCKET_CAPABILITY),
            tcp: grantedSet.has(NETWORK_TCP_CAPABILITY),
            udp: grantedSet.has(NETWORK_UDP_CAPABILITY),
            dns: grantedSet.has(NETWORK_DNS_CAPABILITY),
        }),
        networkScopes: Object.freeze(getGrantedNetworkScopePolicies(granted)),
    };
}
