import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
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
                ],
            }),
            verifySignature: jest.fn().mockResolvedValue({
                success: true,
                signed: true,
                commonName: {value: "Plugin A"},
                signer: {label: "Test Root CA"},
            }),
            setCapabilities: jest.fn().mockResolvedValue({success: true, capabilities: []}),
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
        return render(
            <ManagePluginsDialog
                show={true}
                setShow={jest.fn()}
                plugins={[{...basePlugin, ...pluginOverride}]}
                activePlugins={[{...basePlugin, ...pluginOverride}]}
                deselectPlugin={jest.fn()}
                selectPlugin={jest.fn()}
                removePlugin={jest.fn()}
                setSearchActions={jest.fn()}
                refreshPluginsState={jest.fn()}
                focusRequest={focusRequest}
            />
        );
    }

    test("shows friendly labels with technical IDs", async () => {
        renderDialog();

        await waitFor(() => {
            expect(screen.getByText("Capabilities & Privileged Access")).toBeInTheDocument();
        });

        expect(screen.getByText("Privileged host actions")).toBeInTheDocument();
        expect(screen.getByText("Allow Scoped Tool Execution")).toBeInTheDocument();
        expect(screen.getAllByText(/Technical ID:/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("system.hosts.write").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Filesystem Scope: etc-hosts")).toBeInTheDocument();
        expect(screen.getByText("system.fs.scope.etc-hosts")).toBeInTheDocument();
        expect(screen.getByText("Docker CLI Scope")).toBeInTheDocument();
        expect(screen.getByText("system.process.scope.docker-cli")).toBeInTheDocument();
    });

    test("shows dependency hint when scope exists without base capability", async () => {
        renderDialog({
            capabilities: ["system.fs.scope.etc-hosts"],
        });

        await waitFor(() => {
            expect(screen.getByText("Enable required base permission")).toBeInTheDocument();
        });

        expect(screen.getByText("Scoped capabilities are present, but base privileged access is disabled."))
            .toBeInTheDocument();
    });

    test("shows warning when process base capability is enabled without any process scopes", async () => {
        renderDialog({
            capabilities: ["system.process.exec"],
        });

        await waitFor(() => {
            expect(screen.getByText("Base tool execution is enabled, but no process scopes are granted yet. Both are required for process execution requests.")).toBeInTheDocument();
        });
    });

    test("highlights missing capability ids from focus request", async () => {
        renderDialog(
            { capabilities: [] },
            {
                requestId: "req-1",
                pluginId: "plugin-a",
                capabilityIds: ["system.fs.scope.etc-hosts"],
            }
        );

        await waitFor(() => {
            const markers = screen.getAllByText("Required to resolve last permission error");
            expect(markers.length).toBeGreaterThan(0);
        });
    });
});
