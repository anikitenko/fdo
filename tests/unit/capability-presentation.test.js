import {getCapabilityPresentation} from "../../src/utils/capabilityPresentation.js";

describe("capability presentation", () => {
    test("renders friendly labels for process execution capabilities", () => {
        expect(getCapabilityPresentation("system.process.exec")).toEqual(expect.objectContaining({
            title: "Allow Scoped Tool Execution",
            description: expect.stringContaining("Broad capability"),
        }));

        expect(getCapabilityPresentation("system.process.scope.docker-cli", [{
            scope: "docker-cli",
            kind: "process",
        }])).toEqual(expect.objectContaining({
            title: "Docker CLI Scope",
            description: expect.stringContaining("Narrow scope"),
        }));
        expect(getCapabilityPresentation("system.process.scope.system-inspect", [{
            scope: "system-inspect",
            kind: "process",
        }])).toEqual(expect.objectContaining({
            title: "System Inspect Scope",
            description: expect.stringContaining("host-specific fallback scope"),
        }));
        expect(getCapabilityPresentation("system.process.scope.system-observe", [{
            scope: "system-observe",
            kind: "process",
        }]).title).toBe("System Observe Scope");
        expect(getCapabilityPresentation("system.process.scope.network-diagnostics", [{
            scope: "network-diagnostics",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.service-management", [{
            scope: "service-management",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.archive-tools", [{
            scope: "archive-tools",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.homebrew", [{
            scope: "homebrew",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.package-management", [{
            scope: "package-management",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.source-control", [{
            scope: "source-control",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.build-tooling", [{
            scope: "build-tooling",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.task-runners", [{
            scope: "task-runners",
            kind: "process",
        }]).description).toContain("Host-specific fallback scope");
        expect(getCapabilityPresentation("system.process.scope.ansible", [{
            scope: "ansible",
            kind: "process",
        }]).title).toBe("Ansible Scope");
        expect(getCapabilityPresentation("system.process.scope.aws-cli", [{
            scope: "aws-cli",
            kind: "process",
        }]).title).toBe("AWS CLI Scope");
        expect(getCapabilityPresentation("system.process.scope.gcloud", [{
            scope: "gcloud",
            kind: "process",
        }]).title).toBe("Google Cloud CLI Scope");
        expect(getCapabilityPresentation("system.process.scope.azure-cli", [{
            scope: "azure-cli",
            kind: "process",
        }]).title).toBe("Azure CLI Scope");
        expect(getCapabilityPresentation("system.process.scope.podman", [{
            scope: "podman",
            kind: "process",
        }]).title).toBe("Podman Scope");
        expect(getCapabilityPresentation("system.process.scope.kustomize", [{
            scope: "kustomize",
            kind: "process",
        }]).title).toBe("Kustomize Scope");
        expect(getCapabilityPresentation("system.process.scope.gh", [{
            scope: "gh",
            kind: "process",
        }]).title).toBe("GitHub CLI Scope");
        expect(getCapabilityPresentation("system.process.scope.git", [{
            scope: "git",
            kind: "process",
        }]).title).toBe("Git Scope");
        expect(getCapabilityPresentation("system.process.scope.vault", [{
            scope: "vault",
            kind: "process",
        }]).title).toBe("Vault Scope");
        expect(getCapabilityPresentation("system.process.scope.nomad", [{
            scope: "nomad",
            kind: "process",
        }]).title).toBe("Nomad Scope");
        expect(getCapabilityPresentation("system.clipboard.read")).toEqual(expect.objectContaining({
            title: "Read Host Clipboard",
            description: expect.stringContaining("sensitive"),
            dependsOn: ["system.host.write"],
        }));
        expect(getCapabilityPresentation("system.clipboard.write")).toEqual(expect.objectContaining({
            title: "Write Host Clipboard",
            description: expect.stringMatching(/separate/i),
            dependsOn: ["system.host.write"],
        }));
    });

    test("renders generic fallback labels for unknown process scopes", () => {
        expect(getCapabilityPresentation("system.process.scope.custom-ops", [{
            scope: "custom-ops",
            kind: "process",
        }])).toEqual(expect.objectContaining({
            title: "Process Scope: custom-ops",
            description: expect.stringContaining('scope "custom-ops"'),
        }));
    });

    test("renders deterministic fallback labels for filesystem scopes", () => {
        expect(getCapabilityPresentation("system.fs.scope.custom-fs")).toEqual(expect.objectContaining({
            title: "Filesystem Scope: custom-fs",
            description: 'Allows host-approved filesystem access inside scope "custom-fs".',
        }));
    });
});
