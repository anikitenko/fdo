import os from "node:os";

function defaultCwdRoots() {
    const roots = [process.cwd(), os.tmpdir(), os.homedir()].filter(Boolean);
    return Object.freeze([...new Set(roots)]);
}

function createSubcommandValidator(scope, {
    allowedFirstArgs = [],
    deniedFirstArgs = [],
} = {}) {
    const allowed = new Set(allowedFirstArgs);
    const denied = new Set(deniedFirstArgs);
    return (args = []) => {
        const first = Array.isArray(args) ? String(args[0] || "").trim() : "";
        if (!first) {
            return "";
        }
        if (denied.has(first)) {
            return `Argument "${first}" is not allowed for process scope "${scope}".`;
        }
        if (allowed.size > 0 && !allowed.has(first)) {
            return `Argument "${first}" is not allowed for process scope "${scope}".`;
        }
        return "";
    };
}

export const HOST_PROCESS_SCOPE_REGISTRY = Object.freeze({
    "docker-cli": Object.freeze({
        scope: "docker-cli",
        kind: "process",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "/usr/bin/docker",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "DOCKER_CONFIG",
            "DOCKER_CONTEXT",
            "DOCKER_HOST",
            "DOCKER_TLS_VERIFY",
            "DOCKER_CERT_PATH",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "Scoped Docker CLI execution for operator-style container workflows.",
        validateArgs: createSubcommandValidator("docker-cli", {
            allowedFirstArgs: ["version", "info", "ps", "images", "inspect", "logs", "context", "compose", "container", "network", "volume", "start", "stop", "restart", "pull"],
            deniedFirstArgs: ["run", "exec"],
        }),
    }),
    kubectl: Object.freeze({
        scope: "kubectl",
        kind: "process",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/kubectl",
            "/opt/homebrew/bin/kubectl",
            "/usr/bin/kubectl",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "KUBECONFIG",
            "KUBE_CONTEXT",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "Scoped kubectl execution for cluster dashboards and operator consoles.",
        validateArgs: createSubcommandValidator("kubectl", {
            allowedFirstArgs: ["version", "get", "describe", "logs", "top", "apply", "delete", "patch", "rollout", "scale", "diff", "config"],
            deniedFirstArgs: ["exec", "cp", "port-forward", "proxy", "attach"],
        }),
    }),
    helm: Object.freeze({
        scope: "helm",
        kind: "process",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/helm",
            "/opt/homebrew/bin/helm",
            "/usr/bin/helm",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HELM_CACHE_HOME",
            "HELM_CONFIG_HOME",
            "HELM_DATA_HOME",
            "HELM_DRIVER",
            "HELM_NAMESPACE",
            "HOME",
            "KUBECONFIG",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 45000,
        requireConfirmation: true,
        description: "Scoped Helm CLI execution for chart and release management consoles.",
        validateArgs: createSubcommandValidator("helm", {
            allowedFirstArgs: ["version", "list", "status", "get", "template", "install", "upgrade", "uninstall", "rollback", "lint", "dependency", "search", "show", "repo"],
            deniedFirstArgs: ["plugin"],
        }),
    }),
    terraform: Object.freeze({
        scope: "terraform",
        kind: "process",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/terraform",
            "/opt/homebrew/bin/terraform",
            "/usr/bin/terraform",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "AWS_PROFILE",
            "AWS_REGION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "HOME",
            "PATH",
            "TF_CLI_ARGS",
            "TF_DATA_DIR",
            "TF_LOG",
            "TF_VAR_environment",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped Terraform CLI execution for infrastructure planning and apply workflows.",
        validateArgs: createSubcommandValidator("terraform", {
            allowedFirstArgs: ["version", "fmt", "validate", "plan", "apply", "destroy", "output", "show", "workspace", "state"],
            deniedFirstArgs: ["console", "login"],
        }),
    }),
});

export function getHostProcessScopePolicy(scopeId) {
    if (typeof scopeId !== "string" || !scopeId.trim()) {
        return null;
    }
    return HOST_PROCESS_SCOPE_REGISTRY[scopeId] || null;
}
