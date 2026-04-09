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
            upsertPluginCustomProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deletePluginCustomProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            getSharedProcessScopes: jest.fn().mockResolvedValue({success: true, scopes: []}),
            upsertSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            deleteSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
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

    function renderDialog(pluginOverride = {}, focusRequest = null) {
        const selectPlugin = jest.fn();
        const refreshPluginsState = jest.fn().mockResolvedValue();
        return render(
            <ManagePluginsDialog
                show={true}
                setShow={jest.fn()}
                plugins={[{...basePlugin, ...pluginOverride}]}
                activePlugins={[{...basePlugin, ...pluginOverride}]}
                deselectPlugin={jest.fn()}
                selectPlugin={selectPlugin}
                removePlugin={jest.fn()}
                setSearchActions={jest.fn()}
                refreshPluginsState={refreshPluginsState}
                focusRequest={focusRequest}
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
        expect(screen.getByText(/Trust tier: Basic|Trust tier: Operator|Trust tier: Admin/)).toBeInTheDocument();
        expect(screen.getAllByText(/Technical ID:/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("system.hosts.write").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
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
            expect(window.electron.plugin.setCapabilities).not.toHaveBeenCalled();
            expect(screen.getByRole("button", {name: "Add Plugin Scope"})).toBeInTheDocument();
            expect(screen.queryByRole("button", {name: "Save Scope"})).not.toBeInTheDocument();
        });
    });

    test("deletes plugin-specific custom scope and refreshes list", async () => {
        window.electron.plugin.deletePluginCustomProcessScope.mockResolvedValueOnce({
            success: true,
            scopes: [],
        });

        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Process Monitoring")).toBeInTheDocument();
            expect(screen.getByRole("button", {name: "Delete"})).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Delete"}));

        await waitFor(() => {
            expect(window.electron.plugin.deletePluginCustomProcessScope).toHaveBeenCalledWith("plugin-a", "process-monitoring");
            expect(screen.queryByText("Process Monitoring")).not.toBeInTheDocument();
            expect(screen.getByText(/No plugin-specific process scopes yet/i)).toBeInTheDocument();
        });
    });
});
