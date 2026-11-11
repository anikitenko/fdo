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

jest.mock("../../src/utils/persistence/UserORM", () => ({
    __esModule: true,
    default: class UserORMMock {},
}));

jest.mock("../../src/utils/persistence/PluginORM", () => ({
    __esModule: true,
    default: class PluginORMMock {},
}));

jest.mock("../../src/utils/system/certs", () => ({
    Certs: {},
}));

jest.mock("../../src/utils/desktop/NotificationCenter", () => ({
    NotificationCenter: {
        addNotification: jest.fn(),
    },
}));

jest.mock("../../src/utils/plugins/runtime/pluginRuntimeBundle", () => ({
    buildPluginRuntimeBundle: jest.fn(),
    getHostPluginNodeModulesPath: jest.fn(),
}));

jest.mock("../../src/utils/plugins/security/pluginRuntimeSecurity", () => ({
    buildPluginRuntimePolicy: jest.fn(() => ({})),
    ensurePluginRuntimeBootstrap: jest.fn(),
    resolveHostGrantedCapabilities: jest.fn(() => []),
}));

const mockExecuteHostPrivilegedAction = jest.fn(async () => ({ok: true, correlationId: "priv-corr"}));

jest.mock("../../src/utils/plugins/security/hostPrivilegedActions", () => ({
    executeHostPrivilegedAction: (...args) => mockExecuteHostPrivilegedAction(...args),
    HOST_PRIVILEGED_HANDLER: "__host.privilegedAction",
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ: "system.clipboard.read",
    HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE: "system.clipboard.write",
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC: "system.process.exec",
}));

jest.mock("../../src/utils/plugins/security/pluginCapabilityDeclaration", () => ({
    extractCapabilityDeclarationComparison: jest.fn(() => ({})),
}));

jest.mock("../../src/utils/sdk/pluginHandshakeCompatibility", () => ({
    evaluatePluginHandshakeCompatibility: jest.fn(() => ({})),
    normalizeDiagnosticsHandshake: jest.fn(() => ({})),
}));

const mockHandleHostAiAssistantsListRequest = jest.fn(async () => ({ok: true, assistants: []}));
const mockHandleHostAiRequest = jest.fn(async () => ({ok: true, message: "ok"}));
jest.mock("../../src/utils/plugins/runtime/pluginHostAi", () => ({
    FDO_AI_LIST_ASSISTANTS_HANDLER_ID: "fdo.ai.assistants.list.v1",
    FDO_AI_REQUEST_HANDLER_ID: "fdo.ai.request.v1",
    handleHostAiAssistantsListRequest: (...args) => mockHandleHostAiAssistantsListRequest(...args),
    handleHostAiRequest: (...args) => mockHandleHostAiRequest(...args),
}));

