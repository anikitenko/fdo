import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import * as monaco from "monaco-editor";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";
import {EditorPage} from "../../../src/components/editor/EditorPage.jsx";

jest.mock("react-split-grid", () => ({
    __esModule: true,
    default: ({render}) => render({
        getGridProps: () => ({}),
        getGutterProps: () => ({}),
    }),
}));

jest.mock("@monaco-editor/react", () => ({
    loader: {
        config: jest.fn(),
    },
    Editor: () => <div data-testid="monaco-editor" />,
}));

jest.mock("../../../src/components/editor/FileBrowserComponent", () => () => <div>File Browser</div>);
jest.mock("../../../src/components/editor/FileTabComponent", () => () => <div>File Tabs</div>);
jest.mock("../../../src/components/editor/FileDialogComponent", () => () => null);
jest.mock("../../../src/components/editor/CodeDeployActions", () => () => <div>Deploy Actions</div>);
jest.mock("../../../src/components/editor/snapshots/SnapshotMount.jsx", () => () => <div>Snapshot Toolbar</div>);
jest.mock("../../../src/components/common/SidebarSection.jsx", () => ({children}) => <div>{children}</div>);
jest.mock("../../../src/components/editor/BuildOutputTerminalComponent", () => () => <div>Build Output</div>);
jest.mock("../../../src/components/editor/monaco/EditorStyle", () => () => null);
jest.mock("../../../src/components/editor/utils/codeEditorActions", () => jest.fn());

jest.mock("../../../src/components/editor/utils/setupVirtualWorkspace", () => ({
    setupVirtualWorkspace: jest.fn(async (pluginName) => {
        const mockVirtualFS = require("../../../src/components/editor/utils/VirtualFS").default;
        const mockMonaco = require("monaco-editor");
        if (mockVirtualFS.isInitWorkspace()) {
            return;
        }
        mockVirtualFS.setInitWorkspace(pluginName, `sandbox_${pluginName}`);

        const mainModel = mockMonaco.editor.createModel("export const hello = 'world';", "typescript", mockMonaco.Uri.file("/index.ts"));
        const renderModel = mockMonaco.editor.createModel("export const render = () => null;", "typescript", mockMonaco.Uri.file("/render.tsx"));
        const packageModel = mockMonaco.editor.createModel('{"name":"test-plugin"}', "json", mockMonaco.Uri.file("/package.json"));

        mockVirtualFS.createFile("/index.ts", mainModel);
        mockVirtualFS.createFile("/render.tsx", renderModel);
        mockVirtualFS.createFile("/package.json", packageModel);
    }),
}));

function resetVirtualFs() {
    virtualFS.files = {};
    virtualFS.initWorkspace = false;
    virtualFS.pluginName = "";
    virtualFS.sandboxName = "";
    virtualFS.quickInputWidgetTop = false;
    virtualFS.treeObject = [{
        id: "/",
        label: "/",
        type: "folder",
        isExpanded: true,
        childNodes: [],
    }];
    virtualFS.notifications.reset();
    virtualFS.tabs.list = [];
    virtualFS.fs.versions = {};
    virtualFS.fs.version_latest = 0;
    virtualFS.fs.version_current = 0;
    virtualFS.fs.tsCounter = 0;
    virtualFS.fs.loading = false;
    localStorage.clear();
    monaco.editor._models?.clear?.();
}

