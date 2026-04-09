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

        getAllPlugins() {
            return [mockGetPlugin()];
        }

        getPluginCustomProcessScopes() {
            return [];
        }

        setPluginCustomProcessScopes(_pluginId, scopes) {
            return {success: true, scopes};
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
        getPluginDiagnostics: jest.fn(),
        getPrivilegedAuditTrail: jest.fn(() => []),
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
        const PluginManager = require("../../src/utils/PluginManager").default;

        ipcMain.handle.mockClear();
        registerPluginHandlers();

        const getScopePoliciesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_SCOPE_POLICIES)[1];
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];
        const upsertPluginCustomProcessScopeHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UPSERT_PLUGIN_CUSTOM_PROCESS_SCOPE)[1];
        const upsertSharedProcessScopeHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.UPSERT_SHARED_PROCESS_SCOPE)[1];
        const getRuntimeStatusHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.GET_RUNTIME_STATUS)[1];

        const scopeResult = await getScopePoliciesHandler({}, "plugin-a");
        expect(scopeResult.success).toBe(true);
        expect(Array.isArray(scopeResult.scopes)).toBe(true);
        expect(scopeResult.scopes.some((scope) => typeof scope.validateArgs === "function")).toBe(false);
        expect(() => JSON.stringify(scopeResult)).not.toThrow();
        expect(scopeResult.scopes.some((scope) => scope.scope === "system-observe" && scope.fallback === true)).toBe(true);
        expect(scopeResult.scopes.some((scope) => scope.scope === "network-diagnostics" && scope.fallback === true)).toBe(true);
        expect(scopeResult.scopes.some((scope) => scope.scope === "build-tooling" && scope.fallback === true)).toBe(true);
        expect(scopeResult.scopes.some((scope) => scope.scope === "aws-cli")).toBe(true);
        expect(scopeResult.scopes.some((scope) => scope.scope === "gcloud")).toBe(true);
        expect(scopeResult.scopes.some((scope) => scope.scope === "azure-cli")).toBe(true);

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", ["system.hosts.write"]);
        expect(mockSetPluginCapabilities).toHaveBeenCalledWith("plugin-a", ["system.hosts.write"]);
        expect(updateResult).toEqual(expect.objectContaining({
            success: true,
            capabilities: ["system.hosts.write"],
        }));
        expect(updateResult.plugin?.id).toBe("plugin-a");

        const customScopeResult = await upsertPluginCustomProcessScopeHandler({}, "plugin-a", {
            scope: "process-monitoring",
            title: "Process Monitoring",
            description: "Custom scope for htop-like tools.",
            allowedExecutables: ["/usr/local/bin/htop"],
            allowedCwdRoots: ["/tmp"],
            allowedEnvKeys: ["PATH"],
            timeoutCeilingMs: 45000,
            requireConfirmation: true,
        });
        expect(customScopeResult).toEqual(expect.objectContaining({
            success: true,
            scope: expect.objectContaining({
                scope: "user.process-monitoring",
                userDefined: true,
                ownerType: "plugin",
                ownerPluginId: "plugin-a",
            }),
        }));

        const sharedScopeResult = await upsertSharedProcessScopeHandler({}, {
            scope: "shared-monitoring",
            title: "Shared Monitoring",
            description: "Shared scope for monitoring tools.",
            allowedExecutables: ["/usr/local/bin/top"],
            allowedCwdRoots: ["/tmp"],
            allowedEnvKeys: ["PATH"],
            timeoutCeilingMs: 30000,
            requireConfirmation: true,
        });
        expect(sharedScopeResult).toEqual(expect.objectContaining({
            success: true,
            scope: expect.objectContaining({
                scope: "user.shared-monitoring",
                userDefined: true,
                shared: true,
                ownerType: "shared",
            }),
        }));

        PluginManager.getLoadedPlugin.mockReturnValue({
            grantedCapabilities: [],
        });
        PluginManager.getPluginDiagnostics.mockResolvedValue({
            capabilities: {
                declaration: {
                    declared: ["system.process.exec"],
                    granted: ["system.process.exec", "system.process.scope.system-observe"],
                    missingDeclared: [],
                    undeclaredGranted: ["system.process.scope.system-observe"],
                    hasDeclaration: true,
                    available: true,
                },
            },
        });

        const runtimeStatusResult = await getRuntimeStatusHandler({}, ["plugin-a"]);
        expect(runtimeStatusResult.success).toBe(true);
        expect(runtimeStatusResult.statuses[0].capabilityIntent).toEqual(expect.objectContaining({
            declared: ["system.process.exec"],
            granted: [],
            missingDeclared: ["system.process.exec"],
            undeclaredGranted: [],
        }));
    });
});
