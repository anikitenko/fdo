import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import FileTabs from "../../../src/components/editor/FileTabComponent.js";
import FileBrowserComponent from "../../../src/components/editor/FileBrowserComponent.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";
import * as monaco from "monaco-editor";

jest.mock("../../../src/components/editor/context_menu/CONTEXT_MENU", () => () => null);
jest.mock("react-contexify", () => ({
    useContextMenu: () => ({
        show: jest.fn(),
    }),
}));

function resetVirtualFs() {
    virtualFS.files = {};
    virtualFS.initWorkspace = false;
    virtualFS.pluginName = "TestPlugin";
    virtualFS.sandboxName = "sandbox_test";
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
    virtualFS.fs.nodeModulesLoading = false;
    virtualFS.fs.restoreLoading = false;
    localStorage.clear();
    monaco.editor._models?.clear?.();
}

describe("Editor chrome status indicators", () => {
    beforeEach(() => {
        resetVirtualFs();
        global.ResizeObserver = class {
            observe() {}
            disconnect() {}
        };

        const model = monaco.editor.createModel("export const hello = 'world';", "typescript", monaco.Uri.file("/index.ts"));
        virtualFS.createFile("/index.ts", model);
        virtualFS.tabs.add(virtualFS.getTreeObjectItemById("/index.ts"));
    });

    test("tabs and tree show subtle restore indicators instead of skeletons", async () => {
        render(
            <>
                <FileTabs closeTab={jest.fn()} />
                <FileBrowserComponent />
            </>
        );

        virtualFS.notifications.addToQueue("restoreLoading", true);

        await waitFor(() => {
            const statuses = screen.getAllByRole("status");
            expect(statuses.some((node) => /Restoring tabs and editor state/i.test(node.textContent))).toBe(true);
            expect(statuses.some((node) => /Restoring project tree/i.test(node.textContent))).toBe(true);
        });

        expect(screen.getByRole("button", { name: /index\.ts/i })).toBeDisabled();

        expect(document.querySelectorAll(".bp6-skeleton").length).toBe(0);
    });

    test("tabs and tree show subtle node-modules indicators", async () => {
        render(
            <>
                <FileTabs closeTab={jest.fn()} />
                <FileBrowserComponent />
            </>
        );

        virtualFS.notifications.addToQueue("nodeModulesLoading", true);

        await waitFor(() => {
            const statuses = screen.getAllByRole("status");
            expect(statuses.some((node) => /Loading project types/i.test(node.textContent))).toBe(true);
            expect(statuses.some((node) => /Loading dependencies and types/i.test(node.textContent))).toBe(true);
        });

        expect(screen.getByRole("button", { name: /index\.ts/i })).toBeEnabled();
    });
});
