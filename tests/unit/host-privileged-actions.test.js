import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    executeHostPrivilegedAction,
    HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE,
    HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE,
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
} from "../../src/utils/hostPrivilegedActions";

function hostsRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE,
        payload: {
            records: [{address: "127.0.0.1", hostname: "demo.local"}],
            ...payload,
        },
    };
}

function fsMutateRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE,
        payload: {
            scope: "etc-hosts",
            operations: [],
            ...payload,
        },
    };
}

function processExecRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
        payload: {
            scope: "docker-cli",
            command: "/usr/local/bin/docker",
            args: ["version"],
            cwd: os.tmpdir(),
            env: {DOCKER_CONTEXT: "default"},
            timeoutMs: 1000,
            ...payload,
        },
    };
}

describe("host privileged actions", () => {
    test("validator rejection path propagates stable error response", async () => {
        const result = await executeHostPrivilegedAction({
            action: HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE,
            payload: {scope: "etc-hosts", operations: []},
        }, {
            pluginId: "p1",
            correlationId: "corr-validator",
            grantedCapabilities: ["system.hosts.write", "system.fs.scope.etc-hosts"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "VALIDATION_FAILED",
            correlationId: "corr-validator",
        }));
    });

    test("missing capability -> denied before execution", async () => {
        const result = await executeHostPrivilegedAction(hostsRequest(), {
            pluginId: "p2",
            correlationId: "corr-denied",
            grantedCapabilities: [],
            hostsPath: "/tmp/test-hosts-denied",
        }, {
            readText: async () => "127.0.0.1 localhost\n",
            writeText: async () => undefined,
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CAPABILITY_DENIED",
            correlationId: "corr-denied",
        }));
    });

    test("missing or unknown scope capability -> denied", async () => {
        const result = await executeHostPrivilegedAction(fsMutateRequest({
            operations: [{type: "mkdir", path: "/etc/test-hosts-scope"}],
        }), {
            pluginId: "p3",
            correlationId: "corr-scope-cap",
            grantedCapabilities: ["system.hosts.write"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CAPABILITY_DENIED",
            correlationId: "corr-scope-cap",
        }));
    });

    test("operation outside scope roots -> denied", async () => {
        const result = await executeHostPrivilegedAction(fsMutateRequest({
            operations: [{type: "writeFile", path: "/tmp/not-allowed", content: "x"}],
        }), {
            pluginId: "p4",
            correlationId: "corr-outside",
            grantedCapabilities: ["system.hosts.write", "system.fs.scope.etc-hosts"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_VIOLATION",
            correlationId: "corr-outside",
        }));
    });

    test("disallowed operation type within scope -> denied", async () => {
        const result = await executeHostPrivilegedAction(fsMutateRequest({
            operations: [{type: "chmod", path: "/etc/test-hosts"}],
        }), {
            pluginId: "p5",
            correlationId: "corr-disallowed-op",
            grantedCapabilities: ["system.hosts.write", "system.fs.scope.etc-hosts"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "VALIDATION_FAILED",
            correlationId: "corr-disallowed-op",
        }));
    });

    test("dryRun computes plan with no writes", async () => {
        const writes = [];
        const result = await executeHostPrivilegedAction(hostsRequest({dryRun: true, tag: "dev"}), {
            pluginId: "p6",
            correlationId: "corr-dry",
            grantedCapabilities: ["system.hosts.write"],
            hostsPath: "/tmp/test-hosts-dry",
        }, {
            readText: async () => "127.0.0.1 localhost\n",
            writeText: async (...args) => writes.push(args),
        });

        expect(result.ok).toBe(true);
        expect(result.result.dryRun).toBe(true);
        expect(result.result.plan.section).toContain("# BEGIN FDO:p6:dev");
        expect(writes).toHaveLength(0);
    });

    test("confirmed apply writes only approved targets and keeps unrelated lines", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-hosts-confirm-"));
        const hostsPath = path.join(tempDir, "test-hosts");
        fs.writeFileSync(hostsPath, "127.0.0.1 localhost\n10.0.0.1 keep.me # keep\n", "utf8");
        try {
            const result = await executeHostPrivilegedAction(hostsRequest({
                tag: "stable",
                records: [{address: "10.10.0.5", hostname: "api.local", comment: "api"}],
            }), {
                pluginId: "p7",
                correlationId: "corr-apply",
                grantedCapabilities: ["system.hosts.write"],
                hostsPath,
                confirmWrite: async () => true,
            });

            expect(result.ok).toBe(true);
            expect(result.result.changed).toBe(true);
            const updated = fs.readFileSync(hostsPath, "utf8");
            expect(updated).toContain("10.0.0.1 keep.me # keep");
            expect(updated).toContain("# BEGIN FDO:p7:stable");
            expect(updated).toContain("10.10.0.5 api.local # api");
        } finally {
            fs.rmSync(tempDir, {recursive: true, force: true});
        }
    });

    test("cancellation leaves filesystem unchanged", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-hosts-cancel-"));
        const hostsPath = path.join(tempDir, "test-hosts");
        const initial = "127.0.0.1 localhost\n";
        fs.writeFileSync(hostsPath, initial, "utf8");
        try {
            const result = await executeHostPrivilegedAction(hostsRequest({tag: "cancel"}), {
                pluginId: "p8",
                correlationId: "corr-cancel",
                grantedCapabilities: ["system.hosts.write"],
                hostsPath,
                confirmWrite: async () => false,
            });
            expect(result).toEqual(expect.objectContaining({
                ok: false,
                code: "CANCELLED",
                correlationId: "corr-cancel",
            }));
            expect(fs.readFileSync(hostsPath, "utf8")).toBe(initial);
        } finally {
            fs.rmSync(tempDir, {recursive: true, force: true});
        }
    });

    test("audit event emitted on success and denial", async () => {
        const events = [];
        const success = await executeHostPrivilegedAction(hostsRequest({dryRun: true}), {
            pluginId: "p9",
            correlationId: "corr-audit-ok",
            grantedCapabilities: ["system.hosts.write"],
            hostsPath: "/tmp/test-hosts-audit-ok",
            onAudit: (event) => events.push(event),
        }, {
            readText: async () => "127.0.0.1 localhost\n",
            writeText: async () => undefined,
        });
        const denied = await executeHostPrivilegedAction(hostsRequest({dryRun: true}), {
            pluginId: "p9",
            correlationId: "corr-audit-denied",
            grantedCapabilities: [],
            hostsPath: "/tmp/test-hosts-audit-denied",
            onAudit: (event) => events.push(event),
        }, {
            readText: async () => "127.0.0.1 localhost\n",
            writeText: async () => undefined,
        });

        expect(success.ok).toBe(true);
        expect(denied.ok).toBe(false);
        expect(events.some((event) => event.success === true && event.correlationId === "corr-audit-ok")).toBe(true);
        expect(events.some((event) => event.success === false && event.correlationId === "corr-audit-denied")).toBe(true);
    });

    test("valid docker-cli execution request", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "docker-plugin",
            correlationId: "corr-docker",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async (plan) => ({
                exitCode: 0,
                stdout: Buffer.from(`docker ${plan.args.join(" ")}`),
                stderr: Buffer.from(""),
                timedOut: false,
            }),
        });

        expect(result).toEqual({
            ok: true,
            correlationId: "corr-docker",
            result: {
                exitCode: 0,
                stdout: "docker version",
                stderr: "",
                timedOut: false,
                command: "/usr/local/bin/docker",
                args: ["version"],
            },
        });
    });

    test("valid kubectl execution request", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            scope: "kubectl",
            command: "/usr/local/bin/kubectl",
            args: ["get", "pods", "-A"],
            env: {KUBECONFIG: "/tmp/kubeconfig"},
        }), {
            pluginId: "k8s-plugin",
            correlationId: "corr-kubectl",
            grantedCapabilities: ["system.process.exec", "system.process.scope.kubectl"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async () => ({
                exitCode: 0,
                stdout: Buffer.from("NAME READY STATUS"),
                stderr: Buffer.from(""),
                timedOut: false,
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.result.command).toBe("/usr/local/bin/kubectl");
        expect(result.result.args).toEqual(["get", "pods", "-A"]);
    });

    test("missing broad capability", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "docker-plugin",
            correlationId: "corr-proc-cap",
            grantedCapabilities: ["system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CAPABILITY_DENIED",
            correlationId: "corr-proc-cap",
        }));
    });

    test("missing scope capability", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "docker-plugin",
            correlationId: "corr-proc-scope-cap",
            grantedCapabilities: ["system.process.exec"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CAPABILITY_DENIED",
            correlationId: "corr-proc-scope-cap",
        }));
    });

    test("unknown scope", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            scope: "unknown-tool",
            command: "/usr/local/bin/unknown-tool",
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-unknown",
            grantedCapabilities: ["system.process.exec", "system.process.scope.unknown-tool"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_DENIED",
            correlationId: "corr-proc-unknown",
        }));
    });

    test("non-absolute command", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            command: "docker",
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-nonabs",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "VALIDATION_FAILED",
            correlationId: "corr-proc-nonabs",
        }));
    });

    test("disallowed command", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            command: "/bin/sh",
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-cmd",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_VIOLATION",
            correlationId: "corr-proc-cmd",
        }));
    });

    test("disallowed cwd", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            cwd: "/etc",
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-cwd",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_VIOLATION",
            correlationId: "corr-proc-cwd",
        }));
    });

    test("invalid env key", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            env: {
                DOCKER_CONTEXT: "default",
                LD_PRELOAD: "hack.so",
            },
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-env",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_VIOLATION",
            correlationId: "corr-proc-env",
        }));
    });

    test("invalid args for scope", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            args: ["exec", "-it", "container", "bash"],
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-args",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "SCOPE_VIOLATION",
            correlationId: "corr-proc-args",
        }));
    });

    test("timeout enforcement", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            timeoutMs: 250,
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-timeout",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async () => ({
                exitCode: null,
                stdout: Buffer.from(""),
                stderr: Buffer.from("timed out"),
                timedOut: true,
            }),
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "TIMEOUT",
            correlationId: "corr-proc-timeout",
        }));
    });

    test("dry-run response", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest({
            dryRun: true,
        }), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-dry",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(result).toEqual({
            ok: true,
            correlationId: "corr-proc-dry",
            result: {
                dryRun: true,
                command: "/usr/local/bin/docker",
                args: ["version"],
                cwd: os.tmpdir(),
                scope: "docker-cli",
            },
        });
    });

    test("stable error envelope mapping", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-os-error",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async () => {
                throw new Error("spawn EPERM");
            },
        });

        expect(result).toEqual({
            ok: false,
            code: "OS_ERROR",
            error: "spawn EPERM",
            correlationId: "corr-proc-os-error",
        });
    });
});
