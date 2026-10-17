import {describe, expect, jest, test} from "@jest/globals";

jest.mock("electron", () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock("../../src/main.js", () => ({
    PLUGINS_DIR: "/tmp/plugins",
    PLUGINS_REGISTRY_FILE: "/tmp/plugins-registry.json",
    USER_CONFIG_FILE: "/tmp/user-config.json",
}));

jest.mock("../../src/components/plugin/ValidatePlugin", () => ({
    __esModule: true,
    default: class ValidatePluginMock {
        async validate() { return {success: true}; }
    },
}));

jest.mock("../../src/utils/persistence/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {
        getAllPlugins() { return []; }
        getPlugin(id) { return {id, metadata: {name: "Fixture Plugin"}}; }
    },
}));

jest.mock("../../src/utils/persistence/UserORM", () => ({
    __esModule: true,
    default: class UserORMMock {
        getSharedProcessScopes() { return []; }
        getSharedFilesystemScopes() { return []; }
    },
}));

jest.mock("../../src/utils/plugins/runtime/PluginManager", () => ({
    __esModule: true,
    default: {getLoadedPlugin: jest.fn()},
}));

jest.mock("../../src/utils/system/certs", () => ({
    Certs: {
        signPlugin: jest.fn(() => ({success: true})),
        verifyPlugin: jest.fn(async () => ({success: true})),
    },
}));

jest.mock("../../src/utils/desktop/NotificationCenter", () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock("../../src/utils/desktop/editorWindow", () => ({editorWindow: {getWindow: jest.fn(() => null)}}));

jest.mock("../../src/utils/plugins/security/hostPrivilegedActions", () => ({
    HOST_PRIVILEGED_HANDLER: "__host.privilegedAction",
    executeHostPrivilegedAction: jest.fn(async (_request, ctx) => ({
        ok: true,
        correlationId: ctx.correlationId,
        result: {
            action: "system.hosts.write",
            dryRun: true,
            changed: false,
        },
    })),
}));

function registerUiHandler(grantedCapabilities) {
    const {ipcMain} = require("electron");
    const {registerPluginHandlers} = require("../../src/ipc/plugin");
    const {PluginChannels} = require("../../src/ipc/channels");
    const PluginManager = require("../../src/utils/plugins/runtime/PluginManager").default;
    const postMessage = jest.fn();
    PluginManager.getLoadedPlugin.mockReturnValue({ready: true, grantedCapabilities, instance: {postMessage}});
    const handle = jest.mocked(ipcMain.handle);
    handle.mockClear();
    registerPluginHandlers();
    const uiHandler = handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];
    return {postMessage, uiHandler};
}

