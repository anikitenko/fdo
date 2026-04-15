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
const mockGetPluginCustomProcessScopes = jest.fn(() => []);
const mockSetPluginCustomProcessScopes = jest.fn((_pluginId, scopes) => ({success: true, scopes}));
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

        getPluginCustomProcessScopes(...args) {
            return mockGetPluginCustomProcessScopes(...args);
        }

        setPluginCustomProcessScopes(...args) {
            return mockSetPluginCustomProcessScopes(...args);
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
        expect(scopeResult.scopes.some((scope) => scope.scope === "public-web-secure" && scope.kind === "network")).toBe(true);
        const gitScope = scopeResult.scopes.find((scope) => scope.scope === "git");
        expect(gitScope?.argumentPolicy).toEqual(expect.objectContaining({
            version: 1,
            mode: "first-arg",
        }));
        expect(gitScope?.argumentPolicy?.allowedFirstArgs).toEqual(expect.arrayContaining(["status"]));
        expect(gitScope?.argumentPolicy?.pathRestrictedLeadingOptions).toEqual(expect.arrayContaining(["-C"]));
        const sourceControlScope = scopeResult.scopes.find((scope) => scope.scope === "source-control");
        expect(sourceControlScope?.argumentPolicy).toEqual(expect.objectContaining({
            version: 1,
            mode: "first-arg-by-executable",
        }));
        expect(sourceControlScope?.argumentPolicy?.rulesByExecutable?.git?.pathRestrictedLeadingOptions).toEqual(expect.arrayContaining(["-C"]));

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
            policyVersion: 1,
            argumentPolicy: {
                version: 1,
                mode: "first-arg",
                allowedFirstArgs: ["status"],
                deniedFirstArgs: ["credential"],
                allowedLeadingOptions: ["-C"],
                pathRestrictedLeadingOptions: ["-C"],
            },
            timeoutCeilingMs: 45000,
            requireConfirmation: true,
        });
        expect(customScopeResult).toEqual(expect.objectContaining({
            success: true,
            scope: expect.objectContaining({
                scope: "process-monitoring",
                userDefined: true,
                ownerType: "plugin",
                ownerPluginId: "plugin-a",
                policyVersion: 1,
                argumentPolicy: expect.objectContaining({
                    version: 1,
                    mode: "first-arg",
                    allowedLeadingOptions: expect.arrayContaining(["-C"]),
                    pathRestrictedLeadingOptions: expect.arrayContaining(["-C"]),
                }),
            }),
            scopes: expect.arrayContaining([
                expect.objectContaining({
                    scope: "process-monitoring",
                }),
            ]),
        }));

        const sharedScopeResult = await upsertSharedProcessScopeHandler({}, {
            scope: "shared-monitoring",
            title: "Shared Monitoring",
            description: "Shared scope for monitoring tools.",
            allowedExecutables: ["/usr/local/bin/top"],
            allowedCwdRoots: ["/tmp"],
            allowedEnvKeys: ["PATH"],
            policyVersion: 1,
            argumentPolicy: {
                version: 1,
                mode: "first-arg",
                allowedFirstArgs: ["status"],
                deniedFirstArgs: ["credential"],
                allowedLeadingOptions: ["-C"],
                pathRestrictedLeadingOptions: ["-C"],
            },
            timeoutCeilingMs: 30000,
            requireConfirmation: true,
        });
        expect(sharedScopeResult).toEqual(expect.objectContaining({
            success: true,
            scope: expect.objectContaining({
                scope: "shared-monitoring",
                userDefined: true,
                shared: true,
                ownerType: "shared",
                policyVersion: 1,
                argumentPolicy: expect.objectContaining({
                    version: 1,
                    mode: "first-arg",
                    allowedLeadingOptions: expect.arrayContaining(["-C"]),
                    pathRestrictedLeadingOptions: expect.arrayContaining(["-C"]),
                }),
            }),
            scopes: expect.arrayContaining([
                expect.objectContaining({
                    scope: "shared-monitoring",
                }),
            ]),
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

    test("allows extending plugin process scope cwd roots from policy rejection flow", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        mockGetPluginCustomProcessScopes.mockReset();
        mockSetPluginCustomProcessScopes.mockReset();
        mockGetPluginCustomProcessScopes.mockReturnValue([]);
        mockSetPluginCustomProcessScopes.mockImplementation((_pluginId, scopes) => ({success: true, scopes}));

        registerPluginHandlers();
        const allowCwdRootHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_CWD_ROOT)?.[1];

        const result = await allowCwdRootHandler({}, "plugin-a", "git", "/tmp/project-workspace");

        expect(result).toEqual(expect.objectContaining({
            success: true,
            alreadyPresent: false,
            addedRoot: "/tmp/project-workspace",
            scope: expect.objectContaining({
                scope: "git",
                ownerType: "plugin",
                ownerPluginId: "plugin-a",
            }),
        }));
        expect(result.scope.allowedCwdRoots).toEqual(expect.arrayContaining(["/tmp/project-workspace"]));
        expect(mockSetPluginCustomProcessScopes).toHaveBeenCalledWith(
            "plugin-a",
            expect.arrayContaining([
                expect.objectContaining({
                    scope: "git",
                    allowedCwdRoots: expect.arrayContaining(["/tmp/project-workspace"]),
                }),
            ])
        );
    });

    test("allows extending plugin process scope first-argument policy from policy rejection flow", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        mockGetPluginCustomProcessScopes.mockReset();
        mockSetPluginCustomProcessScopes.mockReset();
        mockGetPluginCustomProcessScopes.mockReturnValue([]);
        mockSetPluginCustomProcessScopes.mockImplementation((_pluginId, scopes) => ({success: true, scopes}));

        registerPluginHandlers();
        const allowArgumentHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_ARGUMENT)?.[1];

        const result = await allowArgumentHandler({}, "plugin-a", "git", "-C", "git");

        expect(result).toEqual(expect.objectContaining({
            success: true,
            alreadyPresent: false,
            addedArgument: "-C",
            executableName: "",
            scope: expect.objectContaining({
                scope: "git",
                ownerType: "plugin",
                ownerPluginId: "plugin-a",
            }),
        }));
        expect(result.scope.additionalAllowedLeadingOptions).toEqual(expect.arrayContaining(["-C"]));
        expect(mockSetPluginCustomProcessScopes).toHaveBeenCalledWith(
            "plugin-a",
            expect.arrayContaining([
                expect.objectContaining({
                    scope: "git",
                    additionalAllowedLeadingOptions: expect.arrayContaining(["-C"]),
                }),
            ])
        );
    });

    test("allows extending plugin process scope env-key allowlist from policy rejection flow", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        mockGetPluginCustomProcessScopes.mockReset();
        mockSetPluginCustomProcessScopes.mockReset();
        mockGetPluginCustomProcessScopes.mockReturnValue([]);
        mockSetPluginCustomProcessScopes.mockImplementation((_pluginId, scopes) => ({success: true, scopes}));

        registerPluginHandlers();
        const allowEnvKeyHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_ENV_KEY)?.[1];

        const result = await allowEnvKeyHandler({}, "plugin-a", "git", "AWS_CLIENT_ID");

        expect(result).toEqual(expect.objectContaining({
            success: true,
            alreadyPresent: false,
            addedEnvKey: "AWS_CLIENT_ID",
            scope: expect.objectContaining({
                scope: "git",
                ownerType: "plugin",
                ownerPluginId: "plugin-a",
            }),
        }));
        expect(result.scope.allowedEnvKeys).toEqual(expect.arrayContaining(["AWS_CLIENT_ID"]));
        expect(mockSetPluginCustomProcessScopes).toHaveBeenCalledWith(
            "plugin-a",
            expect.arrayContaining([
                expect.objectContaining({
                    scope: "git",
                    allowedEnvKeys: expect.arrayContaining(["AWS_CLIENT_ID"]),
                }),
            ])
        );
    });

    test("does not allow one-click override for explicitly denied process arguments", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");

        ipcMain.handle.mockClear();
        mockGetPluginCustomProcessScopes.mockReset();
        mockSetPluginCustomProcessScopes.mockReset();
        mockGetPluginCustomProcessScopes.mockReturnValue([]);
        mockSetPluginCustomProcessScopes.mockImplementation((_pluginId, scopes) => ({success: true, scopes}));

        registerPluginHandlers();
        const allowArgumentHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.ALLOW_PLUGIN_PROCESS_SCOPE_ARGUMENT)?.[1];

        const result = await allowArgumentHandler({}, "plugin-a", "git", "credential", "git");

        expect(result).toEqual(expect.objectContaining({
            success: false,
            scope: null,
        }));
        expect(String(result.error || "")).toMatch(/explicitly denied/i);
        expect(mockSetPluginCustomProcessScopes).not.toHaveBeenCalled();
    });

    test("restarts loaded runtime only when storage capability family changes", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        ipcMain.handle.mockClear();
        PluginManager.getLoadedPlugin.mockReset();
        PluginManager.loadPlugin.mockReset();
        PluginManager.unLoadPlugin.mockReset();
        mockSetPluginCapabilities.mockReset();
        mockGetPlugin.mockReset();
        mockGetPlugin.mockImplementation(() => ({
            id: "plugin-a",
            metadata: {name: "Plugin A", version: "1.0.0", author: "E2E", description: "d", icon: "clean"},
            capabilities: ["storage", "storage.json"],
        }));

        registerPluginHandlers();
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];

        const loadedPlugin = {grantedCapabilities: ["system.process.exec"]};
        PluginManager.getLoadedPlugin.mockReturnValue(loadedPlugin);
        PluginManager.loadPlugin.mockResolvedValue({success: true});
        mockSetPluginCapabilities.mockImplementation((_id, caps) => ({success: true, capabilities: caps}));

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", ["storage", "storage.json"]);
        expect(updateResult.success).toBe(true);
        expect(updateResult.runtimeRestarted).toBe(true);
        expect(updateResult.runtimeRestartError).toBe("");
        expect(PluginManager.unLoadPlugin).toHaveBeenCalledWith("plugin-a", {
            force: true,
            reason: "capabilities_storage_changed",
        });
        expect(PluginManager.loadPlugin).toHaveBeenCalledWith("plugin-a");
    });

    test("does not restart loaded runtime when non-storage capabilities change", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        ipcMain.handle.mockClear();
        PluginManager.getLoadedPlugin.mockReset();
        PluginManager.loadPlugin.mockReset();
        PluginManager.unLoadPlugin.mockReset();
        mockSetPluginCapabilities.mockReset();
        mockGetPlugin.mockReset();
        mockGetPlugin.mockImplementation(() => ({
            id: "plugin-a",
            metadata: {name: "Plugin A", version: "1.0.0", author: "E2E", description: "d", icon: "clean"},
            capabilities: ["storage", "storage.json", "system.process.exec"],
        }));

        registerPluginHandlers();
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];

        const loadedPlugin = {grantedCapabilities: ["storage", "storage.json"]};
        PluginManager.getLoadedPlugin.mockReturnValue(loadedPlugin);
        mockSetPluginCapabilities.mockImplementation((_id, caps) => ({success: true, capabilities: caps}));

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", ["storage", "storage.json", "system.process.exec"]);
        expect(updateResult.success).toBe(true);
        expect(updateResult.runtimeRestarted).toBe(false);
        expect(updateResult.runtimeRestartError).toBe("");
        expect(PluginManager.unLoadPlugin).not.toHaveBeenCalled();
        expect(PluginManager.loadPlugin).not.toHaveBeenCalled();
        expect(loadedPlugin.grantedCapabilities).toEqual(["storage", "storage.json", "system.process.exec"]);
    });

    test("restarts loaded runtime when network capability family changes", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        ipcMain.handle.mockClear();
        PluginManager.getLoadedPlugin.mockReset();
        PluginManager.loadPlugin.mockReset();
        PluginManager.unLoadPlugin.mockReset();
        mockSetPluginCapabilities.mockReset();
        mockGetPlugin.mockReset();
        mockGetPlugin.mockImplementation(() => ({
            id: "plugin-a",
            metadata: {name: "Plugin A", version: "1.0.0", author: "E2E", description: "d", icon: "clean"},
            capabilities: ["storage", "storage.json", "system.network", "system.network.http"],
        }));

        registerPluginHandlers();
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];

        const loadedPlugin = {grantedCapabilities: ["storage", "storage.json"]};
        PluginManager.getLoadedPlugin.mockReturnValue(loadedPlugin);
        PluginManager.loadPlugin.mockResolvedValue({success: true});
        mockSetPluginCapabilities.mockImplementation((_id, caps) => ({success: true, capabilities: caps}));

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", ["storage", "storage.json", "system.network", "system.network.http"]);
        expect(updateResult.success).toBe(true);
        expect(updateResult.runtimeRestarted).toBe(true);
        expect(updateResult.runtimeRestartError).toBe("");
        expect(PluginManager.unLoadPlugin).toHaveBeenCalledWith("plugin-a", {
            force: true,
            reason: "capabilities_network_changed",
        });
        expect(PluginManager.loadPlugin).toHaveBeenCalledWith("plugin-a");
    });

    test("restarts loaded runtime when network scope capabilities change", async () => {
        jest.resetModules();
        const {ipcMain} = require("electron");
        const {registerPluginHandlers} = require("../../src/ipc/plugin");
        const {PluginChannels} = require("../../src/ipc/channels");
        const PluginManager = require("../../src/utils/PluginManager").default;

        ipcMain.handle.mockClear();
        PluginManager.getLoadedPlugin.mockReset();
        PluginManager.loadPlugin.mockReset();
        PluginManager.unLoadPlugin.mockReset();
        mockSetPluginCapabilities.mockReset();
        mockGetPlugin.mockReset();
        mockGetPlugin.mockImplementation(() => ({
            id: "plugin-a",
            metadata: {name: "Plugin A", version: "1.0.0", author: "E2E", description: "d", icon: "clean"},
            capabilities: ["storage", "storage.json", "system.network", "system.network.https", "system.network.scope.public-web-secure"],
        }));

        registerPluginHandlers();
        const setCapabilitiesHandler = ipcMain.handle.mock.calls.find(([channel]) => channel === PluginChannels.SET_CAPABILITIES)[1];

        const loadedPlugin = {grantedCapabilities: ["storage", "storage.json", "system.network", "system.network.https"]};
        PluginManager.getLoadedPlugin.mockReturnValue(loadedPlugin);
        PluginManager.loadPlugin.mockResolvedValue({success: true});
        mockSetPluginCapabilities.mockImplementation((_id, caps) => ({success: true, capabilities: caps}));

        const updateResult = await setCapabilitiesHandler({}, "plugin-a", [
            "storage",
            "storage.json",
            "system.network",
            "system.network.https",
            "system.network.scope.public-web-secure",
        ]);
        expect(updateResult.success).toBe(true);
        expect(updateResult.runtimeRestarted).toBe(true);
        expect(updateResult.runtimeRestartError).toBe("");
        expect(PluginManager.unLoadPlugin).toHaveBeenCalledWith("plugin-a", {
            force: true,
            reason: "capabilities_network_changed",
        });
        expect(PluginManager.loadPlugin).toHaveBeenCalledWith("plugin-a");
    });
});
