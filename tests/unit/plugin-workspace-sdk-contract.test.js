import {validatePluginWorkspaceSdkContract} from "../../src/utils/pluginWorkspaceSdkContract.js";
const {createRenderOnLoadActionsSource} = require("@anikitenko/fdo-sdk");

describe("validatePluginWorkspaceSdkContract", () => {
    const actionOptions = {runtimeExports: ["defineRenderOnLoadActions"], createActionSource: createRenderOnLoadActionsSource};

    test.each([
        `import {defineRenderOnLoadActions as actions} from "@anikitenko/fdo-sdk";
         actions({handlers: {open: "window.tools.open();"}, bindings: []});`,
        `import * as sdk from "@anikitenko/fdo-sdk";
         const source = "window.tools.open();";
         const handlers = {open: source}; const options = {handlers, bindings: []};
         sdk.defineRenderOnLoadActions(options);`,
    ])("rejects malformed handler strings using the installed SDK", content => {
        const errors = validatePluginWorkspaceSdkContract({"/render.tsx": content}, actionOptions);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/\/render.tsx:\d+: renderOnLoad handler "open" produces invalid source/);
        expect(errors[0]).toContain("complete handler function");
    });

    test("accepts handler functions, function source strings, and inert wording", () => {
        expect(validatePluginWorkspaceSdkContract({"/render.tsx": `
            import {defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
            defineRenderOnLoadActions({handlers: {
                open: ({document}) => { document.title = "Text to process."; },
                close: "({document}) => { document.title = 'Text to process.'; }",
                reset: \`({element}) => { element.textContent = ''; }\`,
            }, bindings: []});
        `}, actionOptions)).toEqual([]);
    });

    test("follows changed SDK string-wrapping behavior", () => {
        const createActionSource = jest.fn(() => '(() => { const action = () => { window.tools.open(); }; })();');
        expect(validatePluginWorkspaceSdkContract({"/render.tsx": `
            import {defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
            defineRenderOnLoadActions({handlers: {open: "window.tools.open();"}, bindings: []});
        `}, {...actionOptions, createActionSource})).toEqual([]);
        expect(createActionSource).toHaveBeenCalled();
    });

    test("does not interpret unrelated APIs, dynamic handlers, or tests as SDK declarations", () => {
        expect(validatePluginWorkspaceSdkContract({"/render.tsx": `
            function defineRenderOnLoadActions(options) { return options; }
            defineRenderOnLoadActions({handlers: {open: "not JS;"}});
        `, "/render.test.ts": `import {defineRenderOnLoadActions} from "@anikitenko/fdo-sdk";
            defineRenderOnLoadActions({handlers: {bad: "bad syntax;;"}, bindings: []});`
        }, actionOptions)).toEqual([]);
    });

    test("rejects a value import missing from the actual runtime exports", () => {
        const errors = validatePluginWorkspaceSdkContract({
            "/index.ts": `import {BasePlugin} from "@anikitenko/fdo-sdk";
class ToolsPlugin extends BasePlugin {}`,
        }, {runtimeExports: ["FDO_SDK"]});

        expect(errors).toEqual([
            expect.stringContaining('/index.ts:1: @anikitenko/fdo-sdk does not provide "BasePlugin"'),
        ]);
    });

    test("accepts an export when a future SDK provides it", () => {
        const errors = validatePluginWorkspaceSdkContract({
            "/index.ts": `import {BasePlugin} from "@anikitenko/fdo-sdk";
class ToolsPlugin extends BasePlugin {}`,
        }, {runtimeExports: ["BasePlugin"]});

        expect(errors).toEqual([]);
    });

    test("supports a CommonJS SDK default import", () => {
        const errors = validatePluginWorkspaceSdkContract({
            "/index.ts": `import PluginSdk from "@anikitenko/fdo-sdk";
new PluginSdk();`,
        }, {runtimeExports: ["default"]});

        expect(errors).toEqual([]);
    });

    test("does not reject TypeScript-only SDK imports", () => {
        const errors = validatePluginWorkspaceSdkContract({
            "/index.ts": `import {FDO_SDK, type PluginMetadata, FDOInterface} from "@anikitenko/fdo-sdk";
class ToolsPlugin extends FDO_SDK implements FDOInterface {
  metadata: PluginMetadata;
}`,
        }, {runtimeExports: ["FDO_SDK"]});

        expect(errors).toEqual([]);
    });
});
