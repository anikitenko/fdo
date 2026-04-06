import {getCapabilityPresentation} from "./capabilityPresentation";

const KNOWN_OPERATOR_SCOPE_IDS = new Set([
    "docker-cli",
    "kubectl",
    "helm",
    "terraform",
    "ansible",
    "aws-cli",
    "gcloud",
    "azure-cli",
    "podman",
    "kustomize",
    "gh",
    "git",
    "vault",
    "nomad",
]);

function normalizeCapabilityId(value) {
    return typeof value === "string" ? value.trim() : "";
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
        remediation = KNOWN_OPERATOR_SCOPE_IDS.has(scopeId)
            ? `Grant narrow scope "${capability}" and ensure broad capability "system.process.exec" is enabled. If this is a standard operator tool family, request the curated tool-family grant first.`
            : `Grant narrow scope "${capability}" and ensure broad capability "system.process.exec" is enabled. If no curated tool-family grant exists, request a host-specific scope.`;
    } else if (category === "filesystem-scope") {
        remediation = `Grant "${capability}" and ensure "system.hosts.write" is also enabled in Manage Plugins -> Capabilities.`;
    } else if (capability === "system.process.exec") {
        remediation = 'Grant broad capability "system.process.exec" in Manage Plugins -> Capabilities, then add the required narrow scope. Prefer a curated tool-family grant when one exists; otherwise request a host-specific scope.';
    } else if (capability === "system.hosts.write") {
        remediation = 'Grant "system.hosts.write" in Manage Plugins -> Capabilities, then add the required filesystem scope when needed.';
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
            if (id) {
                extracted.push(id);
            }
        });
        return [...new Set(extracted)];
    }

    const singleMatch = text.match(/Capability\s+([a-zA-Z0-9._-]+)\s+is\s+required/i);
    if (singleMatch?.[1]) {
        return [singleMatch[1]];
    }

    const multiMatch = text.match(/Capabilities\s+(.+?)\s+are\s+required/i);
    if (multiMatch?.[1]) {
        const parts = multiMatch[1]
            .split(/\s*,\s*|\s+and\s+/i)
            .map(normalizeCapabilityId)
            .filter(Boolean);
        return [...new Set(parts)];
    }

    return [];
}
