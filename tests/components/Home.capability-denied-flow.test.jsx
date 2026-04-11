import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HotkeysProvider} from "@blueprintjs/core";
import {Home} from "../../src/Home.jsx";

jest.mock("../../src/components/NavigationPluginsButton.jsx", () => ({
    NavigationPluginsButton: ({ capabilityFocusRequest }) => (
        <div data-testid="capability-focus-request">
            {JSON.stringify(capabilityFocusRequest || null)}
        </div>
    ),
}));

jest.mock("../../src/components/CommandBar.jsx", () => ({
    CommandBar: () => null,
}));

jest.mock("../../src/components/NotificationsPanel.jsx", () => ({
    NotificationsPanel: () => null,
}));

jest.mock("../../src/components/settings/SettingsDialog.jsx", () => ({
    SettingsDialog: () => null,
}));

jest.mock("../../src/components/ai-chat/AiChatDialog.jsx", () => ({
    AiChatDialog: () => null,
}));

jest.mock("../../src/components/PluginContainer.jsx", () => ({
    PluginContainer: ({ onCapabilityDenied, plugin }) => (
        <div>
            <div data-testid="plugin-container">{plugin}</div>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    missingCapabilities: ["system.hosts.write", "system.fs.scope.etc-hosts"],
                    details: 'Capabilities "system.hosts.write" and "system.fs.scope.etc-hosts" are required.',
                })}
            >
                trigger-capability-denied
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    missingCapabilities: ["system.hosts.write"],
                    details: 'Capability "system.hosts.write" is required.',
                })}
            >
                trigger-broad-capability-denied
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    missingCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
                    details: 'Capabilities "system.process.exec" and "system.process.scope.docker-cli" are required.',
                })}
            >
                trigger-process-capability-denied
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: "Missing required capabilities.",
                    code: "PLUGIN_BACKEND_HANDLER_FAILED",
                    correlationId: "corr-structured-capability",
                    extraDetails: {
                        missingCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
                    },
                })}
            >
                trigger-structured-capability-denied
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: 'Executable "/usr/local/bin/terraform" was not found on the host. Install it on the host or choose an allowlisted path for scope "terraform".',
                    code: "PROCESS_SPAWN_ENOENT",
                    correlationId: "corr-missing-cli",
                    extraDetails: {
                        command: "/usr/local/bin/terraform",
                        scope: "terraform",
                        allowlistedExecutables: ["/usr/local/bin/terraform", "/opt/homebrew/bin/terraform"],
                    },
                })}
            >
                trigger-missing-cli
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: 'Command "/bin/sh" is not allowed for process scope "terraform".',
                    code: "SCOPE_VIOLATION",
                    correlationId: "corr-policy",
                })}
            >
                trigger-policy-rejection
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: 'Unknown or unsupported process scope "internal-runner".',
                    code: "SCOPE_DENIED",
                    correlationId: "corr-scope-missing",
                    extraDetails: {
                        scope: "internal-runner",
                        command: "/usr/local/bin/internal-runner",
                        args: ["status"],
                        cwd: "/tmp/project",
                    },
                })}
            >
                trigger-scope-not-configured
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: "User cancelled scoped process execution.",
                    code: "CANCELLED",
                    correlationId: "corr-cancelled",
                })}
            >
                trigger-confirmation-rejection
            </button>
            <button
                type="button"
                onClick={() => onCapabilityDenied?.({
                    pluginId: plugin,
                    details: 'Workflow step "apply" exited with code 1.',
                    code: "STEP_FAILED",
                    correlationId: "corr-workflow",
                    extraDetails: {
                        workflowId: "wf-terraform-1",
                        kind: "process-sequence",
                        scope: "terraform",
                        title: "Terraform preview and apply",
                        status: "partial",
                        summary: {
                            totalSteps: 2,
                            completedSteps: 1,
                            failedSteps: 1,
                            skippedSteps: 0,
                        },
                        steps: [
                            {
                                stepId: "plan",
                                title: "Generate plan",
                                status: "ok",
                                correlationId: "corr-workflow:step:1:plan",
                                result: {
                                    command: "/usr/local/bin/terraform",
                                    args: ["plan", "-input=false"],
                                    cwd: "/tmp/project",
                                    exitCode: 0,
                                    stdout: "ok",
                                    stderr: "",
                                    durationMs: 120,
                                    dryRun: false,
                                },
                            },
                            {
                                stepId: "apply",
                                title: "Apply plan",
                                status: "error",
                                code: "EXIT_CODE",
                                error: 'Workflow step "apply" exited with code 1.',
                                correlationId: "corr-workflow:step:2:apply",
                                result: {
                                    command: "/usr/local/bin/terraform",
                                    args: ["apply", "-input=false", "tfplan"],
                                    cwd: "/tmp/project",
                                    exitCode: 1,
                                    stdout: "",
                                    stderr: "apply failed",
                                    durationMs: 340,
                                    dryRun: false,
                                },
                            },
                        ],
                    },
                })}
            >
                trigger-workflow-failure
            </button>
        </div>
    ),
}));

