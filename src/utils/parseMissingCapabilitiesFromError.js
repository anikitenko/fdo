import {getCapabilityPresentation} from "./capabilityPresentation";
import {isCuratedOperatorProcessScopeId, isHostFallbackProcessScopeId} from "./processScopeCatalog";

function normalizeCapabilityId(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isCapabilityId(value) {
    return typeof value === "string" && /^(system|storage|sudo)\.[a-zA-Z0-9._-]+$/.test(value.trim());
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
    } else if (category === "filesystem-scope") {
        remediation = `Grant "${capability}" and ensure "system.hosts.write" is also enabled in Manage Plugins -> Capabilities.`;
    } else if (capability === "system.process.exec") {
        remediation = 'Grant broad capability "system.process.exec" in Manage Plugins -> Capabilities, then add the required narrow scope. Prefer a curated tool-family grant when one exists; otherwise request a host-specific scope.';
    } else if (capability === "system.hosts.write") {
        remediation = 'Grant "system.hosts.write" in Manage Plugins -> Capabilities, then add the required filesystem scope when needed.';
    } else if (capability === "system.clipboard.read") {
        remediation = 'Grant "system.hosts.write" and "system.clipboard.read" in Manage Plugins -> Capabilities only for trusted plugins that must read host clipboard text. Keep clipboard write separate when read is not required.';
    } else if (capability === "system.clipboard.write") {
        remediation = 'Grant "system.hosts.write" and "system.clipboard.write" in Manage Plugins -> Capabilities for host-mediated clipboard writes. Keep clipboard read disabled unless the plugin also needs to read clipboard text.';
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

    const sdkStyleMatch = text.match(/^Capability "([^"]+)" is required to (.+)\. Configure PluginRegistry\.configureCapabilities\(\{ granted: \["[^"]+"\] \}\) in the host before plugin initialization\.$/);
    if (sdkStyleMatch?.[1]) {
        return [toDiagnostic(normalizeCapabilityId(sdkStyleMatch[1]), {
            action: sdkStyleMatch[2] || "",
            source: "sdk",
        })];
    }

    const capabilities = parseMissingCapabilitiesFromError(text);
    return capabilities.map((capability) => toDiagnostic(capability, {source: "host"}));
}

export function parseMissingCapabilitiesFromError(errorText) {
    const text = typeof errorText === "string" ? errorText : "";
    if (!text) {
        return [];
    }

    const extracted = [];

    const quotedMatches = [...text.matchAll(/"([^"]+)"/g)];
    if (quotedMatches.length > 0) {
        quotedMatches.forEach((match) => {
            const id = normalizeCapabilityId(match?.[1]);
            if (isCapabilityId(id)) {
                extracted.push(id);
            }
        });
        if (extracted.length > 0) {
            return [...new Set(extracted)];
        }
    }

    const missingRequiredMatch = text.match(/Missing required capabilities?:\s*([^\n\r]+)/i);
    if (missingRequiredMatch?.[1]) {
        const parts = missingRequiredMatch[1]
            .replace(/\.\s*$/, "")
            .split(/\s*,\s*|\s+and\s+/i)
            .map(normalizeCapabilityId)
            .filter((item) => isCapabilityId(item));
        return [...new Set(parts)];
    }

    const singleMatch = text.match(/\bCapability\b\s+([a-zA-Z0-9._-]+)\s+\bis\s+required\b/i);
    if (singleMatch?.[1] && isCapabilityId(singleMatch[1])) {
        return [singleMatch[1]];
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
