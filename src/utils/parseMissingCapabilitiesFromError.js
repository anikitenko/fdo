import {getCapabilityPresentation} from "./capabilityPresentation";
import {isCuratedOperatorProcessScopeId, isHostFallbackProcessScopeId} from "./processScopeCatalog";
import {
    HOST_WRITE_CAPABILITY,
    HOST_WRITE_CAPABILITY_LEGACY,
    NETWORK_CAPABILITY,
    NETWORK_DNS_CAPABILITY,
    NETWORK_HTTPS_CAPABILITY,
    NETWORK_HTTP_CAPABILITY,
    NETWORK_TCP_CAPABILITY,
    NETWORK_UDP_CAPABILITY,
    NETWORK_WEBSOCKET_CAPABILITY,
    toCanonicalCapabilityId
} from "./pluginCapabilities";

function normalizeCapabilityId(value) {
    return toCanonicalCapabilityId(typeof value === "string" ? value.trim() : "");
}

function isCapabilityId(value) {
    return typeof value === "string" && /^(system|storage|sudo)\.[a-zA-Z0-9._-]+$/.test(value.trim());
}

function uniqueDiagnostics(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter((item) => {
        const capability = String(item?.capability || "").trim();
        if (!capability || seen.has(capability)) {
            return false;
        }
        seen.add(capability);
        return true;
    });
}

function inferNetworkCompanionCapabilities({capability = "", action = "", fullText = ""} = {}) {
    if (capability !== NETWORK_CAPABILITY) {
        return [];
    }

    const haystack = `${String(action || "")} ${String(fullText || "")}`.toLowerCase();
    const mentionsLoopback = /\blocalhost\b|127\.0\.0\.1|\[::1\]|\b::1\b|\bloopback\b/.test(haystack);
    const mentionsWebSocket = /\bwebsocket\b|\bws:\/\/|\bwss:\/\//.test(haystack);
    const mentionsExplicitHttp = /\bhttp:\/\/|\bplaintext http\b/.test(haystack);
    const mentionsWebFetch = /\bprefetch\b|\bfetch\b|\brequest\b|\bdownload\b|\bload\b|\brepository metadata\b|\bapi\b|\burl\b|\bendpoint\b/.test(haystack);

    if (mentionsLoopback) {
        if (mentionsWebSocket) {
            return [NETWORK_WEBSOCKET_CAPABILITY, "system.network.scope.loopback-dev"];
        }
        if (mentionsExplicitHttp) {
            return [NETWORK_HTTP_CAPABILITY, "system.network.scope.loopback-dev"];
        }
        return [NETWORK_HTTPS_CAPABILITY, "system.network.scope.loopback-dev"];
    }

    if (mentionsWebSocket) {
        return [NETWORK_WEBSOCKET_CAPABILITY, "system.network.scope.public-web-secure"];
    }

    if (mentionsExplicitHttp) {
        return [NETWORK_HTTP_CAPABILITY, "system.network.scope.public-web-legacy"];
    }

    if (mentionsWebFetch || haystack.includes("repository")) {
        return [NETWORK_HTTPS_CAPABILITY, "system.network.scope.public-web-secure"];
    }

    return [];
}

function toDiagnostic(capability, {
    action = "",
    source = "host",
} = {}) {
    const presentation = getCapabilityPresentation(capability);
    const category = presentation.category || "other";
    let remediation = `Grant "${capability}" in Manage Plugins -> Capabilities.`;

    if (category === "process-scope") {
        const scopeId = capability.slice("system.process.scope.".length);
        remediation = isCuratedOperatorProcessScopeId(scopeId)
            ? `Grant narrow scope "${capability}" and ensure broad capability "system.process.exec" is enabled. If this is a standard operator tool family, request the curated tool-family grant first.`
            : isHostFallbackProcessScopeId(scopeId)
                ? `Grant narrow scope "${capability}" and ensure broad capability "system.process.exec" is enabled. Use this fallback host scope only when no curated operator tool-family grant fits.`
                : `Grant narrow scope "${capability}" and ensure broad capability "system.process.exec" is enabled. If no curated tool-family grant exists, request a host-specific scope.`;
    } else if (category === "network-scope") {
        remediation = `Enable narrow destination scope "${capability}" as well as broad capability "system.network" and the required transport capability. Transport grants alone do not allow traffic; choose the smallest destination scope that fits the plugin.`;
    } else if (category === "filesystem-scope") {
        remediation = `Grant "${capability}" and ensure "${HOST_WRITE_CAPABILITY}" is also enabled in Manage Plugins -> Capabilities.`;
    } else if (capability === "system.process.exec") {
        remediation = 'Grant broad capability "system.process.exec" in Manage Plugins -> Capabilities, then add the required narrow scope. Prefer a curated tool-family grant when one exists; otherwise request a host-specific scope.';
    } else if (capability === HOST_WRITE_CAPABILITY || capability === HOST_WRITE_CAPABILITY_LEGACY) {
        remediation = `Grant "${HOST_WRITE_CAPABILITY}" in Manage Plugins -> Capabilities, then add the required filesystem scope when needed.`;
    } else if (capability === "system.clipboard.read") {
        remediation = `Grant "${HOST_WRITE_CAPABILITY}" and "system.clipboard.read" in Manage Plugins -> Capabilities only for trusted plugins that must read host clipboard text. Keep clipboard write separate when read is not required.`;
    } else if (capability === "system.clipboard.write") {
        remediation = `Grant "${HOST_WRITE_CAPABILITY}" and "system.clipboard.write" in Manage Plugins -> Capabilities for host-mediated clipboard writes. Keep clipboard read disabled unless the plugin also needs to read clipboard text.`;
    } else if (capability === NETWORK_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}" in Manage Plugins -> Capabilities, then also enable the exact transport capability and a matching destination scope under Network.`;
    } else if (capability === NETWORK_HTTPS_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}", "${NETWORK_HTTPS_CAPABILITY}", and a matching network destination scope for outbound HTTPS requests. This is the preferred web transport.`;
    } else if (capability === NETWORK_HTTP_CAPABILITY) {
        remediation = `Do not recommend "${NETWORK_HTTP_CAPABILITY}" by default. Prefer changing the plugin code and upstream service to HTTPS. Only if migration is blocked should you enable "${NETWORK_CAPABILITY}", "${NETWORK_HTTP_CAPABILITY}", and a matching destination scope for that legacy HTTP endpoint.`;
    } else if (capability === NETWORK_WEBSOCKET_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}", "${NETWORK_WEBSOCKET_CAPABILITY}", and a matching destination scope for WebSocket connections. Prefer secure "wss://" endpoints over plaintext "ws://".`;
    } else if (capability === NETWORK_TCP_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}", "${NETWORK_TCP_CAPABILITY}", and a matching destination scope only for trusted plugins that truly require raw TCP socket APIs.`;
    } else if (capability === NETWORK_UDP_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}", "${NETWORK_UDP_CAPABILITY}", and a matching destination scope only for trusted plugins that truly require raw UDP socket APIs.`;
    } else if (capability === NETWORK_DNS_CAPABILITY) {
        remediation = `Enable "${NETWORK_CAPABILITY}", "${NETWORK_DNS_CAPABILITY}", and a matching destination scope only when the plugin truly needs direct DNS resolution APIs.`;
    }

    return {
        capability,
        action,
        category,
        label: presentation.title,
        description: presentation.description,
        remediation,
        source,
    };
}

