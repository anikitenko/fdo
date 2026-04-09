import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {Home} from "../../src/Home.jsx";

const pluginContainerMounts = [];

jest.mock("../../src/components/NavigationPluginsButton.jsx", () => ({
    NavigationPluginsButton: () => <div data-testid="nav-plugins-button" />,
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

jest.mock("../../src/components/plugin/PluginPage.jsx", () => ({
    PluginPage: () => null,
}));

jest.mock("../../src/components/PluginContainer.jsx", () => ({
    PluginContainer: ({ plugin, onStageChange }) => {
        require("react").useEffect(() => {
            pluginContainerMounts.push(plugin);
            onStageChange?.("mock-mounted");
        }, [plugin, onStageChange]);
        return <div data-testid="plugin-container">{plugin}</div>;
    },
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

describe("Home plugin runtime backfill", () => {
    beforeEach(() => {
        pluginContainerMounts.length = 0;
        window.electron.notifications = {
            get: jest.fn().mockResolvedValue([]),
            on: {
                updated: jest.fn(),
            },
            off: {
                updated: jest.fn(),
            },
        };

        window.electron.plugin = {
            getAll: jest.fn().mockResolvedValue({
                plugins: [
                    {
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
                ],
            }),
            getActivated: jest.fn().mockResolvedValue({
                plugins: ["plugin-1"],
            }),
            getRuntimeStatus: jest.fn().mockResolvedValue({
                success: true,
                statuses: [
                    {
                        id: "plugin-1",
                        loading: false,
                        loaded: true,
                        ready: true,
                        inited: true,
                    },
                ],
            }),
            activate: jest.fn().mockResolvedValue({ success: true }),
            deactivate: jest.fn().mockResolvedValue({ success: true }),
            deactivateUsers: jest.fn().mockResolvedValue({ success: true }),
            init: jest.fn().mockResolvedValue({ success: true }),
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
            },
            off: {
                ready: jest.fn(),
                init: jest.fn(),
                unloaded: jest.fn(),
                deployFromEditor: jest.fn(),
            },
        };
    });

    test("mounts the plugin container from runtime status even when ready/init events were missed", async () => {
        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus).toHaveBeenCalled();
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
            expect(screen.queryByText(/Stage: mock-mounted/)).toBeNull();
        });
    });

    test("does not reactivate already activated plugins during initial load", async () => {
        render(<Home />);

        await screen.findByRole("button", { name: "Plugin One" });

        expect(window.electron.plugin.activate).not.toHaveBeenCalled();
    });

    test("polls runtime status for a selected plugin until init completes", async () => {
        window.electron.plugin.getRuntimeStatus
            .mockResolvedValueOnce({
                success: true,
                statuses: [
                    {
                        id: "plugin-1",
                        loading: true,
                        loaded: true,
                        ready: true,
                        inited: false,
                    },
                ],
            })
            .mockResolvedValue({
                success: true,
                statuses: [
                    {
                        id: "plugin-1",
                        loading: false,
                        loaded: true,
                        ready: true,
                        inited: true,
                    },
                ],
            });

        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });
    });

    test("keeps polling runtime status while plugin is marked loading, even if already inited", async () => {
        window.electron.plugin.getRuntimeStatus
            .mockResolvedValueOnce({
                success: true,
                statuses: [
                    {
                        id: "plugin-1",
                        loading: true,
                        loaded: true,
                        ready: true,
                        inited: true,
                    },
                ],
            })
            .mockResolvedValue({
                success: true,
                statuses: [
                    {
                        id: "plugin-1",
                        loading: false,
                        loaded: true,
                        ready: true,
                        inited: true,
                    },
                ],
            });

        render(<Home />);

        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    test("ignores stale unload events while runtime status still reports the plugin as active", async () => {
        let unloadedHandler = null;
        window.electron.plugin.on.unloaded.mockImplementation((handler) => {
            unloadedHandler = handler;
        });

        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        unloadedHandler?.({
            id: "plugin-1",
            reason: "process_exit",
            message: "Exit code 1",
            code: 1,
        });

        await waitFor(() => {
            expect(screen.queryByText("Plugin Closed")).toBeNull();
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });
    });

    test("remounts the selected plugin container when deploy-from-editor updates the same plugin", async () => {
        let deployFromEditorHandler = null;
        window.electron.plugin.on.deployFromEditor.mockImplementation((handler) => {
            deployFromEditorHandler = handler;
        });

        render(<Home />);

        const pluginButton = await screen.findByRole("button", {name: "Plugin One"});
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        const mountCountBeforeDeploy = pluginContainerMounts.length;
        deployFromEditorHandler?.("plugin-1");

        await waitFor(() => {
            expect(pluginContainerMounts.length).toBeGreaterThan(mountCountBeforeDeploy);
        });
    });

    test("ignores unexpected manual unload events and keeps plugin UI visible", async () => {
        let unloadedHandler = null;
        window.electron.plugin.on.unloaded.mockImplementation((handler) => {
            unloadedHandler = handler;
        });

        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        unloadedHandler?.({
            id: "plugin-1",
            reason: "manual_unload",
            message: "",
        });

        await waitFor(() => {
            expect(window.electron.plugin.deactivateUsers).not.toHaveBeenCalled();
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });
    });

    test("ignores unexpected manual unload while activation is pending even if runtime status is inactive", async () => {
        let unloadedHandler = null;
        window.electron.plugin.on.unloaded.mockImplementation((handler) => {
            unloadedHandler = handler;
        });

        window.electron.plugin.getRuntimeStatus
            .mockResolvedValue({
                success: true,
                statuses: [{ id: "plugin-1", loading: false, loaded: false, ready: false, inited: false }],
            });

        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        unloadedHandler?.({
            id: "plugin-1",
            reason: "manual_unload",
            message: "",
        });

        await waitFor(() => {
            expect(window.electron.plugin.deactivateUsers).not.toHaveBeenCalled();
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });
    });

    test("applies unexpected manual unload when runtime is inactive", async () => {
        let fakeNow = 1_710_000_000_000;
        const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => fakeNow);
        let unloadedHandler = null;
        window.electron.plugin.on.unloaded.mockImplementation((handler) => {
            unloadedHandler = handler;
        });

        window.electron.plugin.getRuntimeStatus
            .mockResolvedValueOnce({
                success: true,
                statuses: [{ id: "plugin-1", loading: false, loaded: false, ready: false, inited: false }],
            })
            .mockResolvedValueOnce({
                success: true,
                statuses: [{ id: "plugin-1", loading: false, loaded: false, ready: false, inited: false }],
            })
            .mockResolvedValueOnce({
                success: true,
                statuses: [{ id: "plugin-1", loading: false, loaded: false, ready: false, inited: false }],
            })
            .mockResolvedValue({
                success: true,
                statuses: [{ id: "plugin-1", loading: false, loaded: false, ready: false, inited: false }],
            });

        render(<Home />);
        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fakeNow += 7000;
        unloadedHandler?.({ id: "plugin-1", reason: "manual_unload", message: "" });

        await waitFor(() => {
            expect(window.electron.plugin.deactivateUsers).toHaveBeenCalledWith("plugin-1");
            expect(screen.queryByTestId("plugin-container")).toBeNull();
        });
        nowSpy.mockRestore();
    });

    test("keeps the selected plugin container mounted despite active plugin list churn until unload is reported", async () => {
        window.electron.plugin.deactivate.mockResolvedValue({ success: true });
        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(pluginButton);

        expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
    });

    test("does not clear the selected plugin view before reopening the same plugin", async () => {
        render(<Home />);

        const pluginButton = await screen.findByRole("button", { name: "Plugin One" });
        fireEvent.click(pluginButton);

        await waitFor(() => {
            expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
        });

        fireEvent.click(pluginButton);

        expect(screen.getByTestId("plugin-container")).toHaveTextContent("plugin-1");
    });
});
