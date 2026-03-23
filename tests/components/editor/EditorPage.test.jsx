import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
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
});
