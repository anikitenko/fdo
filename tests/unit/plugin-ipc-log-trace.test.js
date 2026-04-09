jest.mock("electron", () => ({
    app: {
        isPackaged: false,
        getAppPath: jest.fn(() => "/tmp/fdo-app"),
        getPath: jest.fn(() => "/tmp/fdo-user-data"),
    },
    ipcMain: {
        handle: jest.fn(),
    },
    dialog: {
        showMessageBox: jest.fn(async () => ({response: 1})),
    },
}));

jest.mock("node:fs", () => ({
    rmSync: jest.fn(),
    chmodSync: jest.fn(),
    existsSync: jest.fn(() => false),
    statSync: jest.fn(() => ({mode: 0o755})),
}));

jest.mock("node:fs/promises", () => ({
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
}));

jest.mock("archiver", () => {
    return jest.fn(() => ({
        on: jest.fn(),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn(async () => undefined),
    }));
});

jest.mock("../../src/main.js", () => ({
    PLUGINS_DIR: "/tmp/plugins",
    PLUGINS_REGISTRY_FILE: "/tmp/plugins-registry.json",
    USER_CONFIG_FILE: "/tmp/user-config.json",
}));

jest.mock("../../src/components/plugin/ValidatePlugin", () => ({
    __esModule: true,
    default: class ValidatePluginMock {
        async validate() {
            return {success: true};
        }
    },
}));

jest.mock("../../src/utils/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {
        getPlugin(id) {
            return {
                id,
                home: `/tmp/plugins/${id}`,
                entry: "dist/index.js",
            };
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
    },
}));

