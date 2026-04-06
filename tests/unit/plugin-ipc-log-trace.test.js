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
        getPluginEventTrace: jest.fn(() => [
            {ts: Date.parse("2026-03-29T10:00:00.000Z"), event: "runtime.ready", details: {}},
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
            }),
            lifecycleEvents: expect.any(Array),
            liveOutputTail: expect.any(Array),
            notifications: expect.any(Array),
        }));
        expect(response.combined).toContain("Host lifecycle trace:");
        expect(response.combined).toContain("runtime.ready");
        expect(response.combined).toContain("Live runtime output tail:");
        expect(response.combined).toContain("[stdout] plugin says hi");
        expect(response.combined).toContain("Related host notifications:");
        expect(response.combined).toContain("Plugin trace-plugin alert");
    });
});
