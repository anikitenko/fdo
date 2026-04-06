import {setupVirtualWorkspace} from "../../../../src/components/editor/utils/setupVirtualWorkspace";
import virtualFS from "../../../../src/components/editor/utils/VirtualFS";
import {createVirtualFile} from "../../../../src/components/editor/utils/createVirtualFile";
import * as monaco from "monaco-editor";

jest.mock("../../../../src/components/editor/utils/createVirtualFile", () => ({
    createVirtualFile: jest.fn(),
}));

jest.mock("../../../../src/components/editor/utils/workspaceMonacoCompilerOptions", () => ({
    buildWorkspaceMonacoCompilerOptions: jest.fn(() => ({})),
}));

jest.mock("../../../../src/components/editor/monaco/EditorDarkTheme", () => ({}));

jest.mock("../../../../src/components/editor/utils/VirtualFS", () => ({
    __esModule: true,
    default: {
        DEFAULT_FILE_MAIN: "/index.ts",
        DEFAULT_FILE_RENDER: "/render.tsx",
        isInitWorkspace: jest.fn(() => false),
        setInitWorkspace: jest.fn(),
        restoreSandbox: jest.fn(),
        fs: {
            setupNodeModules: jest.fn(async () => undefined),
        },
    },
}));

describe("setupVirtualWorkspace sandbox detection", () => {
    beforeEach(() => {
        localStorage.clear();
        monaco.editor.defineTheme = jest.fn();
        createVirtualFile.mockReset();
        virtualFS.isInitWorkspace.mockReturnValue(false);
        virtualFS.setInitWorkspace.mockClear();
        virtualFS.restoreSandbox.mockClear();
        virtualFS.fs.setupNodeModules.mockClear();
        window.electron.plugin = {
            getData: jest.fn(),
        };
    });

    test("loads plugin files from disk when plugin path only contains sandbox token as substring", async () => {
        const dir = "/Users/alexvwan/Library/Application Support/FDO (FlexDevOPs)/plugins/sdgdsfdsfhsdh_sandbox_sdgdsfdsfhsdh";
        window.electron.plugin.getData.mockResolvedValue({
            success: true,
            content: [
                {path: "/index.ts", content: "export default 1;"},
                {path: "/render.tsx", content: "export default null;"},
            ],
        });

        await setupVirtualWorkspace("sdgdsfdsfhsdh", "sdgdsfdsfhsdh", "blank", dir);

        expect(window.electron.plugin.getData).toHaveBeenCalledWith(dir);
        expect(createVirtualFile).toHaveBeenCalledWith("/index.ts", "export default 1;");
        expect(createVirtualFile).toHaveBeenCalledWith("/render.tsx", "export default null;");
        expect(virtualFS.fs.setupNodeModules).toHaveBeenCalledTimes(1);
    });

    test("scaffolds template files only for true sandbox workspace folder", async () => {
        const dir = "/tmp/sandbox_sdgdsfdsfhsdh";
        window.electron.plugin.getData.mockResolvedValue({
            success: true,
            content: [{path: "/index.ts", content: "should not be used"}],
        });

        await setupVirtualWorkspace("sdgdsfdsfhsdh", "sdgdsfdsfhsdh", "blank", dir);

        expect(window.electron.plugin.getData).not.toHaveBeenCalled();
        expect(createVirtualFile).toHaveBeenCalledWith("/index.ts", "sdgdsfdsfhsdh", "blank");
        expect(createVirtualFile).toHaveBeenCalledWith("/render.tsx", "sdgdsfdsfhsdh", "blank");
        expect(virtualFS.fs.setupNodeModules).toHaveBeenCalledTimes(1);
    });
});