jest.mock("../../src/components/SideBar.jsx", () => ({
    SideBar: ({ position, menuItems = [], click }) => (
        <div data-testid={`sidebar-${position}`}>
            {menuItems.map((item) => (
                <button key={item.id} onClick={() => click(item.id)}>
                    {item.name || item.id}
                </button>
            ))}
        </div>
    ),
}));

describe("Home capability denied flow", () => {
    function renderHome() {
        return render(
            <HotkeysProvider>
                <Home />
            </HotkeysProvider>
        );
    }

    beforeEach(() => {
        localStorage.clear();
        window.electron.notifications = {
            get: jest.fn().mockResolvedValue([]),
            on: {updated: jest.fn()},
            off: {updated: jest.fn()},
        };

        window.electron.plugin = {
            getAll: jest.fn().mockResolvedValue({
                plugins: [{
                    id: "plugin-1",
                    name: "Plugin One",
                    metadata: {
                        name: "Plugin One",
                        author: "Author",
                        version: "1.0.0",
                        description: "Desc",
                        icon: "cog",
                    },
                }],
            }),
            getActivated: jest.fn().mockResolvedValue({plugins: ["plugin-1"]}),
            getRuntimeStatus: jest.fn().mockResolvedValue({
                success: true,
                statuses: [{
                    id: "plugin-1",
                    loading: false,
                    loaded: true,
                    ready: true,
                    inited: true,
                    privilegedAuditCount: 2,
                    lastPrivilegedAudit: {
                        timestamp: "2026-04-06T10:05:00.000Z",
                        action: "system.workflow.run",
                        success: false,
                        correlationId: "corr-workflow",
                    },
                }],
            }),
            getPrivilegedAudit: jest.fn().mockResolvedValue({
                success: true,
                pluginId: "plugin-1",
                events: [
                    {
                        timestamp: "2026-04-06T10:04:00.000Z",
                        action: "system.process.exec",
                        scope: "terraform",
                        success: true,
                        correlationId: "corr-plan",
                        command: "/usr/local/bin/terraform",
                        args: ["plan", "-input=false"],
                        cwd: "/tmp/project",
                    },
                    {
                        timestamp: "2026-04-06T10:05:00.000Z",
                        action: "system.workflow.run",
                        scope: "terraform",
                        workflowId: "wf-terraform-1",
                        workflowTitle: "Terraform preview and apply",
                        workflowKind: "process-sequence",
                        workflowStatus: "failed",
                        success: false,
                        confirmationDecision: "approved",
                        correlationId: "corr-workflow",
                        stepId: "apply",
                        stepTitle: "Apply plan",
                        stepStatus: "error",
                        stepCorrelationId: "corr-workflow:step:2:apply",
                        command: "/usr/local/bin/terraform",
                        args: ["apply", "-input=false", "tfplan"],
                        cwd: "/tmp/project",
                        error: {
                            code: "STEP_FAILED",
                            message: 'Workflow step "apply" exited with code 1.',
                        },
                    },
                ],
            }),
            activate: jest.fn().mockResolvedValue({success: true}),
            deactivate: jest.fn().mockResolvedValue({success: true}),
            deactivateUsers: jest.fn().mockResolvedValue({success: true}),
            init: jest.fn().mockResolvedValue({success: true}),
            setCapabilities: jest.fn().mockResolvedValue({success: true}),
            get: jest.fn().mockResolvedValue({
                success: true,
                plugin: {
                    id: "plugin-1",
                    name: "Plugin One",
                    metadata: {
                        name: "Plugin One",
                        author: "Author",
                        version: "1.0.0",
                        description: "Desc",
                        icon: "cog",
                    },
                },
            }),
            on: {
                ready: jest.fn(),
                init: jest.fn(),
                unloaded: jest.fn(),
                deployFromEditor: jest.fn(),
                uiMessage: jest.fn(),
            },
            off: {
                ready: jest.fn(),
                init: jest.fn(),
                unloaded: jest.fn(),
                deployFromEditor: jest.fn(),
                uiMessage: jest.fn(),
            },
        };
    });

    test("opens capability settings request with missing capability IDs from denied flow", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-capability-denied"}));

        await waitFor(() => {
            expect(screen.getByText("Permission Required")).toBeInTheDocument();
            expect(screen.getByText("system.host.write")).toBeInTheDocument();
            expect(screen.getByText("system.fs.scope.etc-hosts")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Open Capabilities"}));

        await waitFor(() => {
            const requestText = screen.getByTestId("capability-focus-request").textContent || "";
            expect(requestText).toContain("\"pluginId\":\"plugin-1\"");
            expect(requestText).toContain("system.host.write");
            expect(requestText).toContain("system.fs.scope.etc-hosts");
        });
    });

    test("shows friendly process capability remediation for operator-style plugin denials", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-process-capability-denied"}));

        await waitFor(() => {
            expect(screen.getByText("Permission Required")).toBeInTheDocument();
            expect(screen.getByText("Allow Scoped Tool Execution")).toBeInTheDocument();
            expect(screen.getByText("Docker CLI Scope")).toBeInTheDocument();
            expect(screen.getByText(/not unrestricted shell access/i)).toBeInTheDocument();
            expect(screen.getByText(/Fix: Grant broad capability "system\.process\.exec" in Manage Plugins -> Capabilities, then add the required narrow scope\./i)).toBeInTheDocument();
            expect(screen.getAllByText("system.process.exec").length).toBeGreaterThan(0);
            expect(screen.getAllByText("system.process.scope.docker-cli").length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByRole("button", {name: "More Actions"}));

        await waitFor(() => {
            expect(screen.queryByText("Grant Missing Capabilities")).not.toBeInTheDocument();
            expect(screen.queryByText("Open Plugin Scopes")).not.toBeInTheDocument();
        });

        expect(screen.getByRole("button", {name: "Fix Process Access"})).toBeInTheDocument();
    });

    test("shows capability remediation when missing capabilities arrive via structured details", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-structured-capability-denied"}));

        await waitFor(() => {
            expect(screen.getByText("Permission Required")).toBeInTheDocument();
            expect(screen.getByRole("button", {name: "Fix Process Access"})).toBeInTheDocument();
            expect(screen.getAllByText("system.process.exec").length).toBeGreaterThan(0);
            expect(screen.getAllByText("system.process.scope.docker-cli").length).toBeGreaterThan(0);
        });
    });

    test("keeps one-click grant available only for non-scope capability sets", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-broad-capability-denied"}));

        await waitFor(() => {
            expect(screen.getByText("Permission Required")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "More Actions"}));

        await waitFor(() => {
            expect(screen.getByText("Grant Missing Capabilities")).toBeInTheDocument();
        });
    });

    test("hides one-click grant when missing set includes filesystem scopes", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-capability-denied"}));

        await waitFor(() => {
            expect(screen.getByText("Permission Required")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "More Actions"}));

        await waitFor(() => {
            expect(screen.queryByText("Grant Missing Capabilities")).not.toBeInTheDocument();
        });
    });

    test("shows a dedicated missing-cli dialog with install-oriented remediation", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-missing-cli"}));

        await waitFor(() => {
            expect(screen.getByText("Tool Not Installed")).toBeInTheDocument();
            expect(screen.getByText(/host could not find the requested executable/i)).toBeInTheDocument();
            expect(screen.getByText(/Requested executable: "\/usr\/local\/bin\/terraform"/i)).toBeInTheDocument();
            expect(screen.queryByRole("button", {name: "Open Capabilities"})).not.toBeInTheDocument();
            expect(screen.getByText("corr-missing-cli")).toBeInTheDocument();
        });
    });

    test("shows a policy-specific dialog for scope violations", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-policy-rejection"}));

        await waitFor(() => {
            expect(screen.getByText("Blocked By Scope Policy")).toBeInTheDocument();
            expect(screen.getByText(/outside the selected host scope policy/i)).toBeInTheDocument();
            expect(screen.queryByRole("button", {name: "Open Capabilities"})).not.toBeInTheDocument();
        });
    });

    test("surfaces plugin-specific scope setup guidance for unknown host-defined scopes", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-scope-not-configured"}));

        await waitFor(() => {
            expect(screen.getByText("Process Scope Not Configured")).toBeInTheDocument();
            expect(screen.getByText("Required Plugin-Specific Process Scope Setup")).toBeInTheDocument();
            expect(screen.getAllByText("internal-runner").length).toBeGreaterThan(0);
            expect(screen.getAllByText("/usr/local/bin/internal-runner").length).toBeGreaterThan(0);
            expect(screen.getByRole("button", {name: "Fix Process Access"})).toBeInTheDocument();
            const missingScopesLine = screen.getByText(/Missing scopes:/);
            expect(missingScopesLine).toHaveTextContent("Missing scopes: internal-runner");
            expect(missingScopesLine).not.toHaveTextContent("internal-runner, internal-runner");
        });

        fireEvent.click(screen.getByRole("button", {name: "Fix Process Access"}));

        await waitFor(() => {
            const requestText = screen.getByTestId("capability-focus-request").textContent || "";
            expect(requestText).toContain("\"pluginId\":\"plugin-1\"");
            expect(requestText).toContain("\"focusSection\":\"pluginScopes\"");
            expect(requestText).toContain("\"scopeIds\":[\"internal-runner\"]");
            expect(requestText).toContain("\"commandPath\":\"/usr/local/bin/internal-runner\"");
        });
    });

    test("shows an approval-specific dialog for confirmation rejection", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-confirmation-rejection"}));

        await waitFor(() => {
            expect(screen.getByText("Approval Rejected")).toBeInTheDocument();
            expect(screen.getByText(/confirmation step was declined/i)).toBeInTheDocument();
            expect(screen.queryByRole("button", {name: "Open Capabilities"})).not.toBeInTheDocument();
        });
    });

    test("shows structured workflow troubleshooting details for step failures", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-workflow-failure"}));

        await waitFor(() => {
            expect(screen.getByText("Host Execution Failed")).toBeInTheDocument();
            expect(screen.getByText("wf-terraform-1")).toBeInTheDocument();
            expect(screen.getByText(/Terraform preview and apply/)).toBeInTheDocument();
            expect(screen.getByText(/1 completed, 1 failed, 0 skipped, 2 total/i)).toBeInTheDocument();
            expect(screen.getByText(/Apply plan/)).toBeInTheDocument();
            expect(screen.getByText(/corr-workflow:step:2:apply/)).toBeInTheDocument();
            expect(screen.getAllByText(/Exit code:/)).toHaveLength(2);
        });
    });

    test("opens privileged audit trail from a failure dialog", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-missing-cli"}));

        await waitFor(() => {
            expect(screen.getByText("Tool Not Installed")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "More Actions"}));
        fireEvent.click(screen.getByText("Open Audit Trail"));

        await waitFor(() => {
            expect(window.electron.plugin.getPrivilegedAudit).toHaveBeenCalledWith("plugin-1", {limit: 40});
            expect(screen.getByText(/Privileged Audit Trail: plugin-1/)).toBeInTheDocument();
        });
    });

    test("opens runtime validation from a failure dialog", async () => {
        renderHome();

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(screen.getByRole("button", {name: "trigger-missing-cli"}));

        await waitFor(() => {
            expect(screen.getByText("Tool Not Installed")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "More Actions"}));
        fireEvent.click(screen.getByText("Open Validation"));

        await waitFor(() => {
            expect(window.electron.plugin.getPrivilegedAudit).toHaveBeenCalledWith("plugin-1", {limit: 80});
            expect(screen.getByText(/Runtime Validation: plugin-1/)).toBeInTheDocument();
        });
    });
});
