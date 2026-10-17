import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {Home} from "../../src/Home.jsx";

const pluginContainerMounts = [];

jest.mock("../../src/components/NavigationPluginsButton.jsx", () => ({
    NavigationPluginsButton: () => <div data-testid="nav-plugins-button" />,
}));

jest.mock("../../src/components/CommandBar.jsx", () => ({
    CommandBar: ({actions = []}) => <div>{actions.filter(action => action.source === 'plugin-init').map(action =>
        <button key={action.id} onClick={action.perform}>{action.name}</button>)}</div>,
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
    PluginContainer: ({ plugin, onStageChange, active }) => {
        require("react").useEffect(() => {
            pluginContainerMounts.push(plugin);
            onStageChange?.("mock-mounted");
        }, [plugin, onStageChange]);
        return <div data-testid="plugin-container" data-active={active}>{plugin}</div>;
    },
}));

jest.mock("../../src/components/SideBar.jsx", () => ({
    SideBar: ({ position, menuItems = [], click }) => (
        <div data-testid={`sidebar-${position}`}>
            {menuItems.map((item) => (
                <button key={item.id} onClick={() => click(item.id, item.submenu_list?.[0]?.id)}>
                    {item.name || item.id}
                </button>
            ))}
        </div>
    ),
}));

describe("Home plugin runtime backfill", () => {
    test.each(['plugin-1', 'plugin-2'])('announces a GitOps update to %s once without switching the current plugin', async updatedId => {
        const plugins = ['plugin-1', 'plugin-2'].map((id, index) => ({id, home: `/old/${id}`,
            metadata: {name: `Plugin ${index + 1}`, version: '1.0.0', icon: 'cog'},
            gitops: {commit: 'a'.repeat(40)},
        }));
        window.electron.plugin.getAll.mockResolvedValue({plugins});
        window.electron.plugin.getActivated.mockResolvedValue({plugins: ['plugin-1', 'plugin-2']});
        window.electron.settings.gitops = {onUpdated: jest.fn(() => jest.fn())};
        const {AppToaster} = require('../../src/components/AppToaster.jsx');
        const toaster = await AppToaster;
        render(<Home/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Plugin 1'}));
        const selectedContainer = () => screen.getAllByTestId('plugin-container').find(node => node.dataset.active === 'true');
        await waitFor(() => expect(selectedContainer()).toHaveTextContent('plugin-1'));
        toaster.show.mockClear();
        const notify = window.electron.settings.gitops.onUpdated.mock.calls[0][0];
        // An ordinary check is silent.
        await act(async () => notify());
        expect(toaster.show).not.toHaveBeenCalled();
        window.electron.plugin.getAll.mockResolvedValue({plugins: plugins.map(plugin => plugin.id === updatedId
            ? {...plugin, home: `/new/${plugin.id}`, gitops: {commit: 'b'.repeat(40)}} : plugin)});
        // Multiple status events for the same version must not create duplicate notices.
        await act(async () => {notify(); notify(); notify();});
        expect(toaster.show).not.toHaveBeenCalled();
        await act(async () => window.electron.notifications.onAlert.mock.calls[0][0]({id: 'notice', source: 'gitops', type: 'success',
            title: `Plugin ${updatedId === 'plugin-1' ? 1 : 2} updated via GitOps`, message: 'Installed 1.0.0 (bbbbbbb). The plugin was reloaded.'}));
        await waitFor(() => expect(toaster.show).toHaveBeenCalledTimes(1));
        expect(toaster.show).toHaveBeenCalledWith(expect.objectContaining({intent: 'success', timeout: 10000,
            message: `Plugin ${updatedId === 'plugin-1' ? 1 : 2} updated via GitOps. Installed 1.0.0 (bbbbbbb). The plugin was reloaded.`,
        }), 'notification:notice');
        expect(selectedContainer()).toHaveTextContent('plugin-1');
        fireEvent.click(screen.getByRole('button', {name: 'Open notifications (0 unread)'}));
        await waitFor(() => expect(toaster.dismiss).toHaveBeenCalledWith('notification:notice'));
        await act(async () => window.electron.notifications.onAlert.mock.calls[0][0]({id: 'next', title: 'Another update', type: 'success'}));
        expect(toaster.show).toHaveBeenCalledTimes(1);
    });

    test('restores actions after active plugin reconciliation without another init event', async () => {
        const original = window.electron.plugin.getRuntimeStatus.getMockImplementation();
        window.electron.plugin.getRuntimeStatus.mockImplementation(async (...args) => {
            const result = await original(...args);
            return {...result, statuses: result.statuses.map(status => ({...status, uiExtensions: {
                quickActions: [{name: 'Restored action', message_type: 'restore'}], sidePanelActions: null,
            }}))};
        });
        render(<Home/>);
        expect(await screen.findByText('Restored action')).toBeVisible();
        await waitFor(() => expect(screen.getByTestId('plugin-container')).toBeInTheDocument());
        expect(screen.getByText('Restored action')).toBeVisible();
    });
    test('registered quick and sidebar actions reach the plugin backend', async () => {
        window.electron.plugin.uiMessage = jest.fn(async () => ({ok: true}));
        window.electron.plugin.render = jest.fn(async () => ({success: true}));
        localStorage.setItem('showRightSideBar', 'true');
        render(<Home/>);
        await waitFor(() => expect(window.electron.plugin.on.init).toHaveBeenCalled());
        const onInit = window.electron.plugin.on.init.mock.calls[0][0];
        act(() => onInit({id: 'plugin-1', quickActions: [{name: 'Copy quick', message_type: 'copyQuick'}],
            sidePanelActions: {icon: 'cog', label: 'Clipboard tools', submenu_list: [{id: 'copy-side', name: 'Copy', message_type: 'copySide'}]}}));
        fireEvent.click(await screen.findByText('Copy quick'));
        await waitFor(() => expect(window.electron.plugin.uiMessage).toHaveBeenCalledWith('plugin-1',
            {handler: 'copyQuick', content: {source: 'quick-bar', actionId: 'Copy quick'}}));
        fireEvent.click(screen.getByText('Clipboard tools'));
        await waitFor(() => expect(window.electron.plugin.uiMessage).toHaveBeenCalledWith('plugin-1',
            {handler: 'copySide', content: {source: 'sidebar', actionId: 'copy-side'}}));
        expect(window.electron.plugin.render).toHaveBeenCalledWith('plugin-1');
        localStorage.removeItem('showRightSideBar');
    });
    test('serializes actions per plugin, reports failure, and allows another attempt', async () => {
        let resolveAction;
        window.electron.plugin.uiMessage = jest.fn(() => new Promise(resolve => { resolveAction = resolve; }));
        window.electron.plugin.render = jest.fn(async () => ({success: true}));
        localStorage.setItem('showRightSideBar', 'true');
        render(<Home/>);
        await waitFor(() => expect(window.electron.plugin.on.init).toHaveBeenCalled());
        act(() => window.electron.plugin.on.init.mock.calls[0][0]({id: 'plugin-1',
            quickActions: [{name: 'Run action', message_type: 'run'}],
            sidePanelActions: {label: 'Run menu', submenu_list: [{id: 'other', name: 'Other', message_type: 'other'}]}}));
        fireEvent.click(await screen.findByText('Run action'));
        fireEvent.click(screen.getByText('Run menu'));
        expect(window.electron.plugin.uiMessage).toHaveBeenCalledTimes(1);
        await act(async () => resolveAction({ok: true, result: {success: false, error: 'Try again'}}));
        const {AppToaster} = require('../../src/components/AppToaster.jsx');
        expect((await AppToaster).show).toHaveBeenCalledWith(expect.objectContaining({intent: 'danger', message: expect.stringContaining('Try again')}));
        expect(window.electron.plugin.render).not.toHaveBeenCalled();
        window.electron.plugin.uiMessage.mockResolvedValue({ok: true});
        fireEvent.click(screen.getByText('Run action'));
        await waitFor(() => expect(window.electron.plugin.render).toHaveBeenCalledWith('plugin-1'));
        localStorage.removeItem('showRightSideBar');
    });
    test('stale unload keeps registered quickbar and sidebar actions', async () => {
        localStorage.setItem('showRightSideBar', 'true');
        render(<Home/>);
        await waitFor(() => expect(window.electron.plugin.on.init).toHaveBeenCalled());
        act(() => window.electron.plugin.on.init.mock.calls[0][0]({id: 'plugin-1', quickActions: [{name: 'Keep action', message_type: 'keep'}],
            sidePanelActions: {label: 'Keep menu', submenu_list: []}}));
        await act(async () => window.electron.plugin.on.unloaded.mock.calls[0][0]({id: 'plugin-1', reason: 'process_exit'}));
        expect(screen.getByText('Keep action')).toBeVisible();
        expect(screen.getByText('Keep menu')).toBeVisible();
        localStorage.removeItem('showRightSideBar');
    });
    test('removes custom shortcuts for an inactive runtime even during the activation grace period', async () => {
        localStorage.setItem('showRightSideBar', 'true');
        render(<Home/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Plugin One'}));
        await waitFor(() => expect(window.electron.plugin.on.init).toHaveBeenCalled());
        act(() => window.electron.plugin.on.init.mock.calls[0][0]({id: 'plugin-1', quickActions: [{name: 'Temporary action', message_type: 'run'}],
            sidePanelActions: {label: 'Temporary menu', submenu_list: []}}));
        expect(await screen.findByText('Temporary action')).toBeVisible();
        window.electron.plugin.getRuntimeStatus.mockResolvedValue({success: true, statuses: [{id: 'plugin-1', loaded: false, ready: false, inited: false, loading: false}]});
        await act(async () => window.electron.plugin.on.unloaded.mock.calls[0][0]({id: 'plugin-1', reason: 'manual_unload'}));
        expect(screen.queryByText('Temporary action')).not.toBeInTheDocument();
        expect(screen.queryByText('Temporary menu')).not.toBeInTheDocument();
        localStorage.removeItem('showRightSideBar');
    });
    beforeEach(() => {
        pluginContainerMounts.length = 0;
        window.electron.notifications = {
            onAlert: jest.fn(() => jest.fn()),
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

    test('a restarted worker is initialized even when the retained plugin UI was already ready', async () => {
        render(<Home/>);
        await waitFor(() => expect(window.electron.plugin.on.ready).toHaveBeenCalled());
        const ready = window.electron.plugin.on.ready.mock.calls.at(-1)[0];
        act(() => ready('plugin-1'));
        await waitFor(() => expect(window.electron.plugin.init).toHaveBeenCalledWith('plugin-1'));
        const previousCalls = window.electron.plugin.init.mock.calls.length;
        act(() => ready('plugin-1'));
        await waitFor(() => expect(window.electron.plugin.init.mock.calls.length).toBeGreaterThan(previousCalls));
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
