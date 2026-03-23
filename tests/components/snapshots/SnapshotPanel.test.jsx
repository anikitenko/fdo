import React, {useEffect} from "react";
import {render, screen, fireEvent, waitFor} from "@testing-library/react";
import {HotkeysProvider} from "@blueprintjs/core";
import {SnapshotProvider, useSnapshots} from "../../../src/components/editor/snapshots/SnapshotContext.jsx";
import SnapshotPanel from "../../../src/components/editor/snapshots/SnapshotPanel.jsx";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";

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
    localStorage.clear();
    require("monaco-editor").editor._models?.clear?.();
}

function OpenPanelOnMount() {
    const {openPanel} = useSnapshots();

    useEffect(() => {
        openPanel();
    }, [openPanel]);

    return null;
}

function Wrapper({children}) {
    return (
        <HotkeysProvider>
            <SnapshotProvider>
                <OpenPanelOnMount />
                {children}
            </SnapshotProvider>
        </HotkeysProvider>
    );
}

describe("SnapshotPanel", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        resetVirtualFs();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test("shows switching status while keeping timeline content visible during restore", async () => {
        const monaco = require("monaco-editor");
        const model = monaco.editor.createModel("A", "plaintext", monaco.Uri.file("/a.ts"));
        virtualFS.createFile("/a.ts", model);
        virtualFS.tabs.add(virtualFS.getTreeObjectItemById("/a.ts"));

        const v1 = virtualFS.fs.create("", [{ id: "/a.ts", active: true }], { quiet: true });
        virtualFS.setFileContent("/a.ts", "B");
        virtualFS.fs.create(v1.version, [{ id: "/a.ts", active: true }], { quiet: true });

        render(<Wrapper><SnapshotPanel /></Wrapper>);

        await screen.findByText("Snapshots");
        await screen.findByText(v1.version);

        fireEvent.click(screen.getAllByRole("button", { name: /Switch/i })[1]);

        expect(screen.getByRole("status")).toHaveTextContent(/Switching snapshot and restoring editor state/i);
        expect(screen.getByText(v1.version)).toBeTruthy();

        jest.advanceTimersByTime(250);

        await waitFor(() => {
            expect(virtualFS.fs.version().version).toBe(v1.version);
        });
    });
});
