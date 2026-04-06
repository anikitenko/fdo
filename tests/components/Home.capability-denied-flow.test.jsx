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
                    missingCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
                    details: 'Capabilities "system.process.exec" and "system.process.scope.docker-cli" are required.',
                })}
            >
                trigger-process-capability-denied
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
                }],
            }),
            activate: jest.fn().mockResolvedValue({success: true}),
            deactivate: jest.fn().mockResolvedValue({success: true}),
            deactivateUsers: jest.fn().mockResolvedValue({success: true}),
            init: jest.fn().mockResolvedValue({success: true}),
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
            expect(screen.getByText("system.hosts.write")).toBeInTheDocument();
            expect(screen.getByText("system.fs.scope.etc-hosts")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", {name: "Open Capabilities"}));

        await waitFor(() => {
            const requestText = screen.getByTestId("capability-focus-request").textContent || "";
            expect(requestText).toContain("\"pluginId\":\"plugin-1\"");
            expect(requestText).toContain("system.hosts.write");
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
            expect(screen.getByText(/Fix: Grant "system\.process\.exec" in Manage Plugins -> Capabilities, then add the required process scope\./i)).toBeInTheDocument();
            expect(screen.getByText("system.process.exec")).toBeInTheDocument();
            expect(screen.getByText("system.process.scope.docker-cli")).toBeInTheDocument();
        });
    });
});