const mockHandleHostAuthBrokerStartRequest = jest.fn(async () => ({ok: true, sessionId: "sess-1"}));
const mockHandleHostAuthBrokerRefreshRequest = jest.fn(async () => ({ok: true, sessionId: "sess-1"}));
const mockHandleHostAuthBrokerLogoutRequest = jest.fn(async () => ({ok: true}));
const mockHandleHostSessionRequest = jest.fn(async () => ({ok: true, status: 200}));
jest.mock("../../src/utils/plugins/runtime/pluginHostAuth", () => ({
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
jest.mock("../../src/utils/plugins/runtime/pluginHostBrowser", () => ({
    FDO_BROWSER_OPEN_HANDLER_ID: "fdo.browser.open.v1",
    handleHostBrowserOpenRequest: (...args) => mockHandleHostBrowserOpenRequest(...args),
}));

describe("PluginManager backend bridge routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("routes fdo.auth.start.v1 through auth broker handler instead of privileged transport", async () => {
        const PluginManager = require("../../src/utils/plugins/runtime/PluginManager").default;
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
        const PluginManager = require("../../src/utils/plugins/runtime/PluginManager").default;
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
        const PluginManager = require("../../src/utils/plugins/runtime/PluginManager").default;
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
        const PluginManager = require("../../src/utils/plugins/runtime/PluginManager").default;
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

test('retains safe Git audit diagnostics and assigns distinct IDs without command/output secrets', () => {
    const manager = require('../../src/utils/plugins/runtime/PluginManager').default;
    manager.privilegedAuditByPlugin = {};
    const event = {scope: 'git', success: false, correlationId: 'request-42', command: 'SECRET_COMMAND', args: ['SECRET_ARG'], cwd: 'SECRET_FOLDER', error: {
        code: 'CONNECTION_FAILED', error: 'SECRET_PROVIDER_MESSAGE', diagnosticDetails: {reason: 'AUTHENTICATION_FAILED', exitCode: 128, stdout: 'SECRET_OUTPUT'},
    }};
    manager.recordPrivilegedAudit('plugin-a', event);
    manager.recordPrivilegedAudit('plugin-a', event);
    const [first, second] = manager.getPrivilegedAuditTrail('plugin-a');
    expect(first.id).not.toBe(second.id);
    expect(first.error.diagnosticDetails).toEqual({reason: 'AUTHENTICATION_FAILED', exitCode: 128});
    expect(first.error.code).toBe('CONNECTION_FAILED');
    expect(JSON.stringify(first)).not.toContain('SECRET_');
});


describe("PluginManager resource diagnostics", () => {
    test("keeps resource counters and uses a host descriptor measurement", async () => {
        const manager = require("../../src/utils/plugins/runtime/PluginManager").default;
        const worker = {ready: true, sessionId: 'resource-session', instance: {pid: null}};
        manager.loadedPlugins = {resources: worker};
        const send = jest.spyOn(manager, 'postPluginUiMessageAndAwaitResult').mockResolvedValue({
            resources: {logging: {stderrFallbacks: 1}, storage: {pendingWrites: 2}, fileDescriptors: {count: 9000}},
        });
        const trace = jest.spyOn(manager, 'tracePluginEvent').mockImplementation(() => {});
        try {
            const result = await manager.refreshPluginDiagnostics('resources');
            expect(result.resources).toMatchObject({logging: {stderrFallbacks: 1}, storage: {pendingWrites: 2},
                fileDescriptors: {count: null, status: 'unavailable'}});
            expect(trace).toHaveBeenCalledWith('resources', 'diagnostics.refreshed', expect.objectContaining({resources: result.resources}));
        } finally { send.mockRestore(); trace.mockRestore(); }
    });

    test("does not cache a resource response from a replaced worker", async () => {
        const manager = require("../../src/utils/plugins/runtime/PluginManager").default;
        manager.loadedPlugins = {resources: {ready: true, sessionId: 'old', instance: {}}};
        const send = jest.spyOn(manager, 'postPluginUiMessageAndAwaitResult').mockImplementation(async () => {
            manager.loadedPlugins.resources = {ready: true, sessionId: 'new', instance: {}};
            return {resources: {}};
        });
        try { expect(await manager.refreshPluginDiagnostics('resources')).toBeNull(); }
        finally { send.mockRestore(); }
    });
});


test('restart is session-bound and coalesces duplicate requests', async () => {
    const manager = require('../../src/utils/plugins/runtime/PluginManager').default;
    const worker = {sessionId: 'restart-session'};
    manager.loadedPlugins = {'restart-fixture': worker};
    let drain;
    const unload = jest.spyOn(manager, 'unLoadPlugin').mockImplementation(() => new Promise(resolve => {drain = resolve;}));
    const load = jest.spyOn(manager, 'loadPlugin').mockResolvedValue({success: true});
    try {
        await expect(manager.restartPlugin('restart-fixture', 'stale')).resolves.toMatchObject({code: 'PLUGIN_BACKEND_STALE_SESSION'});
        const one = manager.restartPlugin('restart-fixture', 'restart-session');
        const two = manager.restartPlugin('restart-fixture', 'restart-session');
        await Promise.resolve();
        expect(unload).toHaveBeenCalledTimes(1);
        drain();
        await expect(one).resolves.toEqual({success: true});
        await expect(two).resolves.toEqual({success: true});
        expect(load).toHaveBeenCalledTimes(1);
    } finally {unload.mockRestore(); load.mockRestore();}
});

test('a window destroyed during an asynchronous reply cannot crash the host', () => {
    const manager = require('../../src/utils/plugins/runtime/PluginManager').default;
    manager.mainWindow = {isDestroyed: () => false, webContents: {isDestroyed: () => false, send() {throw new Error('destroyed');}}};
    expect(manager.sendToMainWindow('reply', {})).toBe(false);
    manager.mainWindow = null;
});
