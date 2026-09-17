jest.mock("electron", () => ({
    app: {},
    dialog: {
        showMessageBox: jest.fn(async () => ({response: 1})),
    },
    shell: {
        openExternal: jest.fn(),
    },
    utilityProcess: {
        fork: jest.fn(),
    },
}));

jest.mock("../../src/utils/UserORM", () => ({
    __esModule: true,
    default: class UserORMMock {},
}));

jest.mock("../../src/utils/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {},
}));

jest.mock("../../src/utils/certs", () => ({
    Certs: {},
}));

jest.mock("../../src/utils/NotificationCenter", () => ({
    NotificationCenter: {
        addNotification: jest.fn(),
    },
}));

jest.mock("../../src/utils/pluginRuntimeBundle", () => ({
    buildPluginRuntimeBundle: jest.fn(),
    getHostPluginNodeModulesPath: jest.fn(),
}));

jest.mock("../../src/utils/pluginRuntimeSecurity", () => ({
    buildPluginRuntimePolicy: jest.fn(() => ({})),
    ensurePluginRuntimeBootstrap: jest.fn(),
    resolveHostGrantedCapabilities: jest.fn(() => []),
}));

const mockExecuteHostPrivilegedAction = jest.fn(async () => ({ok: true, correlationId: "priv-corr"}));

jest.mock("../../src/utils/hostPrivilegedActions", () => ({
    executeHostPrivilegedAction: (...args) => mockExecuteHostPrivilegedAction(...args),
    HOST_PRIVILEGED_HANDLER: "__host.privilegedAction",
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ: "system.clipboard.read",
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE: "system.clipboard.write",
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC: "system.process.exec",
}));

jest.mock("../../src/utils/pluginCapabilityDeclaration", () => ({
    extractCapabilityDeclarationComparison: jest.fn(() => ({})),
}));

jest.mock("../../src/utils/pluginHandshakeCompatibility", () => ({
    evaluatePluginHandshakeCompatibility: jest.fn(() => ({})),
    normalizeDiagnosticsHandshake: jest.fn(() => ({})),
}));

const mockHandleHostAiAssistantsListRequest = jest.fn(async () => ({ok: true, assistants: []}));
const mockHandleHostAiRequest = jest.fn(async () => ({ok: true, message: "ok"}));
jest.mock("../../src/utils/pluginHostAi", () => ({
    FDO_AI_LIST_ASSISTANTS_HANDLER_ID: "fdo.ai.assistants.list.v1",
    FDO_AI_REQUEST_HANDLER_ID: "fdo.ai.request.v1",
    handleHostAiAssistantsListRequest: (...args) => mockHandleHostAiAssistantsListRequest(...args),
    handleHostAiRequest: (...args) => mockHandleHostAiRequest(...args),
}));

const mockHandleHostAuthBrokerStartRequest = jest.fn(async () => ({ok: true, sessionId: "sess-1"}));
const mockHandleHostAuthBrokerRefreshRequest = jest.fn(async () => ({ok: true, sessionId: "sess-1"}));
const mockHandleHostAuthBrokerLogoutRequest = jest.fn(async () => ({ok: true}));
const mockHandleHostSessionRequest = jest.fn(async () => ({ok: true, status: 200}));
jest.mock("../../src/utils/pluginHostAuth", () => ({
    FDO_AUTH_START_HANDLER_ID: "fdo.auth.start.v1",
    FDO_AUTH_REFRESH_HANDLER_ID: "fdo.auth.refresh.v1",
    FDO_AUTH_LOGOUT_HANDLER_ID: "fdo.auth.logout.v1",
    FDO_SESSION_REQUEST_HANDLER_ID: "fdo.session.request.v1",
    handleHostAuthBrokerStartRequest: (...args) => mockHandleHostAuthBrokerStartRequest(...args),
    handleHostAuthBrokerRefreshRequest: (...args) => mockHandleHostAuthBrokerRefreshRequest(...args),
    handleHostAuthBrokerLogoutRequest: (...args) => mockHandleHostAuthBrokerLogoutRequest(...args),
    handleHostSessionRequest: (...args) => mockHandleHostSessionRequest(...args),
}));

