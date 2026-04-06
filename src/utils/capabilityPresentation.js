const CAPABILITY_RISK_LEVELS = Object.freeze({
    low: "low",
    medium: "medium",
    high: "high",
});

export const CAPABILITY_PRESENTATION = Object.freeze({
    "storage.json": Object.freeze({
        id: "storage.json",
        title: "Persistent plugin JSON storage",
        description: "Allows plugin data persistence in its managed storage area.",
        risk: CAPABILITY_RISK_LEVELS.low,
        dependsOn: Object.freeze([]),
        category: "data",
    }),
    "system.hosts.write": Object.freeze({
        id: "system.hosts.write",
        title: "Privileged host actions",
        description: "Allows host-mediated privileged mutations with explicit host-side checks.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([]),
        category: "system",
    }),
    "system.process.exec": Object.freeze({
        id: "system.process.exec",
        title: "Allow Scoped Tool Execution",
        description: "Broad capability for host-mediated operator tooling. Pair it with a narrow scope such as system.process.scope.docker-cli. This is not unrestricted shell access.",
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: Object.freeze([]),
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
    const kind = scopePolicy?.kind === "process" ? "process" : "filesystem";

    const roots = Array.isArray(scopePolicy.allowedRoots) ? scopePolicy.allowedRoots : [];
    const cwdRoots = Array.isArray(scopePolicy.allowedCwdRoots) ? scopePolicy.allowedCwdRoots : [];
    const rootText = roots.length ? roots.join(", ") : "configured roots";
    const cwdText = cwdRoots.length ? cwdRoots.join(", ") : "configured roots";

    if (kind === "process") {
        const knownProcessScopePresentation = {
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
            description: known?.description || `Narrow scope paired with broad capability system.process.exec for host-approved process execution inside scope "${scopeId}".`,
            risk: CAPABILITY_RISK_LEVELS.high,
            dependsOn: ["system.process.exec"],
            category: "process-scope",
        };
    }

    return {
        id: `system.fs.scope.${scopeId}`,
        title: `Filesystem Scope: ${scopeId}`,
        description: scopePolicy.description || `Allows host-approved filesystem access inside scope "${scopeId}".`,
        risk: CAPABILITY_RISK_LEVELS.high,
        dependsOn: ["system.hosts.write"],
        category: "filesystem-scope",
    };
}

export function getCapabilityPresentation(capabilityId, scopePolicies = []) {
    if (CAPABILITY_PRESENTATION[capabilityId]) {
        return CAPABILITY_PRESENTATION[capabilityId];
    }

    if (typeof capabilityId === "string" && capabilityId.startsWith("system.fs.scope.")) {
        const scopeId = capabilityId.slice("system.fs.scope.".length);
        const scopePolicy = (Array.isArray(scopePolicies) ? scopePolicies : [])
            .find((policy) => policy?.scope === scopeId);
        return buildScopeCapabilityPresentation(scopePolicy || {scope: scopeId});
    }

    if (typeof capabilityId === "string" && capabilityId.startsWith("system.process.scope.")) {
        const scopeId = capabilityId.slice("system.process.scope.".length);
        const scopePolicy = (Array.isArray(scopePolicies) ? scopePolicies : [])
            .find((policy) => policy?.scope === scopeId);
        return buildScopeCapabilityPresentation(scopePolicy || {scope: scopeId, kind: "process"});
    }

    return {
        id: capabilityId,
        title: capabilityId,
        description: "No presentation metadata available.",
        risk: CAPABILITY_RISK_LEVELS.medium,
        dependsOn: [],
        category: "other",
    };
}
