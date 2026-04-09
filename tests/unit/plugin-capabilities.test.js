import {
    buildRuntimeSecurityPolicy,
    KNOWN_PLUGIN_CAPABILITIES,
    normalizeCapabilityList,
} from "../../src/utils/pluginCapabilities";

describe("plugin capability registry", () => {
    test("normalizes capabilities to known unique values", () => {
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("storage.json")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.process.exec")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.clipboard.read")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.clipboard.write")).toBe(true);
        expect(normalizeCapabilityList(["storage.json", "storage.json", "unknown"])).toEqual(["storage.json"]);
        expect(normalizeCapabilityList(["system.fs.scope.etc-hosts"])).toEqual(["system.fs.scope.etc-hosts"]);
        expect(normalizeCapabilityList(["system.process.scope.docker-cli"])).toEqual(["system.process.scope.docker-cli"]);
        expect(normalizeCapabilityList(["system.clipboard.read", "system.clipboard.write"])).toEqual(["system.clipboard.read", "system.clipboard.write"]);
        expect(normalizeCapabilityList(null)).toEqual([]);
    });

    test("builds blocked module policy from missing grants", () => {
        const denyAll = buildRuntimeSecurityPolicy([]);
        expect(denyAll.blockedModules).toEqual(["@expo/sudo-prompt", "child_process", "node:child_process"]);

        const allowSudo = buildRuntimeSecurityPolicy(["sudo.prompt"]);
        expect(allowSudo.blockedModules).toEqual([]);
    });
});
