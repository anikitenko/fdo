jest.mock("electron", () => ({
    app: {
        isPackaged: false,
        getAppPath: jest.fn(() => "/tmp/fdo-app"),
    },
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
        async validate() {
            return {success: true};
        }
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

describe("plugin IPC init host contract", () => {
    let ipcMain;
    let registerPluginHandlers;
    let PluginChannels;
    let PluginManager;
    const originalCapabilitiesEnv = process.env.FDO_PLUGIN_CAPABILITIES;

    const getInitHandler = () => {
        const entry = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.INIT);
        return entry?.[1];
    };

    beforeEach(() => {
        jest.resetModules();
        ({ipcMain} = require("electron"));
        ({registerPluginHandlers} = require("../../src/ipc/plugin"));
        ({PluginChannels} = require("../../src/ipc/channels"));
        PluginManager = require("../../src/utils/PluginManager").default;
        ipcMain.handle.mockClear();
        registerPluginHandlers();
    });

    afterEach(() => {
        process.env.FDO_PLUGIN_CAPABILITIES = originalCapabilitiesEnv;
        jest.clearAllMocks();
    });

    test("sends host apiVersion and deny-by-default capabilities in PLUGIN_INIT", async () => {
        delete process.env.FDO_PLUGIN_CAPABILITIES;
        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            instance: {postMessage},
        });

        const initHandler = getInitHandler();
        const result = await initHandler({}, "demo-plugin");

        expect(result).toEqual({success: true});
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            message: "PLUGIN_INIT",
            content: {
                apiVersion: "1.0.0",
                capabilities: [],
            },
            data: {
                message: "PLUGIN_INIT",
                content: {
                    apiVersion: "1.0.0",
                    capabilities: [],
                },
            },
        });
    });

    test("respects env-based capability restriction for PLUGIN_INIT", async () => {
        process.env.FDO_PLUGIN_CAPABILITIES = "storage.json,unknown-capability";
        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            instance: {postMessage},
        });

        const initHandler = getInitHandler();
        const result = await initHandler({}, "demo-plugin");

        expect(result).toEqual({success: true});
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            message: "PLUGIN_INIT",
            content: expect.objectContaining({
                apiVersion: "1.0.0",
                capabilities: ["storage.json"],
            }),
        }));
    });

    test("uses plugin-granted capabilities when env override is not set", async () => {
        delete process.env.FDO_PLUGIN_CAPABILITIES;
        const postMessage = jest.fn();
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["storage.json"],
            instance: {postMessage},
        });

        const initHandler = getInitHandler();
        const result = await initHandler({}, "demo-plugin");

        expect(result).toEqual({success: true});
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            message: "PLUGIN_INIT",
            content: expect.objectContaining({
                apiVersion: "1.0.0",
                capabilities: ["storage.json"],
            }),
        }));
    });

    test("returns error when plugin is not loaded", async () => {
        PluginManager.getLoadedPlugin.mockReturnValue(undefined);
        const initHandler = getInitHandler();

        const result = await initHandler({}, "missing-plugin");

        expect(result).toEqual({
            success: false,
            error: 'Plugin "missing-plugin" is not loaded',
        });
    });

    test("returns error when plugin is loaded but not ready", async () => {
        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: false,
            instance: {postMessage: jest.fn()},
        });
        const initHandler = getInitHandler();

        const result = await initHandler({}, "cold-plugin");

        expect(result).toEqual({
            success: false,
            error: 'Plugin "cold-plugin" is not ready',
        });
    });
});
