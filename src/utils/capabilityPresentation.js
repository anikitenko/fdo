import {isHostFallbackProcessScopeId} from "./processScopeCatalog";
import {getAllHostNetworkScopePolicies} from "./networkScopeRegistry";
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
    STORAGE_CAPABILITY,
    STORAGE_JSON_CAPABILITY,
    toCanonicalCapabilityId
} from "./pluginCapabilities";

const CAPABILITY_RISK_LEVELS = Object.freeze({
    low: "low",
    medium: "medium",
    high: "high",
});

export const CAPABILITY_PRESENTATION = Object.freeze({
    [STORAGE_CAPABILITY]: Object.freeze({
        id: STORAGE_CAPABILITY,
        title: "Persistent plugin storage",
        description: "Base storage capability family. Pair with concrete storage backends such as storage.json.",
        risk: CAPABILITY_RISK_LEVELS.low,
        dependsOn: Object.freeze([]),
        category: "data",
    }),
    [STORAGE_JSON_CAPABILITY]: Object.freeze({
        id: STORAGE_JSON_CAPABILITY,
        title: "Persistent plugin JSON storage",
        description: "Allows plugin data persistence in its managed storage area.",
        risk: CAPABILITY_RISK_LEVELS.low,
        dependsOn: Object.freeze([STORAGE_CAPABILITY]),
        category: "data",
    }),
    [NETWORK_CAPABILITY]: Object.freeze({
        id: NETWORK_CAPABILITY,
        title: "Network access",
        description: "Base network capability family. Pair it only with the concrete transports the plugin actually needs.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: Object.freeze([]),
        category: "network",
    }),
    [NETWORK_HTTPS_CAPABILITY]: Object.freeze({
        id: NETWORK_HTTPS_CAPABILITY,
        title: "HTTPS requests",
        description: "Allows outbound HTTPS requests from plugin runtime and UI. Prefer this over plaintext HTTP whenever possible.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [NETWORK_HTTP_CAPABILITY]: Object.freeze({
        id: NETWORK_HTTP_CAPABILITY,
        title: "Plain HTTP requests",
        description: "Allows outbound plaintext HTTP requests from plugin runtime and UI. HTTP is not secure against interception or tampering on untrusted networks; do not recommend this by default. Prefer changing plugin code and upstream services to HTTPS, and grant HTTP only when migration is genuinely blocked.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [NETWORK_WEBSOCKET_CAPABILITY]: Object.freeze({
        id: NETWORK_WEBSOCKET_CAPABILITY,
        title: "WebSocket connections",
        description: "Allows outbound WebSocket connections from plugin runtime and UI. Prefer secure `wss://` endpoints; plaintext `ws://` should be treated as high risk.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [NETWORK_TCP_CAPABILITY]: Object.freeze({
        id: NETWORK_TCP_CAPABILITY,
        title: "Raw TCP sockets",
        description: "Allows direct TCP socket APIs. This is a high-trust grant suitable only for plugins that genuinely need low-level socket control.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [NETWORK_UDP_CAPABILITY]: Object.freeze({
        id: NETWORK_UDP_CAPABILITY,
        title: "Raw UDP sockets",
        description: "Allows direct UDP socket APIs. Use only for protocols that cannot run over safer higher-level transports.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [NETWORK_DNS_CAPABILITY]: Object.freeze({
        id: NETWORK_DNS_CAPABILITY,
        title: "Direct DNS resolution",
        description: "Allows direct DNS lookup APIs. Prefer normal application-level HTTP(S) requests unless the plugin truly needs explicit resolver behavior.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: Object.freeze([NETWORK_CAPABILITY]),
        category: "network",
    }),
    [HOST_WRITE_CAPABILITY]: Object.freeze({
        id: HOST_WRITE_CAPABILITY,
        title: "Privileged host actions",
        description: "Allows host-mediated privileged mutations with explicit host-side checks.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([]),
        category: "system",
    }),
    "system.process.exec": Object.freeze({
        id: "system.process.exec",
        title: "Allow Scoped Tool Execution",
        description: "Broad capability for host-mediated operator tooling. Pair it with a narrow scope such as system.process.scope.docker-cli. Prefer operator fixtures, curated presets, and workflows first. Use host-specific fallback scopes only when no curated operator family fits. This is not unrestricted shell access.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([]),
        category: "system",
    }),
    "system.clipboard.read": Object.freeze({
        id: "system.clipboard.read",
        title: "Read Host Clipboard",
        description: "Allows host-mediated clipboard reads. Treat as sensitive: read access can expose copied secrets and should be granted only to trusted plugins.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([HOST_WRITE_CAPABILITY]),
        category: "system",
    }),
    "system.clipboard.write": Object.freeze({
        id: "system.clipboard.write",
        title: "Write Host Clipboard",
        description: "Allows host-mediated clipboard writes. Separate from clipboard read so write-only plugins can be granted lower-sensitive clipboard access.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: Object.freeze([HOST_WRITE_CAPABILITY]),
        category: "system",
    }),
    "sudo.prompt": Object.freeze({
        id: "sudo.prompt",
        title: "Elevated process modules",
        description: "Allows privileged process modules such as sudo prompt and child process operations.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([]),
        category: "system",
    }),
});