describe("EditorPage baseline snapshot", () => {
    beforeEach(() => {
        resetVirtualFs();
        window.electron.system.on.confirmEditorClose.mockClear();
        window.electron.system.on.confirmEditorReload.mockClear();
        window.electron.system.off.confirmEditorClose.mockClear();
        window.electron.system.off.confirmEditorReload.mockClear();
    });

    test("creates exactly one baseline snapshot for a new workspace after startup stabilizes", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });

        expect(virtualFS.getTreeObjectItemById("/index.ts")).toBeTruthy();
        expect(virtualFS.getTreeObjectItemById("/render.tsx")).toBeTruthy();
        expect(virtualFS.getTreeObjectItemById("/package.json")).toBeTruthy();
        expect(virtualFS.tabs.get().length).toBeGreaterThan(0);
        expect(virtualFS.getTreeObjectItemSelected()?.id).toBe("/index.ts");
    });

    test("reopening the same workspace does not create a duplicate baseline snapshot", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        const {unmount} = render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });

        unmount();

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });
    });

    test("opening a different existing plugin workspace creates its own baseline snapshot", async () => {
        const firstPluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));
        const secondPluginData = encodeURIComponent(JSON.stringify({
            name: "Existing Plugin",
            template: "blank",
            dir: "/plugins/existing-plugin",
        }));

        const { unmount } = render(
            <MemoryRouter initialEntries={[`/editor?data=${firstPluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });
        expect(virtualFS.pluginName).toBe("test-plugin");

        unmount();

        render(
            <MemoryRouter initialEntries={[`/editor?data=${secondPluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });
        expect(virtualFS.pluginName).toBe("existing-plugin");
        expect(virtualFS.getTreeObjectItemById("/index.ts")).toBeTruthy();
    });

    test("shows a blocking restore overlay during snapshot restore", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });

        virtualFS.notifications.addToQueue("restoreLoading", true);

        await waitFor(() => {
            expect(screen.getByRole("alertdialog", { name: /Restoring snapshot/i })).toBeTruthy();
        });
        expect(screen.getByText(/Updating files, tabs, and editor state/i)).toBeTruthy();
    });

    test("shows an explicit empty editor state after closing the last tab", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.tabs.get().length).toBeGreaterThan(0);
        });

        act(() => {
            virtualFS.tabs.get().forEach((tab) => virtualFS.tabs.removeById(tab.id));
        });

        await waitFor(() => {
            expect(screen.getByText(/No file open/i)).toBeTruthy();
        });
        expect(screen.getByText(/Select a file from Project Explorer or reopen the main plugin file/i)).toBeTruthy();
    });

    test("open main file reopens the default main file instead of the last closed tab", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.tabs.get().length).toBeGreaterThan(0);
        });

        const renderFile = virtualFS.getTreeObjectItemById("/render.tsx");
        act(() => {
            virtualFS.tabs.add(renderFile);
            virtualFS.tabs.setActiveTab(renderFile);
        });

        act(() => {
            virtualFS.tabs.get().forEach((tab) => virtualFS.tabs.removeById(tab.id));
        });

        await waitFor(() => {
            expect(screen.getByText(/No file open/i)).toBeTruthy();
        });

        fireEvent.click(screen.getByRole("button", { name: /Open Main File/i }));

        await waitFor(() => {
            expect(virtualFS.tabs.getActiveTabId()).toBe("/index.ts");
        });
    });

    test("falls back to the render entry when index.ts does not exist", async () => {
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.tabs.get().length).toBeGreaterThan(0);
        });

        act(() => {
            virtualFS.deleteFile("/index.ts");
            virtualFS.tabs.get().forEach((tab) => virtualFS.tabs.removeById(tab.id));
        });

        await waitFor(() => {
            expect(screen.getByText(/No file open/i)).toBeTruthy();
        });

        const reopenButton = screen.getByRole("button", { name: /Open Available File/i });
        fireEvent.click(reopenButton);

        await waitFor(() => {
            expect(virtualFS.tabs.getActiveTabId()).toBe("/render.tsx");
        });
    });

    test("registers and unregisters editor close and reload confirmations exactly once", async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        const addEventListenerSpy = jest.spyOn(window, "addEventListener");
        const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        const { unmount } = render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(virtualFS.fs.list()).toHaveLength(1);
        });

        expect(window.electron.system.on.confirmEditorClose).toHaveBeenCalledTimes(1);
        expect(window.electron.system.on.confirmEditorReload).toHaveBeenCalledTimes(1);

        const closeHandler = window.electron.system.on.confirmEditorClose.mock.calls[0][0];
        const reloadHandler = window.electron.system.on.confirmEditorReload.mock.calls[0][0];
        const beforeUnloadHandler = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === "beforeunload")[1];

        const preventDefault = jest.fn();
        const event = { preventDefault, returnValue: undefined };
        beforeUnloadHandler(event);
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(event.returnValue).toBe("");

        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
        closeHandler();
        closeHandler();

        const eventAfterApprove = { preventDefault: jest.fn(), returnValue: undefined };
        beforeUnloadHandler(eventAfterApprove);
        expect(eventAfterApprove.preventDefault).not.toHaveBeenCalled();
        expect(window.electron.system.confirmEditorCloseApproved).toHaveBeenCalledTimes(1);
        expect(confirmSpy).toHaveBeenCalledTimes(1);

        unmount();

        expect(window.electron.system.off.confirmEditorClose).toHaveBeenCalledWith(closeHandler);
        expect(window.electron.system.off.confirmEditorReload).toHaveBeenCalledWith(reloadHandler);
        expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", beforeUnloadHandler);

        confirmSpy.mockRestore();
        addEventListenerSpy.mockRestore();
        removeEventListenerSpy.mockRestore();
        process.env.NODE_ENV = previousNodeEnv;
    });

    test("registers quick-fix provider with Monaco textEdit payloads", async () => {
        monaco.languages.registerCodeActionProvider = jest.fn();
        const pluginData = encodeURIComponent(JSON.stringify({
            name: "Test Plugin",
            template: "blank",
            dir: "sandbox",
        }));

        render(
            <MemoryRouter initialEntries={[`/editor?data=${pluginData}`]}>
                <EditorPage />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalled();
        });

        const provider = monaco.languages.registerCodeActionProvider.mock.calls[0]?.[1];
        expect(provider).toBeTruthy();

        const source = `const req = createHostsWriteActionRequest({ action: "system.hosts.write" });`;
        const actionsResult = provider.provideCodeActions(
            {
                getValue: () => source,
                uri: monaco.Uri.file("/index.ts"),
            },
            null,
            {
                markers: [{
                    code: "FDO_MISSING_SYSTEM_HOSTS_WRITE",
                    message: 'Missing capability: "system.hosts.write".',
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 10,
                }],
            }
        );

        const firstEdit = actionsResult?.actions?.[0]?.edit?.edits?.[0];
        expect(firstEdit?.textEdit).toBeTruthy();
        expect(firstEdit?.edit).toBeUndefined();
    });
});
