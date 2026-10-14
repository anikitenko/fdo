import path from "node:path";

export const HOST_FILESYSTEM_OPERATION_TYPES = Object.freeze([
    "writeFile",
    "appendFile",
    "mkdir",
    "rename",
    "remove",
]);

export const HOST_FS_SCOPE_REGISTRY = Object.freeze({
    "etc-hosts": Object.freeze({
        scope: "etc-hosts",
        title: "Etc Hosts Scope",
        kind: "filesystem",
        category: "Filesystem",
        allowedRoots: Object.freeze(["/etc"]),
        allowedOperationTypes: Object.freeze(["writeFile", "appendFile", "mkdir", "rename", "remove"]),
        requireConfirmation: true,
        description: "Controlled mutations under /etc for hosts-related workflows.",
        fallback: false,
        userDefined: false,
        shared: true,
        ownerType: "shared",
        ownerPluginId: "",
    }),
});

let sharedCustomFilesystemScopeRegistry = Object.freeze({});
let pluginCustomFilesystemScopeRegistry = Object.freeze({});

function uniqueNormalizedStrings(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()))];
}

function isAbsoluteLikePath(value = "") {
    const text = String(value || "").trim();
    if (!text) {
        return false;
    }
    return path.isAbsolute(text) || /^([A-Za-z]:[\\/])/.test(text);
}

function normalizeOwnerMetadata(scope = {}, owner = {}) {
    const ownerPluginId = typeof owner?.pluginId === "string" && owner.pluginId.trim()
        ? owner.pluginId.trim()
        : (typeof scope?.ownerPluginId === "string" && scope.ownerPluginId.trim() ? scope.ownerPluginId.trim() : "");
    const shared = owner?.shared === true || scope?.shared === true || !ownerPluginId;
    return {
        ownerPluginId: shared ? "" : ownerPluginId,
        ownerType: shared ? "shared" : "plugin",
        shared,
    };
}

export function sanitizeCustomFilesystemScopeId(scopeId = "") {
    const raw = String(scopeId || "").trim();
    const withoutCapabilityPrefixes = raw
        .replace(/^system\.fs\.scope\./i, "")
        .replace(/^system\.process\.scope\./i, "");
    const normalized = withoutCapabilityPrefixes
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "");
    return normalized || "";
}

export function normalizeCustomFilesystemScope(scope = {}, owner = {}) {
    const normalizedScopeId = sanitizeCustomFilesystemScopeId(scope?.scope || scope?.id || scope?.slug || "");
    if (!normalizedScopeId) {
        throw new Error("Custom filesystem scope id is required.");
    }
    const allowedRoots = uniqueNormalizedStrings(scope?.allowedRoots).filter((entry) => isAbsoluteLikePath(entry));
    if (allowedRoots.length === 0) {
        throw new Error(`Custom filesystem scope "${normalizedScopeId}" must allow at least one absolute root path.`);
    }
    const validOperations = new Set(HOST_FILESYSTEM_OPERATION_TYPES);
    const allowedOperationTypes = uniqueNormalizedStrings(scope?.allowedOperationTypes)
        .filter((operation) => validOperations.has(operation));
    const normalizedAllowedOperationTypes = allowedOperationTypes.length > 0
        ? allowedOperationTypes
        : [...HOST_FILESYSTEM_OPERATION_TYPES];
    const ownerMeta = normalizeOwnerMetadata(scope, owner);
    return Object.freeze({
        scope: normalizedScopeId,
        title: typeof scope?.title === "string" && scope.title.trim()
            ? scope.title.trim()
            : normalizedScopeId.replace(/[._-]+/g, " "),
        kind: "filesystem",
        category: ownerMeta.shared ? "Shared Filesystem Scopes" : "Plugin-Specific Filesystem Scopes",
        userDefined: true,
        description: typeof scope?.description === "string" && scope.description.trim()
            ? scope.description.trim()
            : ownerMeta.shared
                ? "Host-managed shared user-defined filesystem scope."
                : "Plugin-specific host-managed user-defined filesystem scope.",
        allowedRoots: Object.freeze(allowedRoots),
        allowedOperationTypes: Object.freeze(normalizedAllowedOperationTypes),
        requireConfirmation: scope?.requireConfirmation !== false,
        fallback: false,
        shared: ownerMeta.shared,
        ownerType: ownerMeta.ownerType,
        ownerPluginId: ownerMeta.ownerPluginId,
    });
}

export function setHostSharedFilesystemScopes(scopes = []) {
    const normalizedEntries = (Array.isArray(scopes) ? scopes : [])
        .map((scope) => normalizeCustomFilesystemScope(scope, {shared: true}));
    sharedCustomFilesystemScopeRegistry = Object.freeze(Object.fromEntries(
        normalizedEntries.map((scope) => [scope.scope, scope])
    ));
    return sharedCustomFilesystemScopeRegistry;
}

export function setHostPluginCustomFilesystemScopes(pluginId, scopes = []) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId) {
        return pluginCustomFilesystemScopeRegistry;
    }
    const normalizedEntries = (Array.isArray(scopes) ? scopes : [])
        .map((scope) => normalizeCustomFilesystemScope(scope, {pluginId: safePluginId}));
    pluginCustomFilesystemScopeRegistry = Object.freeze({
        ...pluginCustomFilesystemScopeRegistry,
        [safePluginId]: Object.freeze(Object.fromEntries(
            normalizedEntries.map((scope) => [scope.scope, scope])
        )),
    });
    return pluginCustomFilesystemScopeRegistry;
}

export function removeHostPluginCustomFilesystemScopes(pluginId) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId || !pluginCustomFilesystemScopeRegistry[safePluginId]) {
        return pluginCustomFilesystemScopeRegistry;
    }
    const nextRegistry = {...pluginCustomFilesystemScopeRegistry};
    delete nextRegistry[safePluginId];
    pluginCustomFilesystemScopeRegistry = Object.freeze(nextRegistry);
    return pluginCustomFilesystemScopeRegistry;
}

export function getHostSharedFilesystemScopes() {
    return Object.values(sharedCustomFilesystemScopeRegistry);
}

export function getHostPluginCustomFilesystemScopes(pluginId) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId) {
        return [];
    }
    return Object.values(pluginCustomFilesystemScopeRegistry[safePluginId] || {});
}

export function getAllHostFilesystemScopePolicies(options = {}) {
    const safePluginId = typeof options?.pluginId === "string" ? options.pluginId.trim() : "";
    return Object.freeze({
        ...HOST_FS_SCOPE_REGISTRY,
        ...sharedCustomFilesystemScopeRegistry,
        ...(safePluginId ? (pluginCustomFilesystemScopeRegistry[safePluginId] || {}) : {}),
    });
}

export function getHostFsScopePolicy(scopeId, options = {}) {
    if (typeof scopeId !== "string" || !scopeId.trim()) {
        return null;
    }
    const normalizedScopeId = scopeId.trim();
    const allPolicies = getAllHostFilesystemScopePolicies(options);
    return allPolicies[normalizedScopeId] || null;
}
