import virtualFS from "../../src/components/editor/utils/VirtualFS";
import * as monaco from "monaco-editor";

function collectTreeIds(nodes = []) {
    const ids = [];
    for (const node of nodes) {
        ids.push(node.id);
        if (node.childNodes?.length) {
            ids.push(...collectTreeIds(node.childNodes));
        }
    }
    return ids;
}

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
    monaco.editor._models?.clear?.();
}

describe("editor snapshot state", () => {
    beforeEach(() => {
        resetVirtualFs();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("quiet snapshot create updates history without tree loading notifications", () => {
        const model = monaco.editor.createModel("export const value = 1;", "typescript", monaco.Uri.file("/index.ts"));
        virtualFS.createFile("/index.ts", model);

        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        const created = virtualFS.fs.create("", [], { quiet: true });

        expect(created.version).toBeTruthy();
        expect(virtualFS.fs.list()).toHaveLength(1);

        const emittedEvents = addToQueueSpy.mock.calls.map(([eventType]) => eventType);
        expect(emittedEvents).toContain("treeVersionsUpdate");
        expect(emittedEvents).not.toContain("treeLoading");

    });

    test("workspace snapshot create still emits tree loading notifications by default", () => {
        const model = monaco.editor.createModel("export const value = 2;", "typescript", monaco.Uri.file("/index.ts"));
        virtualFS.createFile("/index.ts", model);

        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        const created = virtualFS.fs.create();

        expect(created.version).toBeTruthy();

        const loadingEvents = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "treeLoading")
            .map(([, value]) => value);

        expect(loadingEvents).toEqual([true, false]);
        expect(addToQueueSpy.mock.calls.map(([eventType]) => eventType)).toContain("treeVersionsUpdate");

    });

    test("snapshot switch restores saved tabs atomically and stays busy through node_modules completion", async () => {
        const indexModel = monaco.editor.createModel("export const value = 1;", "typescript", monaco.Uri.file("/index.ts"));
        const renderModel = monaco.editor.createModel("export const render = () => null;", "typescript", monaco.Uri.file("/render.tsx"));
        virtualFS.createFile("/index.ts", indexModel);
        virtualFS.createFile("/render.tsx", renderModel);
        virtualFS.tabs.add(virtualFS.getTreeObjectItemById("/index.ts"));

        const v1 = virtualFS.fs.create("", [{ id: "/index.ts", active: true }], { quiet: true });

        virtualFS.tabs.add(virtualFS.getTreeObjectItemById("/render.tsx"));
        virtualFS.tabs.setActiveTab(virtualFS.getTreeObjectItemById("/render.tsx"));
        virtualFS.setFileContent("/render.tsx", "export const render = () => 'next';");

        const v2 = virtualFS.fs.create(v1.version, [
            { id: "/index.ts", active: false },
            { id: "/render.tsx", active: true }
        ], { quiet: true });

        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        const restored = virtualFS.fs.set(v1.version);
        virtualFS.tabs.replaceFromSaved(restored.tabs);
        if (restored.nodeModulesPromise?.then) {
            await restored.nodeModulesPromise;
        }

        expect(virtualFS.fs.version().version).toBe(v1.version);
        expect(virtualFS.tabs.get().map((tab) => tab.id)).toEqual(["/index.ts"]);
        expect(virtualFS.tabs.getActiveTabId()).toBe("/index.ts");
        expect(v2.version).toBeTruthy();

        const emittedEvents = addToQueueSpy.mock.calls.map(([eventType]) => eventType);
        expect(emittedEvents).toContain("restoreLoading");
        expect(emittedEvents).not.toContain("treeLoading");
        expect(emittedEvents).not.toContain("fileRemoved");
        expect(emittedEvents.filter((eventType) => eventType === "treeUpdate")).toHaveLength(2);
        expect(emittedEvents.filter((eventType) => eventType === "fileSelected")).toHaveLength(1);

        const restoreLoadingStates = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "restoreLoading")
            .map(([, value]) => value);

        expect(restoreLoadingStates).toEqual([true, false]);

        const restorePhases = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "restorePhase")
            .map(([, value]) => value);

        expect(restorePhases).toContain("loading-node-modules");
        expect(restorePhases).toContain("node-modules-complete");
        expect(restorePhases).toContain("restore-complete");
        expect(restorePhases[restorePhases.length - 1]).toBe("idle");

    });

    test("snapshot switch selects the saved active tab instead of flashing the default main file", async () => {
        const indexModel = monaco.editor.createModel("export const value = 1;", "typescript", monaco.Uri.file("/index.ts"));
        const renderModel = monaco.editor.createModel("export const render = () => null;", "typescript", monaco.Uri.file("/render.tsx"));
        virtualFS.createFile("/index.ts", indexModel);
        virtualFS.createFile("/render.tsx", renderModel);

        const baseline = virtualFS.fs.create("", [
            { id: "/index.ts", active: true }
        ], { quiet: true });

        virtualFS.setFileContent("/render.tsx", "export const render = () => 'active';");
        const target = virtualFS.fs.create(baseline.version, [
            { id: "/index.ts", active: false },
            { id: "/render.tsx", active: true }
        ], { quiet: true });

        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        const restored = virtualFS.fs.set(target.version);
        virtualFS.tabs.replaceFromSaved(restored.tabs);
        if (restored.nodeModulesPromise?.then) {
            await restored.nodeModulesPromise;
        }

        expect(virtualFS.fs.version().version).toBe(target.version);
        expect(virtualFS.tabs.getActiveTabId()).toBe("/render.tsx");
        expect(virtualFS.getTreeObjectItemSelected()?.id).toBe("/render.tsx");

        const fileSelectedPayloads = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "fileSelected")
            .map(([, payload]) => payload?.id)
            .filter(Boolean);

        expect(fileSelectedPayloads).toContain("/render.tsx");
        expect(fileSelectedPayloads[0]).toBe("/render.tsx");
    });

    test("snapshot switch restores the exact saved file structure and removes stale files", async () => {
        const indexModel = monaco.editor.createModel("export const value = 1;", "typescript", monaco.Uri.file("/index.ts"));
        const legacyModel = monaco.editor.createModel("export const legacy = true;", "typescript", monaco.Uri.file("/legacy.ts"));
        virtualFS.createFile("/index.ts", indexModel);
        virtualFS.createFile("/legacy.ts", legacyModel);

        const baseline = virtualFS.fs.create("", [
            { id: "/index.ts", active: true }
        ], { quiet: true });

        virtualFS.deleteFile("/legacy.ts");

        const nestedModel = monaco.editor.createModel("export const value = 2;", "typescript", monaco.Uri.file("/features/alpha.ts"));
        const utilModel = monaco.editor.createModel("export const helper = true;", "typescript", monaco.Uri.file("/utils/math.ts"));
        virtualFS.createFile("/features/alpha.ts", nestedModel);
        virtualFS.createFile("/utils/math.ts", utilModel);

        const target = virtualFS.fs.create(baseline.version, [
            { id: "/features/alpha.ts", active: true },
            { id: "/utils/math.ts", active: false }
        ], { quiet: true });

        const restored = virtualFS.fs.set(target.version);
        virtualFS.tabs.replaceFromSaved(restored.tabs);
        if (restored.nodeModulesPromise?.then) {
            await restored.nodeModulesPromise;
        }

        const treeIds = collectTreeIds(virtualFS.getTreeObjectSortedAsc());

        expect(treeIds).toContain("/features");
        expect(treeIds).toContain("/features/alpha.ts");
        expect(treeIds).toContain("/utils");
        expect(treeIds).toContain("/utils/math.ts");
        expect(treeIds).not.toContain("/legacy.ts");
        expect(virtualFS.tabs.get().map((tab) => tab.id)).toEqual(["/features/alpha.ts", "/utils/math.ts"]);
        expect(virtualFS.tabs.getActiveTabId()).toBe("/features/alpha.ts");
        expect(virtualFS.fs.version().version).toBe(target.version);
    });

    test("node_modules preload emits nodeModulesLoading instead of treeLoading", async () => {
        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        await virtualFS.fs.setupNodeModules();

        const emittedEvents = addToQueueSpy.mock.calls.map(([eventType]) => eventType);
        expect(emittedEvents).toContain("nodeModulesLoading");
        expect(emittedEvents).not.toContain("treeLoading");

        const nodeModulesLoadingStates = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "nodeModulesLoading")
            .map(([, value]) => value);

        expect(nodeModulesLoadingStates).toEqual([true, false]);

    });

    test("node_modules preload tolerates non-iterable SDK types payload", async () => {
        const originalGetFdoSdkTypes = window.electron.system.getFdoSdkTypes;
        window.electron.system.getFdoSdkTypes = jest.fn().mockResolvedValue({
            success: false,
            error: "types unavailable",
        });

        const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

        try {
            await expect(virtualFS.fs.setupNodeModules()).resolves.toBeUndefined();
        } finally {
            window.electron.system.getFdoSdkTypes = originalGetFdoSdkTypes;
        }

        const nodeModulesLoadingStates = addToQueueSpy.mock.calls
            .filter(([eventType]) => eventType === "nodeModulesLoading")
            .map(([, value]) => value);
        expect(nodeModulesLoadingStates).toEqual([true, false]);
    });

    test("node_modules preload injects fallback SDK declarations when SDK types are missing", async () => {
        const originalGetFdoSdkTypes = window.electron.system.getFdoSdkTypes;
        window.electron.system.getFdoSdkTypes = jest.fn().mockResolvedValue({
            success: true,
            files: [],
        });
        const addExtraLibSpy = jest.spyOn(monaco.typescript.typescriptDefaults, "addExtraLib");

        try {
            await virtualFS.fs.setupNodeModules();
        } finally {
            window.electron.system.getFdoSdkTypes = originalGetFdoSdkTypes;
        }

        expect(addExtraLibSpy).toHaveBeenCalledWith(
            expect.stringContaining('declare module "@anikitenko/fdo-sdk"'),
            "/node_modules/@anikitenko/fdo-sdk/index.d.ts"
        );
    });

    test("restore loading watchdog recovers stuck restore state", () => {
        jest.useFakeTimers();
        try {
            const addToQueueSpy = jest.spyOn(virtualFS.notifications, "addToQueue");

            virtualFS.fs.setRestoreLoading();
            expect(virtualFS.fs.getRestoreLoading()).toBe(true);

            jest.advanceTimersByTime(virtualFS.fs.restoreLoadingWatchdogMs + 50);

            expect(virtualFS.fs.getRestoreLoading()).toBe(false);
            const restoreLoadingStates = addToQueueSpy.mock.calls
                .filter(([eventType]) => eventType === "restoreLoading")
                .map(([, value]) => value);
            expect(restoreLoadingStates).toEqual([true, false]);
        } finally {
            jest.useRealTimers();
        }
    });

    test("notification queue flushes restoreLoading transitions without long backlog delay", async () => {
        const restoreStates = [];
        virtualFS.notifications.subscribe("restoreLoading", (value) => restoreStates.push(value));

        virtualFS.notifications.addToQueue("restoreLoading", true);
        for (let i = 0; i < 120; i += 1) {
            virtualFS.notifications.addToQueue("treeUpdate", []);
        }
        virtualFS.notifications.addToQueue("restoreLoading", false);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(restoreStates).toEqual([true, false]);
    });
});
