import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {ManagePluginsDialog} from "../../src/components/ManagePluginsDialog.jsx";

jest.mock("recharts", () => {
    const React = require("react");
    const passthrough = ({children}) => <div>{children}</div>;
    return {
        ResponsiveContainer: passthrough,
        LineChart: passthrough,
        Line: () => null,
        CartesianGrid: () => null,
        XAxis: () => null,
        YAxis: () => null,
        Tooltip: () => null,
        Legend: () => null,
    };
});

describe("ManagePluginsDialog capability UX", () => {
    const basePlugin = {
        id: "plugin-a",
        name: "Plugin A",
        icon: "cog",
        author: "Author",
        version: "1.0.0",
        description: "Test plugin",
        capabilities: [],
    };

    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
            configurable: true,
            value: jest.fn(),
            writable: true,
        });
        window.electron.plugin = {
            getScopePolicies: jest.fn().mockResolvedValue({
                success: true,
                scopes: [
                    {
                        scope: "etc-hosts",
                        kind: "filesystem",
                        description: "Controlled /etc hosts mutation scope.",
                        allowedRoots: ["/etc"],
                        allowedOperationTypes: ["writeFile"],
                        requireConfirmation: true,
                    },
                    {
                        scope: "docker-cli",
                        kind: "process",
                        description: "Scoped Docker CLI execution.",
                        allowedCwdRoots: ["/tmp"],
                        allowedExecutables: ["/usr/local/bin/docker"],
                        allowedEnvKeys: ["DOCKER_CONTEXT"],
                        argumentPolicy: {
                            mode: "first-arg",
                            allowedFirstArgs: ["version", "ps", "images", "pull", "run"],
                            deniedFirstArgs: ["exec"],
                            pathRestrictedLeadingOptions: ["-C"],
                        },
                        timeoutCeilingMs: 30000,
                        requireConfirmation: true,
                    },
                    {
                        scope: "system-inspect",
                        kind: "process",
                        category: "System",
                        fallback: true,
                        description: "Scoped system inspection commands.",
                        allowedCwdRoots: ["/tmp"],
                        allowedExecutables: ["/bin/ls", "/usr/bin/pwd"],
                        allowedEnvKeys: ["PATH"],
                        timeoutCeilingMs: 15000,
                        requireConfirmation: true,
                    },
                    {
                        scope: "package-management",
                        kind: "process",
                        category: "Package Management",
                        fallback: true,
                        description: "Scoped package manager execution.",
                        allowedCwdRoots: ["/tmp"],
                        allowedExecutables: ["/opt/homebrew/bin/brew", "/usr/bin/npm"],
                        allowedEnvKeys: ["PATH"],
                        timeoutCeilingMs: 120000,
                        requireConfirmation: true,
                    },
                    {
                        scope: "public-web-secure",
                        kind: "network",
                        category: "Network",
                        description: "Allows secure outbound web traffic to public HTTPS and WSS endpoints.",
                        allowedSchemes: ["https", "wss"],
                        allowedHostPatterns: ["*"],
                        allowedPorts: ["*"],
                        allowedTransports: ["fetch", "xhr", "eventsource", "websocket"],
                        requireConfirmation: false,
                    },
                ],
            }),
            getRuntimeStatus: jest.fn().mockResolvedValue({
                success: true,
                statuses: [
                    {
                        id: "plugin-a",
                        capabilityIntent: {
                            available: true,
                            hasDeclaration: true,
                            declared: ["system.process.exec", "system.process.scope.docker-cli"],
                            granted: ["system.process.exec"],
                            missingDeclared: ["system.process.scope.docker-cli"],
                            undeclaredGranted: [],
                        },
                        capabilityIntentSummary: {
                            title: "Declared capability gaps",
                            intent: "warning",
                        },
                    },
                ],
            }),
            getPluginCustomProcessScopes: jest.fn().mockResolvedValue({
                success: true,
                scopes: [
                    {
                        scope: "process-monitoring",
                        title: "Process Monitoring",
                        kind: "process",
                        category: "Plugin-Specific Scopes",
                        userDefined: true,
                        ownerType: "plugin",
                        ownerPluginId: "plugin-a",
                        description: "Host-managed custom scope for htop-like commands.",
                        allowedExecutables: ["/usr/local/bin/htop"],
                        allowedCwdRoots: ["/tmp"],
                        allowedEnvKeys: ["PATH"],
                        timeoutCeilingMs: 45000,
                        requireConfirmation: true,
                    },
                ],
            }),
            getPluginCustomFilesystemScopes: jest.fn().mockResolvedValue({
                success: true,
                scopes: [
                    {
                        scope: "workspace-write",
                        title: "Workspace Writes",
                        kind: "filesystem",
                        category: "Plugin-Specific Filesystem Scopes",
                        userDefined: true,
                        ownerType: "plugin",
                        ownerPluginId: "plugin-a",
                        description: "Scoped workspace writes.",
                        allowedRoots: ["/tmp"],
                        allowedOperationTypes: ["writeFile", "appendFile"],
                        requireConfirmation: true,
                    },
                ],
            }),
            upsertPluginCustomProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deletePluginCustomProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            upsertPluginCustomFilesystemScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deletePluginCustomFilesystemScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            getSharedProcessScopes: jest.fn().mockResolvedValue({success: true, scopes: []}),
            upsertSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deleteSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            getSharedFilesystemScopes: jest.fn().mockResolvedValue({success: true, scopes: []}),
            upsertSharedFilesystemScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deleteSharedFilesystemScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            verifySignature: jest.fn().mockResolvedValue({
                success: true,
                signed: true,
                commonName: {value: "Plugin A"},
                signer: {label: "Test Root CA"},
            }),
            setCapabilities: jest.fn().mockImplementation(async (_id, capabilities) => ({
                success: true,
                capabilities: Array.isArray(capabilities) ? capabilities : [],
            })),
        };
        window.electron.system = {
            getPluginMetric: jest.fn().mockResolvedValue([]),
            openEditorWindow: jest.fn(),
            openPluginInEditor: jest.fn().mockResolvedValue({success: true}),
        };
        window.electron.settings = {
            certificates: {
                getRoot: jest.fn().mockResolvedValue([]),
            },
        };
    });

    function renderDialog(pluginOverride = {}, focusRequest = null, extraProps = {}) {
        const selectPlugin = jest.fn();
        const refreshPluginsState = jest.fn().mockResolvedValue();
        return render(
            <ManagePluginsDialog
                show={true}
                setShow={extraProps.setShow || jest.fn()}
                plugins={[{...basePlugin, ...pluginOverride}]}
                activePlugins={[{...basePlugin, ...pluginOverride}]}
                deselectPlugin={jest.fn()}
                selectPlugin={selectPlugin}
                removePlugin={jest.fn()}
                setSearchActions={jest.fn()}
                refreshPluginsState={refreshPluginsState}
                focusRequest={focusRequest}
                onFocusRequestConsumed={extraProps.onFocusRequestConsumed || jest.fn()}
                pendingPluginScopeSuggestions={extraProps.pendingPluginScopeSuggestions || {}}
                onPendingPluginScopeSuggestionResolved={extraProps.onPendingPluginScopeSuggestionResolved || jest.fn()}
            />
        );
    }

    test("shows friendly labels with technical IDs", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        expect(screen.getByRole("button", {name: "Expand"})).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {name: "Expand"}));

        expect(screen.getByText("Declared Capability Intent")).toBeInTheDocument();
        expect(screen.getByText("Plugin-Specific Process Scopes")).toBeInTheDocument();
        expect(screen.getByText("Process Monitoring")).toBeInTheDocument();
        expect(screen.getByText(/Allowed commands: \/usr\/local\/bin\/htop/)).toBeInTheDocument();
        expect(screen.getByText("Declared capability gaps")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {name: "Show details"}));
        expect(screen.getByText("Missing for full feature set")).toBeInTheDocument();
        expect(screen.getAllByText(/system\.process\.scope\.docker-cli/).length).toBeGreaterThan(0);
        expect(screen.getByText("Privileged host actions")).toBeInTheDocument();
        expect(screen.getAllByText("Allow Scoped Tool Execution").length).toBeGreaterThan(0);
        expect(screen.getByText("Network access")).toBeInTheDocument();
        expect(screen.getByText("HTTPS requests")).toBeInTheDocument();
        expect(screen.getByText("Plain HTTP requests")).toBeInTheDocument();
        expect(screen.getByText("WebSocket connections")).toBeInTheDocument();
        const httpsRequests = screen.getByText("HTTPS requests");
        expect(screen.queryByText("Recommended network setup")).not.toBeInTheDocument();
        expect(httpsRequests).toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Enable Secure Public Web"})).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Enable Loopback Dev"})).not.toBeInTheDocument();
        expect(screen.getByText("Persistent plugin JSON storage")).toBeInTheDocument();
        expect(screen.getByText(/Trust tier: Basic|Trust tier: Operator|Trust tier: Admin/)).toBeInTheDocument();
        expect(screen.getAllByText(/Technical ID:/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("system.host.write").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
    });

    test("shows network recommendations when opened from a network capability error", async () => {
        renderDialog({}, {
            requestId: "network-fix-1",
            pluginId: "plugin-a",
            focusSection: "capabilities",
            capabilityIds: ["system.network", "system.network.https", "system.network.scope.public-web-secure"],
        });

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        const recommendedNetworkSetup = screen.getByText("Recommended network setup");
        const httpsRequests = screen.getByText("HTTPS requests");
        expect(recommendedNetworkSetup).toBeInTheDocument();
        expect(recommendedNetworkSetup.compareDocumentPosition(httpsRequests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByRole("button", {name: "Enable Secure Public Web"})).toBeInTheDocument();
    });

    test("filters scope groups without hiding the base capability controls", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByPlaceholderText("Filter scopes, commands, capability IDs")).toBeInTheDocument();
        });

        expect(screen.getByRole("button", {name: "Expand"})).toBeInTheDocument();
        fireEvent.change(
            screen.getByPlaceholderText("Filter scopes, commands, capability IDs"),
            {target: {value: "brew"}}
        );

        await waitFor(() => {
            expect(screen.getByRole("button", {name: "Collapse"})).toBeInTheDocument();
        });

        expect(screen.getAllByText("Allow Scoped Tool Execution").length).toBeGreaterThan(0);
        expect(screen.queryByRole("checkbox", {name: "Docker CLI Scope"})).not.toBeInTheDocument();

        fireEvent.change(
            screen.getByPlaceholderText("Filter scopes, commands, capability IDs"),
            {target: {value: ""}}
        );

        await waitFor(() => {
            expect(screen.getByRole("button", {name: "Expand"})).toBeInTheDocument();
        });
    });

    test("shows argument-policy visibility in process scope details", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Expand"}));
        fireEvent.change(
            screen.getByPlaceholderText("Filter scopes, commands, capability IDs"),
            {target: {value: "docker"}}
        );
        fireEvent.click(screen.getByRole("button", {name: "View policy details"}));

        await waitFor(() => {
            expect(screen.getByText("Allowed subcommands")).toBeInTheDocument();
            expect(screen.getByText("Blocked subcommands")).toBeInTheDocument();
            expect(screen.getByText("Path-restricted leading options")).toBeInTheDocument();
            expect(screen.getByText("version")).toBeInTheDocument();
            expect(screen.getByText("exec")).toBeInTheDocument();
            expect(screen.getByText("-C")).toBeInTheDocument();
        });
    });

    test("renders capability panel when scope exists without base capability", async () => {
        renderDialog({
            capabilities: ["system.fs.scope.etc-hosts"],
        });

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });
    });

    test("renders capability panel when process base capability is enabled without any process scopes", async () => {
        renderDialog({
            capabilities: ["system.process.exec"],
        });

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });
    });

    test("renders capability panel for focus requests with missing capability ids", async () => {
        renderDialog(
            { capabilities: [] },
            {
                requestId: "req-1",
                pluginId: "plugin-a",
                capabilityIds: ["system.fs.scope.etc-hosts"],
            }
        );

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });
    });

    test("saving capabilities re-selects an active plugin after refresh", async () => {
        const selectPlugin = jest.fn();
        const refreshPluginsState = jest.fn().mockResolvedValue();
        render(
            <ManagePluginsDialog
                show={true}
                setShow={jest.fn()}
                plugins={[{...basePlugin, capabilities: []}]}
                activePlugins={[{...basePlugin, capabilities: []}]}
                deselectPlugin={jest.fn()}
                selectPlugin={selectPlugin}
                removePlugin={jest.fn()}
                setSearchActions={jest.fn()}
                refreshPluginsState={refreshPluginsState}
                focusRequest={null}
            />
        );

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Expand"}));
        fireEvent.click(screen.getByRole("checkbox", {name: "Allow Scoped Tool Execution"}));
        fireEvent.click(screen.getByRole("button", {name: "Save Capabilities"}));

        await waitFor(() => {
            expect(window.electron.plugin.setCapabilities).toHaveBeenCalledWith("plugin-a", ["system.process.exec"]);
            expect(refreshPluginsState).toHaveBeenCalled();
            expect(selectPlugin).toHaveBeenCalledWith(expect.objectContaining({id: "plugin-a"}), {open: true});
        });
    });

    test("storage capability family requires explicit child selection", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Expand"}));

        const storageBase = screen.getByRole("checkbox", {name: "Persistent plugin storage"});
        const storageJson = screen.getByRole("checkbox", {name: "Persistent plugin JSON storage"});

        expect(storageBase).not.toBeChecked();
        expect(storageJson).not.toBeChecked();
        expect(storageJson).toBeDisabled();

        fireEvent.click(storageBase);
        expect(storageBase).toBeChecked();
        expect(storageJson).not.toBeChecked();
        expect(storageJson).not.toBeDisabled();

        fireEvent.click(storageJson);
        expect(storageJson).toBeChecked();

        fireEvent.click(storageBase);
        expect(storageBase).not.toBeChecked();
        expect(storageJson).not.toBeChecked();

        fireEvent.click(storageBase);
        fireEvent.click(storageJson);
        fireEvent.click(screen.getByRole("button", {name: "Save Capabilities"}));

        await waitFor(() => {
            expect(window.electron.plugin.setCapabilities).toHaveBeenCalledWith(
                "plugin-a",
                expect.arrayContaining(["storage", "storage.json"])
            );
        });
    });

    test("network capability family requires explicit child selection", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Expand"}));

        const networkBase = screen.getByRole("checkbox", {name: "Network access"});
        const networkHttps = screen.getByRole("checkbox", {name: "HTTPS requests"});
        const networkHttp = screen.getByRole("checkbox", {name: "Plain HTTP requests"});
        const securePublicWebScope = screen.getByRole("checkbox", {name: "Secure Public Web Scope"});

        expect(networkBase).not.toBeChecked();
        expect(networkHttps).not.toBeChecked();
        expect(networkHttp).not.toBeChecked();
        expect(networkHttps).toBeDisabled();
        expect(networkHttp).toBeDisabled();

        fireEvent.click(networkBase);
        expect(networkBase).toBeChecked();
        expect(networkHttps).not.toBeDisabled();
        expect(networkHttp).not.toBeDisabled();
        expect(screen.getByText("Network access is enabled, but no transport is selected yet. Select the exact network API the plugin needs. Start with HTTPS. Avoid Plain HTTP and update the plugin to use HTTPS unless migration is blocked. Grant raw sockets only to high-trust plugins.")).toBeInTheDocument();
        expect(screen.getByText("Public HTTPS APIs")).toBeInTheDocument();
        expect(screen.getByText("Localhost development services")).toBeInTheDocument();

        fireEvent.click(networkHttps);
        expect(networkHttps).toBeChecked();
        fireEvent.click(networkHttp);
        expect(networkHttp).toBeChecked();
        expect(screen.getByText(/Selected transports: HTTPS requests, Plain HTTP requests\./)).toBeInTheDocument();
        expect(screen.getByText(/These grants alone do not allow outbound traffic yet\./)).toBeInTheDocument();
        expect(screen.getByText(/Plain HTTP is not recommended\./)).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Replace HTTP With HTTPS"})).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {name: "Replace HTTP With HTTPS"}));
        expect(networkHttp).not.toBeChecked();
        expect(networkHttps).toBeChecked();
        expect(securePublicWebScope).toBeChecked();
        expect(screen.getByText("Review and save pending network changes")).toBeInTheDocument();
        expect(screen.getByText(/recommended HTTPS-based selection/)).toBeInTheDocument();

        fireEvent.click(networkBase);
        expect(networkBase).not.toBeChecked();
        expect(networkHttps).not.toBeChecked();
        expect(networkHttp).not.toBeChecked();
        expect(securePublicWebScope).not.toBeChecked();

        fireEvent.click(networkBase);
        expect(screen.getByText("Recommended network setup")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {name: "Enable Secure Public Web"}));
        expect(networkBase).toBeChecked();
        expect(networkHttps).toBeChecked();
        expect(securePublicWebScope).toBeChecked();
        expect(screen.queryByText("Recommended network setup")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Enable Secure Public Web"})).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Enable Loopback Dev"})).not.toBeInTheDocument();
        expect(screen.getByText("Review and save pending network changes")).toBeInTheDocument();
        expect(screen.getAllByRole("button", {name: "Save Capabilities"}).length).toBeGreaterThan(0);
        fireEvent.click(screen.getAllByRole("button", {name: "Save Capabilities"})[0]);

        await waitFor(() =>
            expect(window.electron.plugin.setCapabilities).toHaveBeenCalledWith(
                "plugin-a",
                expect.arrayContaining([
                    "system.network",
                    "system.network.https",
                    "system.network.scope.public-web-secure",
                ])
            )
        );
    });

    test("custom scope form uses scope-specific labels and closes after save", async () => {
        window.electron.plugin.upsertPluginCustomProcessScope.mockResolvedValueOnce({
            success: true,
            scopes: [
                {
                    scope: "process-monitoring",
                    title: "Process Monitoring",
                    kind: "process",
                    category: "Plugin-Specific Scopes",
                    userDefined: true,
                    ownerType: "plugin",
                    ownerPluginId: "plugin-a",
                    description: "Host-managed custom scope for htop-like commands.",
                    allowedExecutables: ["/usr/local/bin/htop"],
                    allowedCwdRoots: ["/tmp"],
                    allowedEnvKeys: ["PATH"],
                    timeoutCeilingMs: 45000,
                    requireConfirmation: true,
                },
            ],
        });

        renderDialog();

        await waitFor(() => {
            expect(screen.getByRole("button", {name: "Add Plugin Scope"})).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Add Plugin Scope"}));

        expect(screen.getByRole("heading", {name: "Create Plugin-Specific Scope"})).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Save Scope"})).toBeInTheDocument();
        expect(screen.getByText(/Plugin request ID:/)).toBeInTheDocument();
        expect(screen.getByText(/plugin-specific scope reference/i)).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("internal-runner"), {
            target: {value: "process-monitoring"},
        });
        fireEvent.change(screen.getByPlaceholderText("Process Monitoring"), {
            target: {value: "Process Monitoring"},
        });
        fireEvent.change(screen.getByPlaceholderText("/usr/local/bin/htop"), {
            target: {value: "/usr/local/bin/htop"},
        });
        fireEvent.keyDown(screen.getByPlaceholderText("/usr/local/bin/htop"), {key: "Enter"});
        fireEvent.click(screen.getByRole("button", {name: "Save Scope"}));

        await waitFor(() => {
            expect(window.electron.plugin.upsertPluginCustomProcessScope).toHaveBeenCalledWith("plugin-a", expect.any(Object));
            expect(window.electron.plugin.getScopePolicies).toHaveBeenLastCalledWith("plugin-a");
            expect(window.electron.plugin.setCapabilities).not.toHaveBeenCalled();
            expect(screen.getByRole("button", {name: "Add Plugin Scope"})).toBeInTheDocument();
            expect(screen.queryByRole("button", {name: "Save Scope"})).not.toBeInTheDocument();
        });
    });

    test("custom scope editor exposes argument override inputs", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByRole("button", {name: "Add Plugin Scope"})).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Add Plugin Scope"}));

        await waitFor(() => {
            expect(screen.getByText("Argument policy (optional)")).toBeInTheDocument();
            expect(screen.getByText("Allowed subcommands")).toBeInTheDocument();
            expect(screen.getByText("Blocked subcommands")).toBeInTheDocument();
            expect(screen.getByText("Allowed leading options")).toBeInTheDocument();
            expect(screen.getByText("Path-restricted leading options")).toBeInTheDocument();
            expect(screen.getByText("Allowed subcommand overrides")).toBeInTheDocument();
            expect(screen.getByText("Allowed leading option overrides")).toBeInTheDocument();
        });
    });

    test("shows an explicit suggested scope setup callout when plugin-scope focus is requested", async () => {
        renderDialog(
            {},
            {
                requestId: "req-scope-1",
                pluginId: "plugin-a",
                focusSection: "pluginScopes",
                scopeIds: ["internal-runner"],
                suggestedScope: {
                    scopeId: "internal-runner",
                    commandPath: "/usr/local/bin/internal-runner",
                },
            }
        );

        await waitFor(() => {
            expect(screen.getByText("Suggested Scope Setup For Current Plugin Request")).toBeInTheDocument();
        });

        expect(screen.getAllByText(/internal-runner/).length).toBeGreaterThan(0);
        expect(screen.getAllByText("/usr/local/bin/internal-runner").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", {name: "Use Suggested Scope Draft"})).toBeInTheDocument();
        expect(screen.getByDisplayValue("internal-runner")).toBeInTheDocument();
    });

    test("keeps unresolved plugin scope suggestions visible on later manual opens", async () => {
        renderDialog(
            {},
            null,
            {
                pendingPluginScopeSuggestions: {
                    "plugin-a": {
                        scopeIds: ["internal-runner"],
                        suggestedScope: {
                            scopeId: "internal-runner",
                            commandPath: "/usr/local/bin/internal-runner",
                        },
                    },
                },
            }
        );

        await waitFor(() => {
            expect(screen.getByText("Suggested Scope Setup For Current Plugin Request")).toBeInTheDocument();
        });

        expect(screen.getAllByText(/internal-runner/).length).toBeGreaterThan(0);
        expect(screen.getByDisplayValue("internal-runner")).toBeInTheDocument();
        expect(screen.getAllByText("/usr/local/bin/internal-runner").length).toBeGreaterThan(0);
    });

    test("allows closing the suggested scope editor without immediate forced reopen", async () => {
        renderDialog(
            {},
            null,
            {
                pendingPluginScopeSuggestions: {
                    "plugin-a": {
                        scopeIds: ["internal-runner"],
                        suggestedScope: {
                            scopeId: "internal-runner",
                            commandPath: "/usr/local/bin/internal-runner",
                        },
                    },
                },
            }
        );

        await waitFor(() => {
            expect(screen.getByText("Create Plugin-Specific Scope")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Cancel"}));

        await waitFor(() => {
            expect(screen.queryByText("Create Plugin-Specific Scope")).not.toBeInTheDocument();
        });

        expect(screen.getByText("Suggested Scope Setup For Current Plugin Request")).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Use Suggested Scope Draft"})).toBeInTheDocument();
    });

    test("dismisses pending scope suggestions when the manage dialog is closed", async () => {
        const setShow = jest.fn();
        const onPendingPluginScopeSuggestionResolved = jest.fn();

        renderDialog(
            {},
            {
                requestId: "req-scope-close",
                pluginId: "plugin-a",
                focusSection: "pluginScopes",
                scopeIds: ["internal-runner"],
                suggestedScope: {
                    scopeId: "internal-runner",
                    commandPath: "/usr/local/bin/internal-runner",
                },
            },
            {
                setShow,
                pendingPluginScopeSuggestions: {
                    "plugin-a": {
                        scopeIds: ["internal-runner"],
                        suggestedScope: {
                            scopeId: "internal-runner",
                            commandPath: "/usr/local/bin/internal-runner",
                        },
                    },
                },
                onPendingPluginScopeSuggestionResolved,
            }
        );

        await waitFor(() => {
            expect(screen.getByText("Suggested Scope Setup For Current Plugin Request")).toBeInTheDocument();
        });

        fireEvent.click(screen.getAllByRole("button", {name: "Close"})[0]);

        expect(setShow).toHaveBeenCalledWith(false);
        expect(onPendingPluginScopeSuggestionResolved).toHaveBeenCalledWith("plugin-a");
    });

    test("surfaces stale granted process scopes that have no matching host policy", async () => {
        renderDialog({
            capabilities: ["system.process.exec", "system.process.scope.internal-runner"],
        });

        await waitFor(() => {
            expect(screen.getByText("Previously Granted Scope References Need A Real Host Policy")).toBeInTheDocument();
        });

        expect(screen.getAllByText("system.process.scope.internal-runner").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", {name: "Create Missing Scope Draft"})).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Remove Stale Scope Grants"})).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {name: "Create Missing Scope Draft"}));

        await waitFor(() => {
            expect(screen.getByDisplayValue("internal-runner")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Remove Stale Scope Grants"}));

        await waitFor(() => {
            expect(screen.getByRole("button", {name: "Save Capabilities"})).toBeInTheDocument();
            expect(screen.queryByText("Previously Granted Scope References Need A Real Host Policy")).not.toBeInTheDocument();
        });
    });

    test("surfaces declared scope capabilities that are unavailable on this host", async () => {
        window.electron.plugin.getRuntimeStatus.mockResolvedValueOnce({
            success: true,
            statuses: [
                {
                    id: "plugin-a",
                    capabilityIntent: {
                        available: true,
                        hasDeclaration: true,
                        declared: [
                            "system.hosts.write",
                            "system.fs.scope.etc-motd",
                            "system.process.scope.internal-runner",
                        ],
                        granted: ["system.hosts.write"],
                        missingDeclared: [
                            "system.fs.scope.etc-motd",
                            "system.process.scope.internal-runner",
                        ],
                        undeclaredGranted: [],
                    },
                    capabilityIntentSummary: {
                        title: "Declared capability gaps",
                        intent: "warning",
                    },
                },
            ],
        });

        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Declared Scopes Missing Host Policy Definitions")).toBeInTheDocument();
        });

        expect(screen.getAllByText("system.fs.scope.etc-motd").length).toBeGreaterThan(0);
        expect(screen.getAllByText("system.process.scope.internal-runner").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", {name: "Create Missing Process Scope Draft"})).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {name: "Create Missing Process Scope Draft"}));

        await waitFor(() => {
            expect(screen.getByDisplayValue("internal-runner")).toBeInTheDocument();
        });
    });

    test("surfaces stale granted filesystem scopes that have no matching host policy", async () => {
        renderDialog({
            capabilities: ["system.hosts.write", "system.fs.scope.etc-motd"],
        });

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Expand"}));

        await waitFor(() => {
            expect(screen.getByText("Granted Filesystem Scopes Missing Host Policy Definitions")).toBeInTheDocument();
        });

        expect(screen.getAllByText("system.fs.scope.etc-motd").length).toBeGreaterThan(0);
        expect(screen.getAllByRole("button", {name: "Remove Stale Filesystem Scope Grants"}).length).toBeGreaterThan(0);

        fireEvent.click(screen.getAllByRole("button", {name: "Remove Stale Filesystem Scope Grants"})[0]);

        await waitFor(() => {
            expect(screen.queryByText("Granted Filesystem Scopes Missing Host Policy Definitions")).not.toBeInTheDocument();
        });
    });

    test("creates and saves plugin-specific filesystem scopes", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Plugin-Specific Filesystem Scopes")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Add Filesystem Scope"}));

        await waitFor(() => {
            expect(screen.getByText("Create Plugin-Specific Filesystem Scope")).toBeInTheDocument();
        });

        fireEvent.change(screen.getByPlaceholderText("internal-runner"), {target: {value: "internal runner"}});
        fireEvent.change(
            screen.getByPlaceholderText("/Users/alexvwan/dev/fdo/workspace"),
            {target: {value: "/tmp/workspace"}}
        );
        fireEvent.keyDown(screen.getByPlaceholderText("/Users/alexvwan/dev/fdo/workspace"), {key: "Enter"});

        fireEvent.click(screen.getByRole("button", {name: "Save Scope"}));

        await waitFor(() => {
            expect(window.electron.plugin.upsertPluginCustomFilesystemScope).toHaveBeenCalledWith(
                "plugin-a",
                expect.objectContaining({
                    scope: "internal-runner",
                    allowedRoots: ["/tmp/workspace"],
                })
            );
        });
    });

    test("consumes plugin-scope focus requests and does not reopen the suggestion when the scope already exists", async () => {
        window.electron.plugin.getPluginCustomProcessScopes.mockResolvedValueOnce({
            success: true,
            scopes: [
                {
                    scope: "internal-runner",
                    title: "Internal Runner",
                    kind: "process",
                    category: "Plugin-Specific Scopes",
                    userDefined: true,
                    ownerType: "plugin",
                    ownerPluginId: "plugin-a",
                    description: "Host-managed custom scope for internal runner.",
                    allowedExecutables: ["/usr/local/bin/internal-runner"],
                    allowedCwdRoots: ["/tmp"],
                    allowedEnvKeys: ["PATH"],
                    timeoutCeilingMs: 45000,
                    requireConfirmation: true,
                },
            ],
        });
        const onFocusRequestConsumed = jest.fn();

        renderDialog(
            {},
            {
                requestId: "req-scope-existing",
                pluginId: "plugin-a",
                focusSection: "pluginScopes",
                scopeIds: ["internal-runner"],
                suggestedScope: {
                    scopeId: "internal-runner",
                    commandPath: "/usr/local/bin/internal-runner",
                },
            },
            {onFocusRequestConsumed}
        );

        await waitFor(() => {
            expect(onFocusRequestConsumed).toHaveBeenCalledWith("req-scope-existing");
        });

        expect(screen.queryByText("Suggested Scope Setup For Current Plugin Request")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Use Suggested Scope Draft"})).not.toBeInTheDocument();
    });

    test("deletes plugin-specific custom scope and refreshes list", async () => {
        window.electron.plugin.deletePluginCustomProcessScope.mockResolvedValueOnce({
            success: true,
            scopes: [],
        });

        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Process Monitoring")).toBeInTheDocument();
            expect(screen.getAllByRole("button", {name: "Delete"}).length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getAllByRole("button", {name: "Delete"})[0]);

        await waitFor(() => {
            expect(window.electron.plugin.deletePluginCustomProcessScope).toHaveBeenCalledWith("plugin-a", "process-monitoring");
            expect(screen.queryByText("Process Monitoring")).not.toBeInTheDocument();
            expect(screen.getByText(/No plugin-specific process scopes yet/i)).toBeInTheDocument();
        });
    });
});
