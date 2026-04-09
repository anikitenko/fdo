import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    executeHostPrivilegedAction,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ,
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE,
    HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE,
    HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE,
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
    HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN,
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

function fallbackProcessExecRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
        payload: {
            scope: "system-observe",
            command: "/usr/bin/hostname",
            args: [],
            cwd: os.tmpdir(),
            env: {},
            timeoutMs: 1000,
            ...payload,
        },
    };
}

function workflowRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN,
        payload: {
            kind: "process-sequence",
            scope: "docker-cli",
            title: "Inspect and apply docker workflow",
            summary: "Inspect running containers before applying a follow-up action",
            steps: [
                {
                    id: "inspect",
                    title: "Inspect containers",
                    command: "/usr/local/bin/docker",
                    args: ["ps"],
                    cwd: os.tmpdir(),
                    env: {DOCKER_CONTEXT: "default"},
                    timeoutMs: 1000,
                    onError: "abort",
                },
                {
                    id: "apply",
                    title: "Pull image",
                    command: "/usr/local/bin/docker",
                    args: ["pull", "alpine:latest"],
                    cwd: os.tmpdir(),
                    env: {DOCKER_CONTEXT: "default"},
                    timeoutMs: 1000,
                    onError: "abort",
                },
            ],
            confirmation: {
                message: "Run the workflow?",
                requiredForStepIds: ["apply"],
            },
            ...payload,
        },
    };
}

function fallbackWorkflowRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN,
        payload: {
            kind: "process-sequence",
            scope: "system-observe",
            title: "Observe host basics",
            summary: "Inspect basic host state before follow-up diagnostics",
            steps: [
                {
                    id: "hostname",
                    title: "Read hostname",
                    command: "/usr/bin/hostname",
                    args: [],
                    cwd: os.tmpdir(),
                    env: {},
                    timeoutMs: 1000,
                    onError: "abort",
                },
            ],
            confirmation: {
                message: "Run fallback workflow?",
                requiredForStepIds: ["hostname"],
            },
            ...payload,
        },
    };
}

function clipboardReadRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ,
        payload: {
            ...payload,
        },
    };
}