jest.mock("../../src/utils/PluginManager", () => ({
    __esModule: true,
    default: {
        loadPlugin: jest.fn(async () => ({success: true})),
        unLoadPlugin: jest.fn(),
        unLoadPlugins: jest.fn(),
        getLoadedPlugin: jest.fn(() => ({instance: {postMessage: jest.fn()}})),
        getLoadedPluginReady: jest.fn(() => true),
        getLoadedPluginInited: jest.fn(() => true),
        getPluginDiagnostics: jest.fn(async () => ({
            pluginId: "trace-plugin",
            capabilities: {
                declaration: {
                    available: true,
                    hasDeclaration: true,
                    declared: ["system.process.exec", "system.process.scope.system-observe"],
                    granted: ["system.process.exec", "system.process.scope.system-observe"],
                    missingDeclared: [],
                    undeclaredGranted: [],
                },
            },
        })),
        getPluginEventTrace: jest.fn(() => [
            {ts: Date.parse("2026-03-29T10:00:00.000Z"), event: "runtime.ready", details: {}},
        ]),
        getPrivilegedAuditTrail: jest.fn(() => [
            {
                timestamp: "2026-03-29T10:00:10.000Z",
                action: "system.workflow.run",
                success: false,
                scope: "terraform",
                workflowId: "wf-trace-1",
                workflowStatus: "failed",
                correlationId: "corr-trace",
                stepId: "apply",
                stepStatus: "error",
                error: {
                    code: "STEP_FAILED",
                    message: 'Workflow step "apply" exited with code 1.',
                },
            },
        ]),
        pluginRuntimeOutputTail: {
            "trace-plugin": ["[stdout] plugin says hi"],
        },
        loadingPlugins: {},
        lastUnloadByPlugin: {
            "trace-plugin": {reason: "manual_unload", ts: Date.parse("2026-03-29T10:01:00.000Z")},
        },
        mainWindow: {
            focus: jest.fn(),
            webContents: {send: jest.fn()},
        },
        getLoadedPlugin: jest.fn(() => ({
            instance: {postMessage: jest.fn()},
            grantedCapabilities: ["system.process.exec", "system.process.scope.system-observe"],
        })),
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

jest.mock("../../src/utils/syncPluginDir", () => ({
    syncPluginDir: jest.fn(async () => undefined),
}));

jest.mock("../../src/utils/NotificationCenter", () => ({
    NotificationCenter: {
        addNotification: jest.fn(),
        getAllNotifications: jest.fn(() => [
            {
                title: "Plugin trace-plugin alert",
                message: "Something happened for trace-plugin",
                createdAt: "2026-03-29T10:00:20.000Z",
            },
            {
                title: "Other plugin",
                message: "unrelated",
                createdAt: "2026-03-29T10:00:21.000Z",
            },
        ]),
    },
}));

jest.mock("../../src/utils/editorWindow", () => ({
    editorWindow: {
        getWindow: jest.fn(() => null),
    },
}));

jest.mock("../../src/utils/getIgnoreInstance", () => ({
    getIgnoreInstance: jest.fn(async () => ({ignores: () => false})),
}));

jest.mock("../../src/utils/getAllFilesWithIgnorance", () => ({
    getAllFilesWithIgnorance: jest.fn(async () => []),
}));

jest.mock("../../src/utils/extractMetadata", () => ({
    extractMetadata: jest.fn(async () => ({})),
}));

jest.mock("../../src/utils/pluginMetadataContract", () => ({
    normalizeAndValidatePluginMetadata: jest.fn((metadata) => metadata),
}));

jest.mock("../../src/utils/pluginTestRunner", () => ({
    runPluginWorkspaceTests: jest.fn(async () => ({success: true, output: ""})),
}));

jest.mock("../../src/utils/hostPrivilegedActions", () => ({
    HOST_PRIVILEGED_HANDLER: "__host.privilegedAction",
    executeHostPrivilegedAction: jest.fn(async (_request, ctx) => ({
        ok: true,
        correlationId: ctx.correlationId,
        result: {action: "system.hosts.write", dryRun: true},
    })),
}));

jest.mock("../../src/utils/privilegedFsScopeRegistry", () => ({
    HOST_FS_SCOPE_REGISTRY: Object.freeze([]),
}));

describe("plugin IPC log trace", () => {
    afterEach(() => {
        const fs = require("node:fs");
        const fsPromises = require("node:fs/promises");
        const {app} = require("electron");

        fs.existsSync.mockImplementation(() => false);
        fsPromises.readFile.mockReset();
        fsPromises.readdir.mockReset();
        fsPromises.stat.mockReset();
        app.getPath.mockImplementation(() => "/tmp/fdo-user-data");
    });

    test("returns combined plugin trace bundle with lifecycle and live output", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_LOG_TRACE)?.[1];
        expect(typeof handler).toBe("function");

        const response = await handler({}, "trace-plugin", {maxFiles: 2, maxChars: 4000});

        expect(response).toEqual(expect.objectContaining({
            success: true,
            pluginId: "trace-plugin",
            runtimeStatus: expect.objectContaining({
                loaded: true,
                ready: true,
                inited: true,
                capabilityIntentSummary: expect.objectContaining({
                    title: "Declared and granted aligned",
                }),
            }),
            lifecycleEvents: expect.any(Array),
            liveOutputTail: expect.any(Array),
            notifications: expect.any(Array),
            privilegedAuditEvents: expect.any(Array),
        }));
        expect(response.combined).toContain("Host lifecycle trace:");
        expect(response.combined).toContain("capabilityIntent=Declared and granted aligned");
        expect(response.combined).toContain("runtime.ready");
        expect(response.combined).toContain("Privileged audit trail:");
        expect(response.combined).toContain("wf-trace-1");
        expect(response.combined).toContain("STEP_FAILED");
        expect(response.combined).toContain("Live runtime output tail:");
        expect(response.combined).toContain("[stdout] plugin says hi");
        expect(response.combined).toContain("Related host notifications:");
        expect(response.combined).toContain("Plugin trace-plugin alert");
    });

    test("reads exact sdk log lines from the per-plugin logs directory under userData", async () => {
        jest.resetModules();
        const actualFs = jest.requireActual("node:fs");
        const actualFsPromises = jest.requireActual("node:fs/promises");
        const actualOs = jest.requireActual("node:os");
        const actualPath = jest.requireActual("node:path");
        const {ipcMain, app} = require("electron");
        const fs = require("node:fs");
        const fsPromises = require("node:fs/promises");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        const userDataRoot = actualFs.mkdtempSync(actualPath.join(actualOs.tmpdir(), "fdo-log-trace-"));
        const pluginId = "trace-plugin";
        const logDir = actualPath.join(userDataRoot, "plugin-data", pluginId, "logs");
        const infoLogPath = actualPath.join(logDir, "info-2026-04-06.log");
        const exactLogLine = "Terraform preview completed with exitCode=0";

        actualFs.mkdirSync(logDir, {recursive: true});
        actualFs.writeFileSync(infoLogPath, `${exactLogLine}\nnext-line\n`, "utf8");

        app.getPath.mockImplementation((name) => {
            if (name === "userData") {
                return userDataRoot;
            }
            return "/tmp/fdo-user-data";
        });
        fs.existsSync.mockImplementation(actualFs.existsSync);
        fsPromises.readdir.mockImplementation((...args) => actualFsPromises.readdir(...args));
        fsPromises.readFile.mockImplementation((...args) => actualFsPromises.readFile(...args));
        fsPromises.stat.mockImplementation((...args) => actualFsPromises.stat(...args));

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const handler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_LOG_TRACE)?.[1];
        expect(typeof handler).toBe("function");

        const response = await handler({}, pluginId, {maxFiles: 1, maxChars: 4000});

        expect(response.success).toBe(true);
        expect(response.logTail.logDir).toBe(logDir);
        expect(response.logTail.logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                file: "info-2026-04-06.log",
            }),
        ]));
        expect(response.combined).toContain("Plugin runtime logs:");
        expect(response.combined).toContain(exactLogLine);

        actualFs.rmSync(userDataRoot, {recursive: true, force: true});
    });

    test("returns structured privileged audit events over IPC and exposes summary on runtime status", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        registerPluginHandlers();

        const getAuditHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_PRIVILEGED_AUDIT)?.[1];
        const getRuntimeStatusHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_RUNTIME_STATUS)?.[1];

        expect(typeof getAuditHandler).toBe("function");
        expect(typeof getRuntimeStatusHandler).toBe("function");

        const auditResponse = await getAuditHandler({}, "trace-plugin", {limit: 5});
        expect(auditResponse).toEqual(expect.objectContaining({
            success: true,
            pluginId: "trace-plugin",
            events: expect.arrayContaining([
                expect.objectContaining({
                    workflowId: "wf-trace-1",
                    stepId: "apply",
                }),
            ]),
        }));

        const runtimeResponse = await getRuntimeStatusHandler({}, ["trace-plugin"]);
        expect(runtimeResponse.statuses[0]).toEqual(expect.objectContaining({
            id: "trace-plugin",
            trustTier: expect.objectContaining({
                id: "high-trust-administrative",
            }),
            privilegedAuditCount: PluginManager.getPrivilegedAuditTrail("trace-plugin", {limit: 200}).length,
            lastPrivilegedAudit: expect.objectContaining({
                workflowId: "wf-trace-1",
            }),
            diagnosticsSummary: expect.objectContaining({
                totalEvents: expect.any(Number),
                failureCount: expect.any(Number),
                latestFailureCode: expect.any(String),
            }),
            capabilityIntent: expect.objectContaining({
                declared: ["system.process.exec", "system.process.scope.system-observe"],
                missingDeclared: [],
                undeclaredGranted: [],
            }),
            capabilityIntentSummary: expect.objectContaining({
                title: "Declared and granted aligned",
            }),
        }));
    });
});
