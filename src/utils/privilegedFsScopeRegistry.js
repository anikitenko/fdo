export const HOST_FS_SCOPE_REGISTRY = Object.freeze({
    "etc-hosts": Object.freeze({
        scope: "etc-hosts",
        kind: "filesystem",
        allowedRoots: Object.freeze(["/etc"]),
        allowedOperationTypes: Object.freeze(["writeFile", "appendFile", "mkdir", "rename", "remove"]),
        requireConfirmation: true,
        description: "Controlled mutations under /etc for hosts-related workflows.",
    }),
});

export function getHostFsScopePolicy(scopeId) {
    if (typeof scopeId !== "string" || !scopeId.trim()) {
        return null;
    }
    return HOST_FS_SCOPE_REGISTRY[scopeId] || null;
}
