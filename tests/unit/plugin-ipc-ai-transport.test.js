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
    executeHostPrivilegedAction: jest.fn(async () => ({ok: true})),
}));

jest.mock("../../src/utils/pluginHostAi", () => ({
    FDO_AI_LIST_ASSISTANTS_HANDLER_ID: "fdo.ai.assistants.list.v1",
    FDO_AI_REQUEST_HANDLER_ID: "fdo.ai.request.v1",
    handleHostAiAssistantsListRequest: jest.fn(async () => ({ok: true, assistants: [{id: "a-1", name: "Alpha"}]})),
    handleHostAiRequest: jest.fn(async () => ({ok: true, message: "AI response"})),
}));
jest.mock("../../src/utils/pluginHostAuth", () => ({
    FDO_AUTH_START_HANDLER_ID: "fdo.auth.start.v1",
    FDO_AUTH_REFRESH_HANDLER_ID: "fdo.auth.refresh.v1",
    FDO_AUTH_LOGOUT_HANDLER_ID: "fdo.auth.logout.v1",
    FDO_SESSION_REQUEST_HANDLER_ID: "fdo.session.request.v1",
    handleHostAuthBrokerStartRequest: jest.fn(async () => ({ok: true, sessionId: "sess-1", correlationId: "auth-start-1"})),
    handleHostAuthBrokerRefreshRequest: jest.fn(async () => ({ok: true, sessionId: "sess-1", correlationId: "auth-refresh-1"})),
    handleHostAuthBrokerLogoutRequest: jest.fn(async () => ({ok: true, correlationId: "auth-logout-1"})),
    handleHostSessionRequest: jest.fn(async () => ({ok: true, status: 200, correlationId: "session-request-1", data: {ok: true}})),
}));

describe("plugin IPC AI transport", () => {
    test("routes AI list and request handlers via host AI bridge", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {handleHostAiAssistantsListRequest, handleHostAiRequest} = require("../../src/utils/pluginHostAi");

        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.ai", "system.ai.assistants.list", "system.ai.request"],
            instance: {postMessage: jest.fn()},
        });

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const listResponse = await uiHandler({}, "plugin-ai", {
            handler: "fdo.ai.assistants.list.v1",
            content: {purpose: "coding"},
        });
        expect(handleHostAiAssistantsListRequest).toHaveBeenCalledWith({purpose: "coding"}, expect.objectContaining({
            pluginId: "plugin-ai",
        }));
        expect(listResponse).toEqual(expect.objectContaining({
            ok: true,
            assistants: expect.any(Array),
        }));

        const requestResponse = await uiHandler({}, "plugin-ai", {
            handler: "fdo.ai.request.v1",
            content: {task: "commit-message"},
        });
        expect(handleHostAiRequest).toHaveBeenCalledWith({task: "commit-message"}, expect.objectContaining({
            pluginId: "plugin-ai",
        }));
        expect(requestResponse).toEqual(expect.objectContaining({
            ok: true,
            message: "AI response",
        }));
    });

    test("routes auth broker and session request handlers via host auth bridge", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;
        const {
            handleHostAuthBrokerStartRequest,
            handleHostAuthBrokerRefreshRequest,
            handleHostAuthBrokerLogoutRequest,
            handleHostSessionRequest,
        } = require("../../src/utils/pluginHostAuth");

        PluginManager.getLoadedPlugin.mockReturnValue({
            ready: true,
            grantedCapabilities: ["system.network", "system.network.https", "system.network.scope.public-web-secure"],
            sessionId: "plugin-auth:session-1",
            instance: {postMessage: jest.fn()},
        });
        PluginManager.getPluginDiagnostics = jest.fn(async () => ({
            capabilities: {
                declaration: {
                    declared: ["system.network", "system.network.https", "system.network.scope.public-web-secure"],
                },
            },
        }));

        ipcMain.handle.mockClear();
        registerPluginHandlers();
        const uiHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UI_MESSAGE)[1];

        const startResponse = await uiHandler({}, "plugin-auth", {
            handler: "fdo.auth.start.v1",
            content: {providerId: "sharepoint"},
        });
        expect(handleHostAuthBrokerStartRequest).toHaveBeenCalledWith({providerId: "sharepoint"}, expect.objectContaining({
            pluginId: "plugin-auth",
            declaredCapabilities: expect.any(Array),
        }));
        expect(startResponse).toEqual(expect.objectContaining({ok: true, sessionId: "sess-1"}));

        const refreshResponse = await uiHandler({}, "plugin-auth", {
            handler: "fdo.auth.refresh.v1",
            content: {providerId: "sharepoint", sessionId: "sess-1"},
        });
        expect(handleHostAuthBrokerRefreshRequest).toHaveBeenCalled();
        expect(refreshResponse).toEqual(expect.objectContaining({ok: true, sessionId: "sess-1"}));

        const logoutResponse = await uiHandler({}, "plugin-auth", {
            handler: "fdo.auth.logout.v1",
            content: {providerId: "sharepoint", sessionId: "sess-1"},
        });
        expect(handleHostAuthBrokerLogoutRequest).toHaveBeenCalled();
        expect(logoutResponse).toEqual(expect.objectContaining({ok: true}));

        const sessionRequestResponse = await uiHandler({}, "plugin-auth", {
            handler: "fdo.session.request.v1",
            content: {sessionId: "sess-1", method: "GET", url: "https://example.com"},
        });
        expect(handleHostSessionRequest).toHaveBeenCalled();
        expect(sessionRequestResponse).toEqual(expect.objectContaining({ok: true, status: 200}));
    });
});
