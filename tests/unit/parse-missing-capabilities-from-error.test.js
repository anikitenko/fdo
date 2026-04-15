import {
    parseMissingCapabilitiesFromError,
    parseMissingCapabilityDiagnosticsFromError,
} from "../../src/utils/parseMissingCapabilitiesFromError";

describe("parseMissingCapabilitiesFromError", () => {
    test("parses single capability requirement format", () => {
        const result = parseMissingCapabilitiesFromError('Capability "system.hosts.write" is required.');
        expect(result).toEqual(["system.host.write"]);
    });

    test("parses multiple capability requirement format", () => {
        const result = parseMissingCapabilitiesFromError('Capabilities "system.hosts.write" and "system.fs.scope.etc-hosts" are required.');
        expect(result).toEqual(["system.host.write", "system.fs.scope.etc-hosts"]);
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

    test("expands SDK-style network base capability errors into concrete outbound web guidance", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            'Capability "system.network" is required to prefetch original configured repository metadata. Configure PluginRegistry.configureCapabilities({ granted: ["system.network"] }) in the host before plugin initialization.'
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.network",
                action: "prefetch original configured repository metadata",
                label: "Network access",
                source: "sdk",
                remediation: expect.stringContaining('exact transport capability'),
            }),
            expect.objectContaining({
                capability: "system.network.https",
                action: "prefetch original configured repository metadata",
                label: "HTTPS requests",
                source: "sdk",
            }),
            expect.objectContaining({
                capability: "system.network.scope.public-web-secure",
                action: "prefetch original configured repository metadata",
                label: "Secure Public Web Scope",
                source: "sdk",
            }),
        ]));
    });

    test("parses SDK-style network capability guidance when embedded inside multiline UI text", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            [
                "Plugin test-doc12: The plugin requested a privileged action that is not currently granted.",
                "",
                'Capability "system.network" is required to prefetch original configured repository metadata. Configure PluginRegistry.configureCapabilities({ granted: ["system.network"] }) in the host before plugin initialization.',
            ].join("\n")
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.network",
                source: "sdk",
            }),
            expect.objectContaining({
                capability: "system.network.https",
                source: "sdk",
            }),
            expect.objectContaining({
                capability: "system.network.scope.public-web-secure",
                source: "sdk",
            }),
        ]));
    });

    test("expands localhost-oriented network errors into loopback scope guidance", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            'Capability "system.network" is required to fetch localhost development metadata from http://127.0.0.1:3000/status.'
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.network",
                label: "Network access",
            }),
            expect.objectContaining({
                capability: "system.network.http",
                label: "Plain HTTP requests",
            }),
            expect.objectContaining({
                capability: "system.network.scope.loopback-dev",
                label: "Loopback Development Scope",
            }),
        ]));
    });

    test("builds structured diagnostics for host-style plural capability errors", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            'Capabilities "system.hosts.write" and "system.fs.scope.etc-hosts" are required.'
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.host.write",
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

    test("parses missing required capabilities format from newer host responses", () => {
        const result = parseMissingCapabilitiesFromError(
            "Missing required capabilities: system.process.exec, system.process.scope.terraform."
        );

        expect(result).toEqual(["system.process.exec", "system.process.scope.terraform"]);
    });

    test("parses missing required capability format (singular) from host responses", () => {
        const result = parseMissingCapabilitiesFromError(
            "Missing required capability: system.process.exec."
        );

        expect(result).toEqual(["system.process.exec"]);
    });

    test("builds structured diagnostics for newer host missing required capabilities format", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            "Missing required capabilities: system.process.exec, system.process.scope.terraform."
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.process.exec",
                label: "Allow Scoped Tool Execution",
                source: "host",
            }),
            expect.objectContaining({
                capability: "system.process.scope.terraform",
                label: "Terraform Scope",
                source: "host",
            }),
        ]));
    });

    test("parses clipboard read/write capability gaps with actionable remediation", () => {
        const result = parseMissingCapabilityDiagnosticsFromError(
            "Missing required capabilities: system.clipboard.read, system.clipboard.write."
        );

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "system.clipboard.read",
                label: "Read Host Clipboard",
                source: "host",
                remediation: expect.stringContaining("system.clipboard.read"),
            }),
            expect.objectContaining({
                capability: "system.clipboard.write",
                label: "Write Host Clipboard",
                source: "host",
                remediation: expect.stringContaining("system.clipboard.write"),
            }),
        ]));
    });

    test("does not misclassify validation messages that list allowed actions as missing capabilities", () => {
        const result = parseMissingCapabilitiesFromError(
            'Host privileged action "action" must be "system.host.write", "system.fs.mutate", "system.process.exec", "system.workflow.run", "system.clipboard.read", or "system.clipboard.write".'
        );

        expect(result).toEqual([]);
    });
});