const mockHandleHostBrowserOpenRequest = jest.fn(async () => ({ok: true, url: "https://example.com", policy: "trusted-content-link"}));
jest.mock("../../src/utils/pluginHostBrowser", () => ({
    FDO_BROWSER_OPEN_HANDLER_ID: "fdo.browser.open.v1",
    handleHostBrowserOpenRequest: (...args) => mockHandleHostBrowserOpenRequest(...args),
}));

describe("PluginManager backend bridge routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("routes fdo.auth.start.v1 through auth broker handler instead of privileged transport", async () => {
        const PluginManager = require("../../src/utils/PluginManager").default;
        PluginManager.loadedPlugins = {
            "plugin-auth": {
                grantedCapabilities: ["system.network", "system.network.https"],
            },
        };
        PluginManager.getPluginDiagnostics = jest.fn(async () => ({
            capabilities: {
                declaration: {
                    declared: ["system.network", "system.network.https"],
                },
            },
        }));

        const response = await PluginManager.resolveBackendBridgeResponse("plugin-auth", {
            handler: "fdo.auth.start.v1",
            content: {
                providerId: "sharepoint",
                endpointUrl: "https://graph.microsoft.com/v1.0",
            },
        }, "corr-auth");

        expect(mockHandleHostAuthBrokerStartRequest).toHaveBeenCalledWith(expect.objectContaining({
            providerId: "sharepoint",
        }), expect.objectContaining({
            pluginId: "plugin-auth",
        }));
        expect(mockExecuteHostPrivilegedAction).not.toHaveBeenCalled();
        expect(response).toEqual(expect.objectContaining({ok: true, sessionId: "sess-1"}));
    });

    test("routes privileged alias through privileged transport", async () => {
        const PluginManager = require("../../src/utils/PluginManager").default;
        PluginManager.loadedPlugins = {
            "plugin-priv": {
                grantedCapabilities: ["system.process.exec"],
            },
        };
        PluginManager.getPluginDiagnostics = jest.fn(async () => null);

        const response = await PluginManager.resolveBackendBridgeResponse("plugin-priv", {
            handler: "requestPrivilegedAction",
            content: {
                request: {
                    action: "system.process.exec",
                    payload: {
                        scope: "demo",
                        command: "/usr/bin/true",
                    },
                },
            },
        }, "corr-priv");

        expect(mockExecuteHostPrivilegedAction).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({ok: true}));
    });

    test("returns explicit error for unsupported backend bridge handlers", async () => {
        const PluginManager = require("../../src/utils/PluginManager").default;
        PluginManager.loadedPlugins = {
            "plugin-x": {
                grantedCapabilities: [],
            },
        };
        PluginManager.getPluginDiagnostics = jest.fn(async () => null);

        const response = await PluginManager.resolveBackendBridgeResponse("plugin-x", {
            handler: "serviceHub.v1.auth.start",
            content: {},
        }, "corr-unsupported");

        expect(response).toEqual({
            ok: false,
            correlationId: "corr-unsupported",
            code: "BACKEND_BRIDGE_HANDLER_UNSUPPORTED",
            error: 'Unsupported backend bridge handler "serviceHub.v1.auth.start".',
        });
    });

    test("routes browser open handler through host browser broker", async () => {
        const PluginManager = require("../../src/utils/PluginManager").default;
        PluginManager.loadedPlugins = {
            "plugin-browser": {
                grantedCapabilities: [],
            },
        };
        PluginManager.getPluginDiagnostics = jest.fn(async () => null);

        const response = await PluginManager.resolveBackendBridgeResponse("plugin-browser", {
            handler: "fdo.browser.open.v1",
            content: {
                url: "https://example.com",
                policy: "trusted-content-link",
            },
        }, "corr-browser");

        expect(mockHandleHostBrowserOpenRequest).toHaveBeenCalledTimes(1);
        expect(response).toEqual(expect.objectContaining({ok: true}));
        expect(mockExecuteHostPrivilegedAction).not.toHaveBeenCalled();
    });
});
