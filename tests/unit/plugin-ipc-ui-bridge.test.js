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
        getAllPlugins() {
            return [];
        }
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
    executeHostPrivilegedAction: jest.fn(),
}));

describe("plugin IPC UI bridge", () => {
    function createLoadedPluginWithResponse(response, options = {}) {
        const {EventEmitter} = require("node:events");
        const child = new EventEmitter();
        const sessionId = typeof options.sessionId === "string" ? options.sessionId : "plugin-x:session-a";
        child.postMessage = jest.fn(() => {
            Promise.resolve().then(() => {
                const isDiagnosticsRequest = child.postMessage.mock.calls[child.postMessage.mock.calls.length - 1]?.[0]?.content?.handler === "__sdk.getDiagnostics";
                child.emit("message", {
                    type: "UI_MESSAGE",
                    response: isDiagnosticsRequest
                        ? (options.diagnosticsResponse || {
                            pluginId: "plugin-x",
                            health: {
                                lastErrorMessage: "",
                            },
                            capabilities: {
                                registeredHandlers: [],
                            },
                        })
                        : response,
                });
            });
        });
        return {
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.demo"],
            sessionId,
            instance: child,
        };
    }

    test.each([
        [
            "docker success",
            "docker.runPs",
            {
                ok: true,
                correlationId: "docker-1",
                result: {
                    command: "/usr/local/bin/docker",
                    args: ["ps"],
                    cwd: "/tmp",
                    exitCode: 0,
                    stdout: "CONTAINER ID",
                    stderr: "",
                    durationMs: 12,
                    dryRun: false,
                },
            },
        ],
        [
            "kubectl missing CLI",
            "kube.getPods",
            {
                ok: false,
                correlationId: "kubectl-1",
                error: "spawn /usr/local/bin/kubectl ENOENT",
                code: "PROCESS_SPAWN_ENOENT",
            },
        ],
        [
            "terraform missing broad capability",
            "terraform.plan",
            {
                ok: false,
                correlationId: "terraform-1",
                error: 'Missing capability "system.process.exec"',
                code: "CAPABILITY_DENIED",
            },
        ],
        [
            "ansible missing scope capability",
            "ansible.check",
            {
                ok: false,
                correlationId: "ansible-1",
                error: 'Missing capability "system.process.scope.ansible"',
                code: "CAPABILITY_DENIED",
            },
        ],
        [
            "aws policy rejection",
            "aws.listInstances",
            {
                ok: false,
                correlationId: "aws-1",
                error: 'Command not allowlisted for scope "aws-cli"',
                code: "PROCESS_POLICY_DENIED",
            },
        ],
        [
            "github confirmation rejected",
            "github.releaseApply",
            {
                ok: false,
                correlationId: "gh-1",
                error: 'User denied confirmation for scope "gh-cli"',
                code: "CONFIRMATION_DENIED",
            },
        ],
        [
            "helm workflow partial failure",
            "helm.previewApply",
            {
                ok: true,
                correlationId: "wf-helm-1",
                result: {
                    workflowId: "wf-helm-1",
                    scope: "helm-cli",
                    title: "Helm preview and apply",
                    kind: "process-sequence",
                    status: "partial",
                    summary: {
                        totalSteps: 2,
                        completedSteps: 1,
                        failedSteps: 1,
                        skippedSteps: 0,
                    },
                    steps: [
                        {
                            stepId: "preview",
                            title: "Preview chart",
                            status: "ok",
                            correlationId: "wf-helm-1:preview",
                            result: {
                                command: "/usr/local/bin/helm",
                                args: ["template"],
                                cwd: "/tmp/chart",
                                exitCode: 0,
                                stdout: "rendered",
                                stderr: "",
                                durationMs: 18,
                                dryRun: true,
                            },
                        },
                        {
                            stepId: "apply",
                            title: "Apply release",
                            status: "error",
                            correlationId: "wf-helm-1:apply",
                            error: "helm upgrade failed",
                            code: "PROCESS_EXIT_NON_ZERO",
                            result: {
                                command: "/usr/local/bin/helm",
                                args: ["upgrade", "--install"],
                                cwd: "/tmp/chart",
                                exitCode: 1,
                                stdout: "",
                                stderr: "boom",
                                durationMs: 33,
                                dryRun: false,
                            },
                        },
                    ],
                },
            },
        ],
        [
            "internal runner workflow success",
            "internalRunner.inspectAct",
            {
                ok: true,
                correlationId: "wf-runner-1",
                result: {
                    workflowId: "wf-runner-1",
                    scope: "internal-runner",
                    title: "Inspect and act",
                    kind: "process-sequence",
                    status: "completed",
                    summary: {
                        totalSteps: 2,
                        completedSteps: 2,
                        failedSteps: 0,
                        skippedSteps: 0,
                    },
                    steps: [
                        {
                            stepId: "inspect",
                            title: "Inspect state",
                            status: "ok",
                            correlationId: "wf-runner-1:inspect",
                            result: {
                                command: "/usr/local/bin/internal-runner",
                                args: ["inspect"],
                                cwd: "/tmp",
                                exitCode: 0,
                                stdout: "ready",
                                stderr: "",
                                durationMs: 11,
                                dryRun: true,
                            },
                        },
                        {
                            stepId: "act",
                            title: "Act on state",
                            status: "ok",
                            correlationId: "wf-runner-1:act",
                            result: {
                                command: "/usr/local/bin/internal-runner",
                                args: ["apply"],
                                cwd: "/tmp",
                                exitCode: 0,
                                stdout: "done",
                                stderr: "",
                                durationMs: 21,
                                dryRun: false,
                            },
                        },
                    ],
                },
            },
        ],
    ])("returns real backend handler output for %s", async (_label, handlerName, backendResponse) => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        PluginManager.getLoadedPlugin.mockReturnValue(createLoadedPluginWithResponse(backendResponse));

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: handlerName,
            content: {scope: "demo"},
        });

        expect(response).toEqual(backendResponse);
        expect(response).not.toEqual({success: true});
    });

    test("normalizes backend handler throw-like responses into stable error payloads", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        PluginManager.getLoadedPlugin.mockReturnValue(createLoadedPluginWithResponse({
            error: "Handler crashed while preparing request",
        }));

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: "vault.rotateLease",
            content: {scope: "vault-cli"},
        });

        expect(response).toEqual({
            ok: false,
            error: "Handler crashed while preparing request",
            code: "PLUGIN_BACKEND_ERROR",
        });
    });

    test("rejects backend responses from stale plugin sessions after runtime replacement", async () => {
        jest.resetModules();
        const {EventEmitter} = require("node:events");
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        const staleChild = new EventEmitter();
        staleChild.postMessage = jest.fn(() => {
            activePlugin = freshPlugin;
            Promise.resolve().then(() => {
                staleChild.emit("message", {
                    type: "UI_MESSAGE",
                    response: {ok: true, result: {version: "A"}},
                });
            });
        });

        const freshChild = new EventEmitter();
        freshChild.postMessage = jest.fn();

        const stalePlugin = {
            ready: true,
            grantedCapabilities: [],
            sessionId: "plugin-x:session-old",
            instance: staleChild,
        };
        const freshPlugin = {
            ready: true,
            grantedCapabilities: [],
            sessionId: "plugin-x:session-new",
            instance: freshChild,
        };
        let activePlugin = stalePlugin;

        PluginManager.getLoadedPlugin.mockImplementation(() => activePlugin);

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: "example.handler",
            content: {value: 1},
        });

        expect(response).toEqual({
            ok: false,
            error: 'Plugin "plugin-x" backend response was ignored because runtime session changed during request.',
            code: "PLUGIN_BACKEND_STALE_SESSION",
            details: {
                requestedSessionId: "plugin-x:session-old",
                activeSessionId: "plugin-x:session-new",
            },
        });
    });

    test("turns null backend handler responses into an actionable diagnostics-backed error", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        PluginManager.getLoadedPlugin.mockReturnValue(createLoadedPluginWithResponse(null, {
            diagnosticsResponse: {
                pluginId: "terraform-test",
                health: {
                    lastErrorMessage: "Handler 'terraform.previewPlan' threw an error: spawn /usr/local/bin/terraform ENOENT",
                },
                capabilities: {
                    registeredHandlers: ["terraform.previewPlan"],
                },
            },
        }));

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: "terraform.previewPlan",
            content: {scope: "terraform"},
        });

        expect(response).toEqual({
            ok: false,
            error: `Plugin backend handler "terraform.previewPlan" failed before returning a response. Handler 'terraform.previewPlan' threw an error: spawn /usr/local/bin/terraform ENOENT`,
            code: "PLUGIN_BACKEND_HANDLER_FAILED",
            details: {
                pluginId: "terraform-test",
                lastErrorMessage: "Handler 'terraform.previewPlan' threw an error: spawn /usr/local/bin/terraform ENOENT",
            },
        });
    });

    test("preserves privileged host failure payloads without wrapping them in transport success", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {
            executeHostPrivilegedAction,
            HOST_PRIVILEGED_HANDLER,
        } = require("../../src/utils/hostPrivilegedActions");

        executeHostPrivilegedAction.mockResolvedValueOnce({
            ok: false,
            correlationId: "corr-missing-cli",
            error: "spawn /usr/local/bin/podman ENOENT",
            code: "PROCESS_SPAWN_ENOENT",
        });
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.podman-cli"],
            instance: {postMessage: jest.fn()},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: HOST_PRIVILEGED_HANDLER,
            content: {
                correlationId: "corr-missing-cli",
                request: {
                    action: "system.process.exec",
                    payload: {
                        scope: "podman-cli",
                        command: "/usr/local/bin/podman",
                        args: ["ps"],
                    },
                },
            },
        });

        expect(response).toEqual({
            ok: false,
            correlationId: "corr-missing-cli",
            error: "spawn /usr/local/bin/podman ENOENT",
            code: "PROCESS_SPAWN_ENOENT",
        });
        expect(response).not.toEqual({success: true});
    });

    test("returns structured privileged host errors when host execution throws unexpectedly", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {
            executeHostPrivilegedAction,
            HOST_PRIVILEGED_HANDLER,
        } = require("../../src/utils/hostPrivilegedActions");

        executeHostPrivilegedAction.mockRejectedValueOnce(new Error("unexpected host runner crash"));
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.process.exec", "system.process.scope.internal-runner"],
            instance: {postMessage: jest.fn()},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const response = await uiHandler({}, "plugin-x", {
            handler: HOST_PRIVILEGED_HANDLER,
            content: {
                correlationId: "corr-host-crash",
                request: {
                    action: "system.workflow.run",
                    payload: {
                        scope: "internal-runner",
                        kind: "process-sequence",
                        title: "Inspect and act",
                        steps: [],
                    },
                },
            },
        });

        expect(response).toEqual({
            ok: false,
            correlationId: "corr-host-crash",
            error: "unexpected host runner crash",
            code: "HOST_ACTION_FAILED",
        });
    });
});
