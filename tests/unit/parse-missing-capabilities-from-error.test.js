import {
    parseMissingCapabilitiesFromError,
    parseMissingCapabilityDiagnosticsFromError,
} from "../../src/utils/parseMissingCapabilitiesFromError";

describe("parseMissingCapabilitiesFromError", () => {
    test("parses single capability requirement format", () => {
        const result = parseMissingCapabilitiesFromError('Capability "system.hosts.write" is required.');
        expect(result).toEqual(["system.hosts.write"]);
    });

    test("parses multiple capability requirement format", () => {
        const result = parseMissingCapabilitiesFromError('Capabilities "system.hosts.write" and "system.fs.scope.etc-hosts" are required.');
        expect(result).toEqual(["system.hosts.write", "system.fs.scope.etc-hosts"]);
    });

    test("parses system.process.exec requirement", () => {
        const result = parseMissingCapabilitiesFromError('Capability "system.process.exec" is required.');
        expect(result).toEqual(["system.process.exec"]);
    });

    test("parses system.process.scope.docker-cli requirement", () => {
        const result = parseMissingCapabilitiesFromError('Capabilities "system.process.exec" and "system.process.scope.docker-cli" are required.');
        expect(result).toEqual(["system.process.exec", "system.process.scope.docker-cli"]);
    });

    test("builds structured diagnostics for SDK-style missing capability errors", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            'Capability "system.process.exec" is required to run docker status. Configure PluginRegistry.configureCapabilities({ granted: ["system.process.exec"] }) in the host before plugin initialization.'
        );

        expect(result).toEqual([
            expect.objectContaining({
                capability: "system.process.exec",
                action: "run docker status",
                category: "system",
                label: "Allow Scoped Tool Execution",
                source: "sdk",
            }),
        ]);
    });

    test("builds structured diagnostics for host-style plural capability errors", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            'Capabilities "system.hosts.write" and "system.fs.scope.etc-hosts" are required.'
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.hosts.write",
                label: "Privileged host actions",
                source: "host",
            }),
            expect.objectContaining({
                capability: "system.fs.scope.etc-hosts",
                label: "Filesystem Scope: etc-hosts",
                source: "host",
            }),
        ]));
    });
});