export function buildScopeCapabilityPresentation(scopePolicy = {}) {
    const scopeId = typeof scopePolicy?.scope === "string" ? scopePolicy.scope : "";
    if (!scopeId) {
        return null;
    }
    const kind = scopePolicy?.kind === "process"
        ? "process"
        : scopePolicy?.kind === "network"
            ? "network"
            : "filesystem";

    const roots = Array.isArray(scopePolicy.allowedRoots) ? scopePolicy.allowedRoots : [];
    const cwdRoots = Array.isArray(scopePolicy.allowedCwdRoots) ? scopePolicy.allowedCwdRoots : [];
    const rootText = roots.length ? roots.join(", ") : "configured roots";
    const cwdText = cwdRoots.length ? cwdRoots.join(", ") : "configured roots";

    if (kind === "process") {
        if (scopePolicy?.userDefined === true) {
            const scopeKindLabel = scopePolicy?.shared === true ? "Shared Scope" : "Plugin Scope";
            return {
                id: `system.process.scope.${scopeId}`,
                title: scopePolicy?.title ? `${scopePolicy.title}` : `${scopeKindLabel}: ${scopeId}`,
                description: scopePolicy?.description || `Host-managed ${scopePolicy?.shared === true ? "shared" : "plugin-specific"} process scope paired with broad capability system.process.exec. Use this when no curated operator family or built-in fallback scope fits.`,
                risk: CAPABILITY_RISK_LEVELS.high,
                dependsOn: ["system.process.exec"],
                category: "process-scope",
            };
        }
        const knownProcessScopePresentation = {
            "system-observe": {
                title: "System Observe Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for OS-aware system observation commands when no curated operator tool family fits.",
            },
            "system-inspect": {
                title: "System Inspect Scope",
                description: "Legacy-compatible host-specific fallback scope paired with broad capability system.process.exec for read-oriented system inspection commands when no curated operator tool family fits.",
            },
            "network-diagnostics": {
                title: "Network Diagnostics Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for OS-aware network inspection and connectivity diagnostics when no curated operator tool family fits.",
            },
            "service-management": {
                title: "Service Management Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for OS-aware service inspection and controlled start/stop operations when no curated operator tool family fits.",
            },
            "archive-tools": {
                title: "Archive Tools Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for archive and packaging commands when no curated operator tool family fits.",
            },
            homebrew: {
                title: "Homebrew Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for Homebrew operations when no curated operator tool family fits.",
            },
            "package-management": {
                title: "Package Management Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for package manager operations across common ecosystems when no curated operator tool family fits.",
            },
            "source-control": {
                title: "Source Control Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for source control and forge CLI operations when no curated operator tool family fits.",
            },
            "build-tooling": {
                title: "Build Tooling Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for build-system inspection and controlled build/test commands when no curated operator tool family fits.",
            },
            "task-runners": {
                title: "Task Runner Scope",
                description: "Host-specific fallback scope paired with broad capability system.process.exec for host task-runner commands when no curated operator tool family fits.",
            },
            "docker-cli": {
                title: "Docker CLI Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Docker CLI operations.",
            },
            kubectl: {
                title: "kubectl Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved kubectl operations.",
            },
            helm: {
                title: "Helm Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Helm operations.",
            },
            terraform: {
                title: "Terraform Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Terraform operations.",
            },
            ansible: {
                title: "Ansible Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Ansible operations.",
            },
            "aws-cli": {
                title: "AWS CLI Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved AWS CLI operations.",
            },
            gcloud: {
                title: "Google Cloud CLI Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved gcloud operations.",
            },
            "azure-cli": {
                title: "Azure CLI Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Azure CLI operations.",
            },
            podman: {
                title: "Podman Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Podman operations.",
            },
            kustomize: {
                title: "Kustomize Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Kustomize operations.",
            },
            gh: {
                title: "GitHub CLI Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved GitHub CLI operations.",
            },
            git: {
                title: "Git Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Git operations.",
            },
            vault: {
                title: "Vault Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Vault operations.",
            },
            nomad: {
                title: "Nomad Scope",
                description: "Narrow scope paired with broad capability system.process.exec for host-approved Nomad operations.",
            },
        };
        const known = knownProcessScopePresentation[scopeId];
        return {
            id: `system.process.scope.${scopeId}`,
            title: known?.title || `Process Scope: ${scopeId}`,
            description: known?.description || `${isHostFallbackProcessScopeId(scopeId) ? "Host-specific fallback scope" : "Narrow scope"} paired with broad capability system.process.exec for host-approved process execution inside scope "${scopeId}".`,
            risk: CAPABILITY_RISK_LEVELS.high,
            dependsOn: ["system.process.exec"],
            category: "process-scope",
        };
    }

    if (kind === "network") {
        const knownNetworkScopePresentation = {
            "public-web-secure": {
                title: "Secure Public Web Scope",
                description: "Narrow scope paired with system.network for secure HTTPS/WSS traffic to public endpoints.",
            },
            "public-web-legacy": {
                title: "Legacy Public Web Scope",
                description: "Fallback scope paired with system.network for legacy HTTP/WS endpoints. Prefer secure scopes first.",
            },
            "loopback-dev": {
                title: "Loopback Development Scope",
                description: "Narrow scope paired with system.network for localhost and loopback development services.",
            },
        };
        const known = knownNetworkScopePresentation[scopeId];
        return {
            id: `system.network.scope.${scopeId}`,
            title: known?.title || `Network Scope: ${scopeId}`,
            description: known?.description || `Narrow network scope paired with broad capability system.network for host-approved destinations inside scope "${scopeId}".`,
            risk: CAPABILITY_RISK_LEVELS.high,
            dependsOn: ["system.network"],
            category: "network-scope",
        };
    }

    return {
        id: `system.fs.scope.${scopeId}`,
        title: `Filesystem Scope: ${scopeId}`,
        description: scopePolicy.description || `Allows host-approved filesystem access inside scope "${scopeId}".`,
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: [HOST_WRITE_CAPABILITY],
        category: "filesystem-scope",
    };
}

