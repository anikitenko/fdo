const NETWORK_SCOPE_CAPABILITY_PREFIX = "system.network.scope.";

export const BUILTIN_NETWORK_SCOPE_POLICIES = Object.freeze({
    "public-web-secure": Object.freeze({
        scope: "public-web-secure",
        kind: "network",
        category: "Network",
        description: "Allows secure outbound web traffic to public HTTPS and WSS endpoints.",
        allowedSchemes: Object.freeze(["https", "wss"]),
        allowedHostPatterns: Object.freeze(["*"]),
        allowedPorts: Object.freeze(["*"]),
        allowedTransports: Object.freeze(["fetch", "xhr", "eventsource", "websocket"]),
        requireConfirmation: false,
    }),
    "public-web-legacy": Object.freeze({
        scope: "public-web-legacy",
        kind: "network",
        category: "Network",
        description: "Allows legacy outbound web traffic, including plaintext HTTP and WS. Use only when HTTPS/WSS is not possible.",
        allowedSchemes: Object.freeze(["http", "https", "ws", "wss"]),
        allowedHostPatterns: Object.freeze(["*"]),
        allowedPorts: Object.freeze(["*"]),
        allowedTransports: Object.freeze(["fetch", "xhr", "eventsource", "websocket"]),
        requireConfirmation: true,
        fallback: true,
    }),
    "loopback-dev": Object.freeze({
        scope: "loopback-dev",
        kind: "network",
        category: "Network",
        description: "Allows connections only to loopback and localhost targets for local development services.",
        allowedSchemes: Object.freeze(["http", "https", "ws", "wss", "tcp", "udp", "dns"]),
        allowedHostPatterns: Object.freeze(["localhost", "127.0.0.1", "::1", "[::1]"]),
        allowedPorts: Object.freeze(["*"]),
        allowedTransports: Object.freeze(["fetch", "xhr", "eventsource", "websocket", "tcp", "udp", "dns"]),
        requireConfirmation: false,
    }),
});

function normalizeStringList(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean))];
}

export function isNetworkScopeCapabilityId(capabilityId = "") {
    return String(capabilityId || "").trim().startsWith(NETWORK_SCOPE_CAPABILITY_PREFIX);
}

export function getNetworkScopeCapabilityId(scopeId = "") {
    const normalizedScopeId = String(scopeId || "").trim();
    return normalizedScopeId ? `${NETWORK_SCOPE_CAPABILITY_PREFIX}${normalizedScopeId}` : "";
}

export function getAllHostNetworkScopePolicies() {
    return BUILTIN_NETWORK_SCOPE_POLICIES;
}

export function getGrantedNetworkScopePolicies(grantedCapabilities = []) {
    const grantedSet = new Set((Array.isArray(grantedCapabilities) ? grantedCapabilities : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean));
    return Object.values(BUILTIN_NETWORK_SCOPE_POLICIES)
        .filter((policy) => grantedSet.has(getNetworkScopeCapabilityId(policy.scope)));
}

function hostnameMatchesPattern(hostname = "", pattern = "") {
    const normalizedHostname = String(hostname || "").trim().toLowerCase();
    const normalizedPattern = String(pattern || "").trim().toLowerCase();
    if (!normalizedHostname || !normalizedPattern) {
        return false;
    }
    if (normalizedPattern === "*") {
        return true;
    }
    if (normalizedPattern.startsWith("*.")) {
        const suffix = normalizedPattern.slice(1);
        return normalizedHostname.endsWith(suffix) && normalizedHostname !== suffix.slice(1);
    }
    return normalizedHostname === normalizedPattern;
}

function portMatches(port, allowedPorts = []) {
    const normalizedAllowedPorts = normalizeStringList(allowedPorts);
    if (normalizedAllowedPorts.includes("*")) {
        return true;
    }
    const normalizedPort = port == null || port === ""
        ? ""
        : String(Number(port) || "").trim();
    return normalizedPort ? normalizedAllowedPorts.includes(normalizedPort) : false;
}

export function isNetworkTargetAllowed(target = {}, scopePolicies = []) {
    const transport = String(target?.transport || "").trim().toLowerCase();
    const scheme = String(target?.scheme || "").trim().toLowerCase();
    const hostname = String(target?.hostname || "").trim().toLowerCase();
    const port = target?.port;
    if (!transport || !hostname) {
        return false;
    }

    return (Array.isArray(scopePolicies) ? scopePolicies : []).some((policy) => {
        const allowedTransports = normalizeStringList(policy?.allowedTransports).map((value) => value.toLowerCase());
        const allowedSchemes = normalizeStringList(policy?.allowedSchemes).map((value) => value.toLowerCase());
        const allowedHostPatterns = normalizeStringList(policy?.allowedHostPatterns);
        const allowedPorts = normalizeStringList(policy?.allowedPorts);

        if (allowedTransports.length > 0 && !allowedTransports.includes(transport)) {
            return false;
        }
        if (scheme && allowedSchemes.length > 0 && !allowedSchemes.includes(scheme)) {
            return false;
        }
        if (allowedHostPatterns.length > 0 && !allowedHostPatterns.some((pattern) => hostnameMatchesPattern(hostname, pattern))) {
            return false;
        }
        if ((transport === "tcp" || transport === "udp" || scheme) && allowedPorts.length > 0 && !portMatches(port, allowedPorts)) {
            return false;
        }
        return true;
    });
}
