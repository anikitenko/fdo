jest.mock("electron", () => ({
    app: {
        isPackaged: false,
        getAppPath: jest.fn(() => "/tmp/app"),
    },
    ipcMain: {
        handle: jest.fn(),
    },
    dialog: {
        showMessageBox: jest.fn(async () => ({response: 1})),
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

jest.mock("../../src/utils/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {
        getAllPlugins() { return []; }
    },
}));

jest.mock("../../src/components/editor/utils/generatePluginName", () => ({
    __esModule: true,
    default: jest.fn(() => "generated-plugin-name"),
}));

jest.mock("../../src/utils/UserORM", () => ({
    __esModule: true,
    default: class UserORMMock {
        activatePlugin() {}
        deactivatePlugin() {}
        deactivateAllPlugins() {}
        getActivatedPlugins() { return []; }
        getSharedProcessScopes() { return []; }
        setSharedProcessScopes(scopes) { return scopes; }
        getCustomProcessScopes() { return []; }
        setCustomProcessScopes(scopes) { return scopes; }
    },
}));

jest.mock("../../src/utils/PluginManager", () => ({
    __esModule: true,
    default: {
        loadPlugin: jest.fn(async () => ({success: true})),
        unLoadPlugin: jest.fn(),
        unLoadPlugins: jest.fn(),
        getLoadedPlugin: jest.fn(),
        getLoadedPluginReady: jest.fn(() => true),
        getLoadedPluginInited: jest.fn(() => true),
        loadingPlugins: {},
        mainWindow: {focus: jest.fn(), webContents: {send: jest.fn()}},
    },
}));

jest.mock("../../src/utils/ensureAndWrite", () => ({
    __esModule: true,
    default: jest.fn(async () => undefined),
}));
jest.mock("../../src/utils/esbuild/plugins/virtual-fs", () => ({
    EsbuildVirtualFsPlugin: jest.fn(() => ({name: "virtual-fs"})),
}));
jest.mock("../../src/utils/certs", () => ({
    Certs: {
        signPlugin: jest.fn(() => ({success: true})),
        verifyPlugin: jest.fn(async () => ({success: true})),
    },
}));
jest.mock("../../src/utils/syncPluginDir", () => ({syncPluginDir: jest.fn(async () => undefined)}));
jest.mock("../../src/utils/NotificationCenter", () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock("../../src/utils/editorWindow", () => ({editorWindow: {getWindow: jest.fn(() => null)}}));
jest.mock("../../src/utils/getIgnoreInstance", () => ({getIgnoreInstance: jest.fn(async () => ({ignores: () => false}))}));
jest.mock("../../src/utils/getAllFilesWithIgnorance", () => ({getAllFilesWithIgnorance: jest.fn(async () => [])}));
jest.mock("../../src/utils/extractMetadata", () => ({extractMetadata: jest.fn(async () => ({}))}));
jest.mock("../../src/utils/pluginMetadataContract", () => ({normalizeAndValidatePluginMetadata: jest.fn((m) => m)}));
jest.mock("../../src/utils/pluginTestRunner", () => ({runPluginWorkspaceTests: jest.fn(async () => ({success: true}))}));
jest.mock("../../src/utils/hostPrivilegedActions", () => ({
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

describe("plugin IPC privileged action transport", () => {
    test("routes reserved host privileged handler with correlation id and returns response payload", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");
        const {NotificationCenter} = require("../../src/utils/NotificationCenter");

        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.hosts.write"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");
        const {NotificationCenter} = require("../../src/utils/NotificationCenter");

        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.terraform"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");
        const {NotificationCenter} = require("../../src/utils/NotificationCenter");

        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.hosts.write", "system.fs.scope.etc-motd"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
        expect(NotificationCenter.addNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: "Deprecated privileged request shape",
            type: "warning",
        }));
        expect(postMessage).not.toHaveBeenCalled();
    });

    test("passes through forwarded backend failure payload without re-validating it as privileged request", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");

        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.git"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        executeHostPrivilegedAction.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");

        executeHostPrivilegedAction.mockResolvedValueOnce({
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
        });
        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {executeHostPrivilegedAction} = require("../../src/utils/hostPrivilegedActions");

        executeHostPrivilegedAction.mockResolvedValueOnce({
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
        });
        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
            instance: {postMessage},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
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