export function getCapabilityPresentation(capabilityId, scopePolicies = []) {
    const normalizedCapabilityId = toCanonicalCapabilityId(capabilityId);

    if (CAPABILITY_PRESENTATION[normalizedCapabilityId]) {
        return CAPABILITY_PRESENTATION[normalizedCapabilityId];
    }

    if (normalizedCapabilityId === HOST_WRITE_CAPABILITY_LEGACY) {
        return CAPABILITY_PRESENTATION[HOST_WRITE_CAPABILITY];
    }

    if (typeof normalizedCapabilityId === "string" && normalizedCapabilityId.startsWith("system.fs.scope.")) {
        const scopeId = normalizedCapabilityId.slice("system.fs.scope.".length);
        const scopePolicy = (Array.isArray(scopePolicies) ? scopePolicies : [])
            .find((policy) => policy?.scope === scopeId);
        return buildScopeCapabilityPresentation(scopePolicy || {scope: scopeId});
    }

    if (typeof normalizedCapabilityId === "string" && normalizedCapabilityId.startsWith("system.process.scope.")) {
        const scopeId = normalizedCapabilityId.slice("system.process.scope.".length);
        const scopePolicy = (Array.isArray(scopePolicies) ? scopePolicies : [])
            .find((policy) => policy?.scope === scopeId);
        if (!scopePolicy && scopeId.startsWith("user.")) {
            return buildScopeCapabilityPresentation({
                scope: scopeId,
                kind: "process",
                userDefined: true,
                shared: false,
                title: scopeId.slice("user.".length).replace(/[._-]+/g, " "),
            });
        }
        return buildScopeCapabilityPresentation(scopePolicy || {scope: scopeId, kind: "process"});
    }

    if (typeof normalizedCapabilityId === "string" && normalizedCapabilityId.startsWith("system.network.scope.")) {
        const scopeId = normalizedCapabilityId.slice("system.network.scope.".length);
        const scopePolicy = (Array.isArray(scopePolicies) ? scopePolicies : [])
            .find((policy) => policy?.scope === scopeId)
            || getAllHostNetworkScopePolicies()?.[scopeId];
        return buildScopeCapabilityPresentation(scopePolicy || {scope: scopeId, kind: "network"});
    }

    return {
        id: normalizedCapabilityId,
        title: normalizedCapabilityId,
        description: "No presentation metadata available.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: [],
        category: "other",
    };
}
