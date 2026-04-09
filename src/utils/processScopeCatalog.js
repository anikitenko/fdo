export const CURATED_OPERATOR_PROCESS_SCOPE_IDS = Object.freeze([
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

export const HOST_FALLBACK_PROCESS_SCOPE_IDS = Object.freeze([
    "system-observe",
    "system-inspect",
    "network-diagnostics",
    "service-management",
    "archive-tools",
    "package-management",
    "source-control",
    "build-tooling",
    "task-runners",
    "homebrew",
]);

export function isCuratedOperatorProcessScopeId(scopeId = "") {
    return CURATED_OPERATOR_PROCESS_SCOPE_IDS.includes(String(scopeId || "").trim());
}

export function isHostFallbackProcessScopeId(scopeId = "") {
    return HOST_FALLBACK_PROCESS_SCOPE_IDS.includes(String(scopeId || "").trim());
}
