export const PLUGIN_CAPABILITY_DEFINITIONS = Object.freeze({
    "storage.json": Object.freeze({
        description: "Allows persistent JSON storage usage in SDK.",
    }),
    "system.hosts.write": Object.freeze({
        description: "Allows host-mediated tagged updates to /etc/hosts.",
    }),
    "system.process.exec": Object.freeze({
        description: "Allows host-mediated scoped process execution with explicit host-side policy checks.",
    }),
    "sudo.prompt": Object.freeze({
        description: "Allows elevated operations and privileged process modules.",
        grants: Object.freeze({
            modules: Object.freeze(["@expo/sudo-prompt", "child_process", "node:child_process"]),
        }),
    }),
});

export const KNOWN_PLUGIN_CAPABILITIES = Object.freeze(Object.keys(PLUGIN_CAPABILITY_DEFINITIONS));

export function normalizeCapabilityList(input) {
    const requested = Array.isArray(input)
        ? input.filter((entry) => typeof entry === "string")
        : [];
    const unique = [...new Set(requested.map((entry) => entry.trim()).filter(Boolean))];
    return unique.filter((capability) => (
        KNOWN_PLUGIN_CAPABILITIES.includes(capability) || capability.startsWith("system.fs.scope.")
            || capability.startsWith("system.process.scope.")
    ));
}

export function buildRuntimeSecurityPolicy(grantedCapabilities = []) {
    const granted = normalizeCapabilityList(grantedCapabilities);
    const grantedSet = new Set(granted);

    const privilegedModules = new Set();
    for (const [capability, definition] of Object.entries(PLUGIN_CAPABILITY_DEFINITIONS)) {
        if (grantedSet.has(capability)) {
            continue;
        }
        const modules = definition?.grants?.modules || [];
        modules.forEach((entry) => privilegedModules.add(entry));
    }

    return {
        grantedCapabilities: granted,
        blockedModules: [...privilegedModules].sort((left, right) => left.localeCompare(right)),
    };
}
