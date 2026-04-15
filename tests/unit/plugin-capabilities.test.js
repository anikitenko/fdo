import {
    buildRuntimeSecurityPolicy,
    KNOWN_PLUGIN_CAPABILITIES,
    normalizeCapabilityList,
} from "../../src/utils/pluginCapabilities";

describe("plugin capability registry", () => {
    test("normalizes capabilities to known unique values", () => {
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("storage.json")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.https")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.http")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.websocket")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.tcp")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.udp")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.network.dns")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.process.exec")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.clipboard.read")).toBe(true);
        expect(KNOWN_PLUGIN_CAPABILITIES.includes("system.clipboard.write")).toBe(true);
        expect(normalizeCapabilityList(["storage.json", "storage.json", "unknown"])).toEqual(["storage.json"]);
        expect(normalizeCapabilityList(["system.network", "system.network.https", "system.network.http"])).toEqual(["system.network", "system.network.https", "system.network.http"]);
        expect(normalizeCapabilityList(["system.network.scope.public-web-secure"])).toEqual(["system.network.scope.public-web-secure"]);
        expect(normalizeCapabilityList(["system.fs.scope.etc-hosts"])).toEqual(["system.fs.scope.etc-hosts"]);
        expect(normalizeCapabilityList(["system.process.scope.docker-cli"])).toEqual(["system.process.scope.docker-cli"]);
        expect(normalizeCapabilityList(["system.clipboard.read", "system.clipboard.write"])).toEqual(["system.clipboard.read", "system.clipboard.write"]);
        expect(normalizeCapabilityList(null)).toEqual([]);
    });

    test("builds blocked module policy from missing grants", () => {
        const denyAll = buildRuntimeSecurityPolicy([]);
        expect(denyAll.blockedModules).toEqual(["@expo/sudo-prompt", "child_process", "node:child_process"]);
        expect(denyAll.networkAccess).toEqual({https: false, http: false, websocket: false, tcp: false, udp: false, dns: false});

        const allowSudo = buildRuntimeSecurityPolicy(["sudo.prompt"]);
        expect(allowSudo.blockedModules).toEqual([]);
        expect(allowSudo.networkAccess).toEqual({https: false, http: false, websocket: false, tcp: false, udp: false, dns: false});

        const allowNetworkHttp = buildRuntimeSecurityPolicy(["system.network", "system.network.https", "system.network.http", "system.network.websocket"]);
        expect(allowNetworkHttp.networkAccess).toEqual({https: true, http: true, websocket: true, tcp: false, udp: false, dns: false});
        expect(allowNetworkHttp.networkScopes).toEqual([]);

        const scopedNetwork = buildRuntimeSecurityPolicy(["system.network", "system.network.https", "system.network.scope.public-web-secure"]);
        expect(scopedNetwork.networkScopes).toEqual(expect.arrayContaining([
            expect.objectContaining({scope: "public-web-secure"})
        ]));
    });
});
