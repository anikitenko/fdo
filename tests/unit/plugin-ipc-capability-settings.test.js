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

const mockSetPluginCapabilities = jest.fn(() => ({success: true, capabilities: ["system.hosts.write"]}));
const mockGetPlugin = jest.fn(() => ({
    id: "plugin-a",
    metadata: {name: "Plugin A", version: "1.0.0", author: "E2E", description: "d", icon: "clean"},
    capabilities: ["system.hosts.write"],
}));

jest.mock("../../src/utils/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {
        setPluginCapabilities(...args) {
            return mockSetPluginCapabilities(...args);
        }

        getPlugin(...args) {
            return mockGetPlugin(...args);
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
        getLoadedPlugin: jest.fn(),
        getLoadedPluginReady: jest.fn(() => true),
        getLoadedPluginInited: jest.fn(() => true),
        loadingPlugins: {},
        mainWindow: {focus: jest.fn(), webContents: {send: jest.fn()}},
    },
}));

jest.mock("../../src/utils/ensureAndWrite", () => ({__esModule: true, default: jest.fn(async () => undefined)}));
jest.mock("../../src/utils/esbuild/plugins/virtual-fs", () => ({EsbuildVirtualFsPlugin: jest.fn(() => ({name: "virtual-fs"}))}));
jest.mock("../../src/utils/certs", () => ({Certs: {signPlugin: jest.fn(() => ({success: true})), verifyPlugin: jest.fn(async () => ({success: true}))}}));
jest.mock("../../src/utils/syncPluginDir", () => ({syncPluginDir: jest.fn(async () => undefined)}));
jest.mock("../../src/utils/NotificationCenter", () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock("../../src/utils/editorWindow", () => ({editorWindow: {getWindow: jest.fn(() => null)}}));
jest.mock("../../src/utils/getIgnoreInstance", () => ({getIgnoreInstance: jest.fn(async () => ({ignores: () => false}))}));
jest.mock("../../src/utils/getAllFilesWithIgnorance", () => ({getAllFilesWithIgnorance: jest.fn(async () => [])}));
jest.mock("../../src/utils/extractMetadata", () => ({extractMetadata: jest.fn(async () => ({}))}));
jest.mock("../../src/utils/pluginMetadataContract", () => ({normalizeAndValidatePluginMetadata: jest.fn((m) => m)}));
jest.mock("../../src/utils/pluginTestRunner", () => ({runPluginWorkspaceTests: jest.fn(async () => ({success: true}))}));

describe("plugin IPC capability settings", () => {
    test("returns scope policies and persists capability updates", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        registerPluginHandlers();

        const getScopePoliciesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_SCOPE_POLICIES)[1];
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];

        const scopeResult = await getScopePoliciesHandler();
        expect(scopeResult.success).toBe(true);
        expect(Array.isArray(scopeResult.scopes)).toBe(true);

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", ["system.hosts.write"]);
        expect(mockSetPluginCapabilities).toHaveBeenCalledWith("plugin-a", ["system.hosts.write"]);
        expect(updateResult).toEqual(expect.objectContaining({
            success: true,
            capabilities: ["system.hosts.write"],
        }));
        expect(updateResult.plugin?.id).toBe("plugin-a");
    });
});