export function parseMissingCapabilityDiagnosticsFromError(errorText) {
    const text = typeof errorText === "string" ? errorText : "";
    if (!text) {
        return [];
    }

    const sdkStyleMatch = text.match(/Capability "([^"]+)" is required to ([\s\S]+?)\. Configure PluginRegistry\.configureCapabilities\(\{ granted: \["[^"]+"\] \}\) in the host before plugin initialization\./);
    if (sdkStyleMatch?.[1]) {
        const capability = normalizeCapabilityId(sdkStyleMatch[1]);
        const action = sdkStyleMatch[2] || "";
        const inferredCompanions = inferNetworkCompanionCapabilities({
            capability,
            action,
            fullText: text,
        });
        return uniqueDiagnostics([
            toDiagnostic(capability, {
                action,
                source: "sdk",
            }),
            ...inferredCompanions.map((companionCapability) => toDiagnostic(companionCapability, {
                action,
                source: "sdk",
            })),
        ]);
    }

    const capabilities = parseMissingCapabilitiesFromError(text);
    return uniqueDiagnostics(capabilities.flatMap((capability) => {
        const inferredCompanions = inferNetworkCompanionCapabilities({
            capability,
            action: "",
            fullText: text,
        });
        return [
            toDiagnostic(capability, {source: "host"}),
            ...inferredCompanions.map((companionCapability) => toDiagnostic(companionCapability, {source: "host"})),
        ];
    }));
}

export function parseMissingCapabilitiesFromError(errorText) {
    const text = typeof errorText === "string" ? errorText : "";
    if (!text) {
        return [];
    }

    const missingRequiredMatch = text.match(/Missing required (?:capability|capabilities):\s*([^\n\r]+)/i);
    if (missingRequiredMatch?.[1]) {
        const parts = missingRequiredMatch[1]
            .replace(/\.\s*$/, "")
            .split(/\s*,\s*|\s+and\s+/i)
            .map(normalizeCapabilityId)
            .filter((item) => isCapabilityId(item));
        return [...new Set(parts)];
    }

    const singleQuotedMatch = text.match(/\bCapability\b\s+"([^"]+)"\s+\bis\s+required\b/i);
    if (singleQuotedMatch?.[1]) {
        const normalized = normalizeCapabilityId(singleQuotedMatch[1]);
        if (isCapabilityId(normalized)) {
            return [normalized];
        }
    }

    const singleMatch = text.match(/\bCapability\b\s+([a-zA-Z0-9._-]+)\s+\bis\s+required\b/i);
    if (singleMatch?.[1] && isCapabilityId(singleMatch[1])) {
        return [normalizeCapabilityId(singleMatch[1])];
    }

    if (/\bCapabilities\b.+\bare\s+required\b/i.test(text)) {
        const quotedParts = [...text.matchAll(/"([^"]+)"/g)]
            .map((match) => normalizeCapabilityId(match?.[1]))
            .filter((item) => isCapabilityId(item));
        if (quotedParts.length > 0) {
            return [...new Set(quotedParts)];
        }
    }

    const multiMatch = text.match(/\bCapabilities\b\s+(.+?)\s+\bare\s+required\b/i);
    if (multiMatch?.[1]) {
        const parts = multiMatch[1]
            .split(/\s*,\s*|\s+and\s+/i)
            .map(normalizeCapabilityId)
            .filter((item) => isCapabilityId(item));
        return [...new Set(parts)];
    }

    return [];
}
