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

const mockGetPlugin = jest.fn((id) => ({
    id,
    home: `/tmp/plugins/${id}`,
    entry: "dist/index.cjs",
    capabilities: ["system.process.exec"],
}));
const mockAddPlugin = jest.fn();

jest.mock("../../src/utils/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {
        getAllPlugins() {
            return [];
        }
        getPlugin(...args) {
            return mockGetPlugin(...args);
        }
        addPlugin(...args) {
            return mockAddPlugin(...args);
        }
    },
}));

jest.mock("../../src/components/editor/utils/generatePluginName", () => ({
    __esModule: true,
    default: jest.fn(() => "generated-plugin-name"),
}));

const mockGetActivatedPlugins = jest.fn(() => ["plugin-a"]);

jest.mock("../../src/utils/UserORM", () => ({
    __esModule: true,
    default: class UserORMMock {
        activatePlugin() {}
        deactivatePlugin() {}
        deactivateAllPlugins() {}
        getActivatedPlugins() { return mockGetActivatedPlugins(); }
        getSharedProcessScopes() { return []; }
    },
}));

const mockLoadPlugin = jest.fn(async () => ({success: true}));
const mockUnloadPlugin = jest.fn();
const mockGetLoadedPlugin = jest.fn(() => ({id: "plugin-a"}));

jest.mock("../../src/utils/PluginManager", () => ({
    __esModule: true,
    default: {
        loadPlugin: (...args) => mockLoadPlugin(...args),
        unLoadPlugin: (...args) => mockUnloadPlugin(...args),
        unLoadPlugins: jest.fn(),
        getLoadedPlugin: (...args) => mockGetLoadedPlugin(...args),
        getLoadedPluginReady: jest.fn(() => true),
        getLoadedPluginInited: jest.fn(() => true),
        getPrivilegedApprovalSession: jest.fn(() => new Map()),
        clearPrivilegedApprovalSession: jest.fn(),
        loadingPlugins: {},
        mainWindow: {focus: jest.fn(), webContents: {send: jest.fn()}},
    },
}));

jest.mock("../../src/utils/ensureAndWrite", () => ({__esModule: true, default: jest.fn(async () => undefined)}));
jest.mock("../../src/utils/esbuild/plugins/virtual-fs", () => ({EsbuildVirtualFsPlugin: jest.fn(() => ({name: "virtual-fs"}))}));
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

describe("plugin IPC deploy from editor", () => {
    test("reloads an already active plugin after deploy", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        registerPluginHandlers();

        const deployHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.DEPLOY_FROM_EDITOR)[1];
        const result = await deployHandler({}, {
            name: "plugin-a",
            sandbox: "sandbox-1",
            entrypoint: "dist/index.cjs",
            metadata: {name: "Plugin A", version: "1.0.0", author: "A", description: "d", icon: "cube"},
            content: "module.exports = {};",
            rootCert: "root-cert",
        });

        expect(result).toEqual({success: true});
        expect(mockUnloadPlugin).toHaveBeenCalledWith("plugin-a", {force: true});
        expect(mockLoadPlugin).toHaveBeenCalledWith("plugin-a");
        expect(mockAddPlugin).toHaveBeenCalled();
    });
});