function clipboardWriteRequest(payload = {}) {
    return {
        action: HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE,
        payload: {
            text: "hello clipboard",
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

    test("clipboard read returns host text and emits approval/audit trail", async () => {
        const confirmPrivilegedAction = jest.fn(async () => true);
        const audits = [];
        const result = await executeHostPrivilegedAction(clipboardReadRequest({
            reason: "Read copied plan",
        }), {
            pluginId: "clipboard-plugin",
            correlationId: "corr-clipboard-read",
            grantedCapabilities: ["system.hosts.write", "system.clipboard.read"],
            confirmPrivilegedAction,
            onAudit: (event) => audits.push(event),
        }, {
            readClipboardText: async () => "terraform plan output",
            writeClipboardText: async () => undefined,
        });

        expect(result).toEqual({
            ok: true,
            correlationId: "corr-clipboard-read",
            result: {
                text: "terraform plan output",
            },
        });
        expect(confirmPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(audits.some((event) => event.action === "system.clipboard.read" && event.confirmationDecision === "approved")).toBe(true);
        expect(audits.some((event) => event.action === "system.clipboard.read" && event.success === true && event.result?.result?.textLength === 21)).toBe(true);
    });

    test("clipboard read denied when base capability is missing", async () => {
        const result = await executeHostPrivilegedAction(clipboardReadRequest({
            reason: "Need data",
        }), {
            pluginId: "clipboard-plugin",
            correlationId: "corr-clipboard-read-denied",
            grantedCapabilities: ["system.clipboard.read"],
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CAPABILITY_DENIED",
            correlationId: "corr-clipboard-read-denied",
            error: "Missing required capability: system.hosts.write.",
        }));
    });

    test("clipboard write returns bytesWritten and is auditable", async () => {
        const writes = [];
        const audits = [];
        const result = await executeHostPrivilegedAction(clipboardWriteRequest({
            text: "k8s output",
            reason: "Copy for terminal",
        }), {
            pluginId: "clipboard-plugin",
            correlationId: "corr-clipboard-write",
            grantedCapabilities: ["system.hosts.write", "system.clipboard.write"],
            onAudit: (event) => audits.push(event),
        }, {
            readClipboardText: async () => "",
            writeClipboardText: async (text) => {
                writes.push(text);
            },
        });

        expect(result).toEqual({
            ok: true,
            correlationId: "corr-clipboard-write",
            result: {
                bytesWritten: 10,
            },
        });
        expect(writes).toEqual(["k8s output"]);
        expect(audits.some((event) => event.action === "system.clipboard.write" && event.success === true)).toBe(true);
    });

    test("clipboard write validates non-empty text", async () => {
        const result = await executeHostPrivilegedAction(clipboardWriteRequest({
            text: "   ",
        }), {
            pluginId: "clipboard-plugin",
            correlationId: "corr-clipboard-write-invalid",
            grantedCapabilities: ["system.hosts.write", "system.clipboard.write"],
        }, {
            readClipboardText: async () => "",
            writeClipboardText: async () => undefined,
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "VALIDATION_FAILED",
            correlationId: "corr-clipboard-write-invalid",
        }));
        expect(result.error).toContain("clipboard write field \"text\" must be a non-empty string");
    });

    test("clipboard operation surfaces unsupported host clipboard path", async () => {
        const result = await executeHostPrivilegedAction(clipboardReadRequest(), {
            pluginId: "clipboard-plugin",
            correlationId: "corr-clipboard-unsupported",
            grantedCapabilities: ["system.hosts.write", "system.clipboard.read"],
            confirmPrivilegedAction: async () => true,
        }, {
            readClipboardText: async () => {
                const error = new Error("Clipboard unsupported in this runtime");
                error.code = "CLIPBOARD_UNSUPPORTED";
                throw error;
            },
            writeClipboardText: async () => undefined,
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "CLIPBOARD_UNSUPPORTED",
            correlationId: "corr-clipboard-unsupported",
        }));
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
                cwd: os.tmpdir(),
                durationMs: expect.any(Number),
                dryRun: false,
            },
        });
    });

    test("reuses scoped process approval for the current plugin session", async () => {
        const confirmPrivilegedAction = jest.fn(async () => true);
        const approvalSessionStore = new Map();

        const first = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "docker-plugin",
            correlationId: "corr-docker-session-1",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction,
            approvalSessionStore,
        }, {
            runProcess: async () => ({
                exitCode: 0,
                stdout: Buffer.from("ok"),
                stderr: Buffer.from(""),
                timedOut: false,
            }),
        });

        const second = await executeHostPrivilegedAction(processExecRequest({
            args: ["ps"],
        }), {
            pluginId: "docker-plugin",
            correlationId: "corr-docker-session-2",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction,
            approvalSessionStore,
        }, {
            runProcess: async () => ({
                exitCode: 0,
                stdout: Buffer.from("ok"),
                stderr: Buffer.from(""),
                timedOut: false,
            }),
        });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(confirmPrivilegedAction).toHaveBeenCalledTimes(1);
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
        expect(result.error).toBe("Missing required capability: system.process.exec.");
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
        expect(result.error).toBe("Missing required capability: system.process.scope.docker-cli.");
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

    test("classifies missing executable as an explicit CLI-not-found failure", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-os-error",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async () => {
                const error = new Error("spawn /usr/local/bin/docker ENOENT");
                error.code = "ENOENT";
                throw error;
            },
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "PROCESS_SPAWN_ENOENT",
            correlationId: "corr-proc-os-error",
        }));
        expect(result.error).toContain('Executable "/usr/local/bin/docker" was not found');
    });

    test("confirmation copy describes curated operator actions before approval", async () => {
        let confirmPayload = null;
        await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "proc-plugin",
            correlationId: "corr-curated-confirm",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async (payload) => {
                confirmPayload = payload;
                return false;
            },
        });

        expect(confirmPayload).toEqual(expect.objectContaining({
            title: "Confirm Curated Operator Action",
        }));
        expect(confirmPayload.message).toContain('curated operator tool "docker"');
        expect(confirmPayload.detail).toContain("Scope type: Curated operator scope");
        expect(confirmPayload.detail).toContain("Broad capability: system.process.exec");
        expect(confirmPayload.detail).toContain("Narrow scope: system.process.scope.docker-cli");
    });

    test("confirmation copy describes fallback host actions before approval", async () => {
        let confirmPayload = null;
        await executeHostPrivilegedAction(fallbackProcessExecRequest(), {
            pluginId: "proc-plugin",
            correlationId: "corr-fallback-confirm",
            grantedCapabilities: ["system.process.exec", "system.process.scope.system-observe"],
            confirmPrivilegedAction: async (payload) => {
                confirmPayload = payload;
                return false;
            },
        });

        expect(confirmPayload).toEqual(expect.objectContaining({
            title: "Confirm Fallback Host Action",
        }));
        expect(confirmPayload.message).toContain('fallback host tool "hostname"');
        expect(confirmPayload.detail).toContain("Scope type: Host-specific fallback scope");
        expect(confirmPayload.detail).toContain("Prefer curated operator fixtures, presets, or workflows when they fit.");
        expect(confirmPayload.detail).toContain("Narrow scope: system.process.scope.system-observe");
    });

    test("returns explicit failure for non-zero single-action process exit codes", async () => {
        const result = await executeHostPrivilegedAction(processExecRequest(), {
            pluginId: "proc-plugin",
            correlationId: "corr-proc-exit-nonzero",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async () => ({
                exitCode: 2,
                stdout: Buffer.from(""),
                stderr: Buffer.from("terraform failed"),
                timedOut: false,
            }),
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "PROCESS_EXIT_NON_ZERO",
            correlationId: "corr-proc-exit-nonzero",
        }));
        expect(result.result).toEqual(expect.objectContaining({
            exitCode: 2,
            stderr: "terraform failed",
            cwd: os.tmpdir(),
            dryRun: false,
        }));
    });

    test("workflow reuses process capability pair and returns typed per-step results with summary", async () => {
        const audits = [];
        const result = await executeHostPrivilegedAction(workflowRequest(), {
            pluginId: "workflow-plugin",
            correlationId: "corr-workflow",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
            onAudit: (event) => audits.push(event),
        }, {
            runProcess: async (plan) => ({
                exitCode: 0,
                stdout: Buffer.from(`${path.basename(plan.command)} ${plan.args.join(" ")}`),
                stderr: Buffer.from(""),
                timedOut: false,
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.result.workflowId).toEqual(expect.stringMatching(/^docker-cli-/));
        expect(result.result.kind).toBe("process-sequence");
        expect(result.result.status).toBe("completed");
        expect(result.result.summary).toEqual(expect.objectContaining({
            totalSteps: 2,
            completedSteps: 2,
            failedSteps: 0,
            skippedSteps: 0,
        }));
        expect(result.result.steps[0]).toEqual(expect.objectContaining({
            stepId: "inspect",
            title: "Inspect containers",
            status: "ok",
            correlationId: expect.stringContaining("corr-workflow:step:1:inspect"),
            result: expect.objectContaining({
                command: "/usr/local/bin/docker",
                args: ["ps"],
                cwd: os.tmpdir(),
                exitCode: 0,
                stdout: "docker ps",
                stderr: "",
                durationMs: expect.any(Number),
                dryRun: false,
            }),
        }));
        expect(audits.some((event) => event.workflowId === result.result.workflowId)).toBe(true);
        expect(audits.some((event) => event.stepId === "inspect" && event.stepTitle === "Inspect containers")).toBe(true);
        expect(audits.some((event) => event.stepId === "apply" && event.stepTitle === "Pull image")).toBe(true);
        expect(audits.some((event) => event.confirmationDecision === "approved")).toBe(true);
    });

    test("workflow returns explicit step failure details and stops on first failing step", async () => {
        const result = await executeHostPrivilegedAction(workflowRequest(), {
            pluginId: "workflow-plugin",
            correlationId: "corr-workflow-fail",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async () => true,
        }, {
            runProcess: async (plan) => ({
                exitCode: plan.args[0] === "pull" ? 2 : 0,
                stdout: Buffer.from(""),
                stderr: Buffer.from(plan.args[0] === "pull" ? "pull failed" : ""),
                timedOut: false,
            }),
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            code: "STEP_FAILED",
            correlationId: "corr-workflow-fail",
            details: expect.objectContaining({
                workflowId: expect.stringMatching(/^docker-cli-/),
                title: "Inspect and apply docker workflow",
                status: "partial",
                steps: expect.arrayContaining([
                    expect.objectContaining({stepId: "inspect", status: "ok"}),
                    expect.objectContaining({stepId: "apply", title: "Pull image", status: "error", code: "EXIT_CODE"}),
                ]),
                summary: expect.objectContaining({
                    totalSteps: 2,
                    completedSteps: 1,
                    failedSteps: 1,
                    skippedSteps: 0,
                }),
            }),
        }));
    });

    test("workflow confirmation copy distinguishes curated and fallback workflows", async () => {
        let curatedConfirm = null;
        await executeHostPrivilegedAction(workflowRequest(), {
            pluginId: "workflow-plugin",
            correlationId: "corr-workflow-curated-confirm",
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            confirmPrivilegedAction: async (payload) => {
                curatedConfirm = payload;
                return false;
            },
        });

        expect(curatedConfirm.title).toBe("Confirm Curated Operator Workflow");
        expect(curatedConfirm.detail).toContain("Scope type: Curated operator scope");

        let fallbackConfirm = null;
        await executeHostPrivilegedAction(fallbackWorkflowRequest(), {
            pluginId: "workflow-plugin",
            correlationId: "corr-workflow-fallback-confirm",
            grantedCapabilities: ["system.process.exec", "system.process.scope.system-observe"],
            confirmPrivilegedAction: async (payload) => {
                fallbackConfirm = payload;
                return false;
            },
        });

        expect(fallbackConfirm.title).toBe("Confirm Fallback Host Workflow");
        expect(fallbackConfirm.detail).toContain("Scope type: Host-specific fallback scope");
        expect(fallbackConfirm.detail).toContain("Broad capability: system.process.exec");
        expect(fallbackConfirm.detail).toContain("Narrow scope: system.process.scope.system-observe");
    });
});
