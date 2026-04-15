import {
    applyCapabilityToggle,
    buildScopeCapabilities,
    getSelectedScopeCapabilities,
    hasCapabilitySelectionChanges
} from "../../src/utils/pluginCapabilitySelection";

describe("pluginCapabilitySelection", () => {
    test("buildScopeCapabilities maps host scope policy to UI shape", () => {
        const result = buildScopeCapabilities([{
            scope: "etc-hosts",
            description: "Hosts updates",
            allowedRoots: ["/etc"],
            allowedOperationTypes: ["writeFile"],
            requireConfirmation: true,
        }]);

        expect(result).toEqual([{
            id: "etc-hosts",
            title: "",
            kind: "filesystem",
            category: "Filesystem",
            description: "Hosts updates",
            fallback: false,
            userDefined: false,
            capability: "system.fs.scope.etc-hosts",
            baseCapability: "system.host.write",
            allowedRoots: ["/etc"],
            allowedCwdRoots: [],
            allowedOperationTypes: ["writeFile"],
            allowedExecutables: [],
            allowedEnvKeys: [],
            allowedSchemes: [],
            allowedHostPatterns: [],
            allowedPorts: [],
            allowedTransports: [],
            additionalAllowedFirstArgs: [],
            additionalAllowedFirstArgsByExecutable: {},
            additionalAllowedLeadingOptions: [],
            additionalAllowedLeadingOptionsByExecutable: {},
            argumentPolicy: null,
            timeoutCeilingMs: null,
            requireConfirmation: true,
        }]);
    });

    test("maps process scope policies to UI shape", () => {
        const result = buildScopeCapabilities([{
            scope: "docker-cli",
            kind: "process",
            description: "Docker execution",
            allowedCwdRoots: ["/tmp"],
            allowedExecutables: ["/usr/local/bin/docker"],
            allowedEnvKeys: ["DOCKER_CONTEXT"],
            timeoutCeilingMs: 30000,
            requireConfirmation: true,
        }]);

        expect(result).toEqual([{
            id: "docker-cli",
            title: "",
            kind: "process",
            category: "Other Process Tools",
            description: "Docker execution",
            fallback: false,
            userDefined: false,
            capability: "system.process.scope.docker-cli",
            baseCapability: "system.process.exec",
            allowedRoots: [],
            allowedCwdRoots: ["/tmp"],
            allowedOperationTypes: [],
            allowedExecutables: ["/usr/local/bin/docker"],
            allowedEnvKeys: ["DOCKER_CONTEXT"],
            allowedSchemes: [],
            allowedHostPatterns: [],
            allowedPorts: [],
            allowedTransports: [],
            additionalAllowedFirstArgs: [],
            additionalAllowedFirstArgsByExecutable: {},
            additionalAllowedLeadingOptions: [],
            additionalAllowedLeadingOptionsByExecutable: {},
            argumentPolicy: null,
            timeoutCeilingMs: 30000,
            requireConfirmation: true,
        }]);
    });

    test("maps network scope policies to UI shape", () => {
        const result = buildScopeCapabilities([{
            scope: "public-web-secure",
            kind: "network",
            description: "Secure public web access",
            allowedSchemes: ["https", "wss"],
            allowedHostPatterns: ["*"],
            allowedPorts: ["*"],
            allowedTransports: ["fetch", "websocket"],
            requireConfirmation: false,
        }]);

        expect(result).toEqual([{
            id: "public-web-secure",
            title: "",
            kind: "network",
            category: "Network",
            description: "Secure public web access",
            fallback: false,
            userDefined: false,
            capability: "system.network.scope.public-web-secure",
            baseCapability: "system.network",
            allowedRoots: [],
            allowedCwdRoots: [],
            allowedOperationTypes: [],
            allowedExecutables: [],
            allowedEnvKeys: [],
            allowedSchemes: ["https", "wss"],
            allowedHostPatterns: ["*"],
            allowedPorts: ["*"],
            allowedTransports: ["fetch", "websocket"],
            additionalAllowedFirstArgs: [],
            additionalAllowedFirstArgsByExecutable: {},
            additionalAllowedLeadingOptions: [],
            additionalAllowedLeadingOptionsByExecutable: {},
            argumentPolicy: null,
            timeoutCeilingMs: null,
            requireConfirmation: false,
        }]);
    });

    test("disabling base capability removes scoped capabilities", () => {
        const next = applyCapabilityToggle(
            ["system.host.write", "system.fs.scope.etc-hosts"],
            {capability: "system.host.write", checked: false}
        );
        expect(next).toEqual([]);
    });

    test("capability change detection ignores ordering", () => {
        expect(hasCapabilitySelectionChanges(
            ["system.fs.scope.etc-hosts", "system.host.write"],
            ["system.host.write", "system.fs.scope.etc-hosts"]
        )).toBe(false);

        expect(hasCapabilitySelectionChanges(
            ["system.host.write"],
            ["system.host.write", "system.fs.scope.etc-hosts"]
        )).toBe(true);
    });

    test("getSelectedScopeCapabilities returns only scope capabilities from draft", () => {
        const scopes = buildScopeCapabilities([{scope: "etc-hosts"}]);
        const selected = getSelectedScopeCapabilities(
            ["system.host.write", "system.fs.scope.etc-hosts", "storage.json"],
            scopes
        );
        expect(selected).toEqual(["system.fs.scope.etc-hosts"]);
    });

    test("disabling process base capability removes process scope capabilities", () => {
        const next = applyCapabilityToggle(
            ["system.process.exec", "system.process.scope.docker-cli"],
            {capability: "system.process.exec", checked: false}
        );
        expect(next).toEqual([]);
    });
});