describe("plugin IPC privileged action transport", () => {
    test("routes reserved host privileged handler with correlation id and returns response payload", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");

        const {postMessage, uiHandler} = registerUiHandler(["system.hosts.write"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "__host.privilegedAction",
            content: {
                correlationId: "corr-xyz",
                request: {
                    action: "system.hosts.write",
                    payload: {
                        records: [{address: "127.0.0.1", hostname: "demo.local"}],
                        dryRun: true,
                    },
                },
            },
        });

        expect(executeHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            correlationId: "corr-xyz",
            result: expect.objectContaining({
                action: "system.hosts.write",
            }),
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("routes SDK requestPrivilegedAction handler alias to the same host privileged transport", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");

        const {postMessage, uiHandler} = registerUiHandler(["system.process.exec", "system.process.scope.terraform"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "requestPrivilegedAction",
            content: {
                correlationId: "corr-sdk-alias",
                request: {
                    action: "system.process.exec",
                    payload: {
                        scope: "terraform",
                        command: "/usr/local/bin/terraform",
                        args: ["plan"],
                        cwd: "/tmp",
                    },
                },
            },
        });

        expect(executeHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            correlationId: "corr-sdk-alias",
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("accepts SDK backend envelope response shape when forwarded to requestPrivilegedAction", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");
        const {NotificationCenter} = require("../../src/utils/desktop/NotificationCenter");

        const {postMessage, uiHandler} = registerUiHandler(["system.hosts.write", "system.fs.scope.etc-motd"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "requestPrivilegedAction",
            content: {
                ok: true,
                result: {
                    correlationId: "etc-motd-corr",
                    request: {
                        action: "system.fs.mutate",
                        payload: {
                            scope: "etc-motd",
                            dryRun: true,
                            operations: [
                                {
                                    type: "appendFile",
                                    path: "/etc/motd",
                                    content: "demo",
                                    encoding: "utf8",
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(executeHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(executeHostPrivilegedAction).toHaveBeenCalledWith(expect.objectContaining({
            action: "system.fs.mutate",
        }), expect.objectContaining({
            correlationId: "etc-motd-corr",
        }));
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            correlationId: "etc-motd-corr",
        }));
        expect(NotificationCenter.addNotification).toHaveBeenCalledTimes(1);
        expect(NotificationCenter.addNotification.mock.calls[0][0]).toMatchObject({
            title: "Fixture Plugin uses an older permission interface",
            message: expect.stringContaining("compatibility support"),
            details: expect.stringContaining("requestPrivilegedActionFromEnvelope"),
            actions: [{kind: "manage-plugin", pluginId: "plugin-x"}],
            type: "warning",
        });
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("passes through forwarded backend failure payload without re-validating it as privileged request", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");

        executeHostPrivilegedAction.mockClear();
        const {postMessage, uiHandler} = registerUiHandler(["system.process.exec", "system.process.scope.git"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "requestPrivilegedAction",
            content: {
                ok: false,
                code: "PLUGIN_BACKEND_HANDLER_FAILED",
                error: "Repository path does not exist: /tmp/missing-repo",
                correlationId: "corr-build-request-failed",
            },
        });

        expect(executeHostPrivilegedAction).not.toHaveBeenCalled();
        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "PLUGIN_BACKEND_HANDLER_FAILED",
            error: "Repository path does not exist: /tmp/missing-repo",
            correlationId: "corr-build-request-failed",
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("routes process privileged action with correlation id and returns response payload", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");

        executeHostPrivilegedAction.mockImplementationOnce(async () => ({
            ok: true,
            correlationId: "corr-proc",
            result: {
                exitCode: 0,
                stdout: "docker version",
                stderr: "",
                timedOut: false,
                command: "/usr/local/bin/docker",
                args: ["version"],
            },
        }));
        const {postMessage, uiHandler} = registerUiHandler(["system.process.exec", "system.process.scope.docker-cli"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "__host.privilegedAction",
            content: {
                correlationId: "corr-proc",
                request: {
                    action: "system.process.exec",
                    payload: {
                        scope: "docker-cli",
                        command: "/usr/local/bin/docker",
                        args: ["version"],
                        cwd: "/tmp",
                    },
                },
            },
        });

        expect(executeHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            correlationId: "corr-proc",
            result: expect.objectContaining({
                command: "/usr/local/bin/docker",
            }),
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("routes workflow privileged action with correlation id and returns response payload", async () => {
        jest.resetModules();

        const {executeHostPrivilegedAction} = require("../../src/utils/plugins/security/hostPrivilegedActions");

        executeHostPrivilegedAction.mockImplementationOnce(async () => ({
            ok: true,
            correlationId: "corr-workflow",
            result: {
                workflowId: "wf-1",
                kind: "process-sequence",
                scope: "docker-cli",
                status: "completed",
                steps: [{
                    stepId: "inspect",
                    title: "Inspect containers",
                    status: "ok",
                    correlationId: "corr-workflow:step:1:inspect",
                    result: {
                        command: "/usr/local/bin/docker",
                        args: ["ps"],
                        cwd: "/tmp",
                        exitCode: 0,
                        stdout: "docker ps",
                        stderr: "",
                        durationMs: 12,
                        dryRun: false,
                    },
                }],
                summary: {
                    totalSteps: 1,
                    completedSteps: 1,
                    failedSteps: 0,
                    skippedSteps: 0,
                },
            },
        }));
        const {postMessage, uiHandler} = registerUiHandler(["system.process.exec", "system.process.scope.docker-cli"]);

        const response = await uiHandler(undefined, "plugin-x", {
            handler: "__host.privilegedAction",
            content: {
                correlationId: "corr-workflow",
                request: {
                    action: "system.workflow.run",
                    payload: {
                        kind: "process-sequence",
                        scope: "docker-cli",
                        title: "Inspect and apply docker workflow",
                        steps: [{
                            id: "inspect",
                            title: "Inspect containers",
                            command: "/usr/local/bin/docker",
                            args: ["ps"],
                            cwd: "/tmp",
                        }],
                    },
                },
            },
        });

        expect(executeHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            correlationId: "corr-workflow",
            result: expect.objectContaining({
                workflowId: "wf-1",
                kind: "process-sequence",
                scope: "docker-cli",
                status: "completed",
            }),
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });
});
