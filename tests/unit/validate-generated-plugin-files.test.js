import {normalizeReservedHostBindingMarkers, validateGeneratedPluginFiles} from "../../src/components/editor/utils/validateGeneratedPluginFiles.js";

describe("validateGeneratedPluginFiles", () => {
    test("accepts a plugin entry file with Blueprint icon and explicit instantiation", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
import {FDO_SDK, FDOInterface, PluginMetadata} from "@anikitenko/fdo-sdk";

class HostsPlugin extends FDO_SDK implements FDOInterface {
    private readonly _metadata: PluginMetadata = {
        name: "Hosts",
        version: "1.0.0",
        author: "Test",
        description: "Plugin",
        icon: "globe",
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }

    init(): void {}

    render(): string {
        return "<div>ok</div>";
    }
}

export default HostsPlugin;
new HostsPlugin();
                `,
            },
        ]);

        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    test("rejects custom icon asset metadata", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
class HostsPlugin extends FDO_SDK {
    private readonly _metadata = {
        icon: "icon.png",
    };
}
export default HostsPlugin;
new HostsPlugin();
                `,
            },
        ]);

        expect(result.errors).toEqual([
            expect.stringContaining("metadata.icon must use a BlueprintJS v6 icon name string"),
        ]);
    });

    test("rejects invented Blueprint icon names before they reach plugin runtime", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
class InspectorPlugin extends FDO_SDK {
    private readonly _metadata = {icon: "data-object"};
}
export default InspectorPlugin;
new InspectorPlugin();
                `,
            },
        ]);

        expect(result.errors).toEqual([
            expect.stringContaining('metadata.icon "data-object" is not a valid BlueprintJS v6 icon name'),
        ]);
    });

    test("rejects missing explicit instantiation", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
class HostsPlugin extends FDO_SDK {}
export default HostsPlugin;
                `,
            },
        ]);

        expect(result.errors).toEqual([
            expect.stringContaining("new HostsPlugin()"),
        ]);
    });

    test("warns on suspicious direct window access outside obvious UI paths", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
class HostsPlugin extends FDO_SDK {
    init(): void {
        window.createBackendReq("UI_MESSAGE", {handler: "refreshStatus", content: {}});
    }
}
export default HostsPlugin;
new HostsPlugin();
                `,
            },
        ]);

        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([
            expect.stringContaining("direct window.* access appears outside obvious UI/event code paths"),
        ]);
    });

    test("rejects imports of FDO host/editor implementation files from plugin code", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `
import { runPluginWorkspaceTests } from "../../../utils/pluginTestRunner.js";

class HostsPlugin extends FDO_SDK {}
export default HostsPlugin;
new HostsPlugin();
                `,
            },
        ]);

        expect(result.errors).toEqual([
            expect.stringContaining("must not import FDO host/editor implementation files"),
        ]);
    });

    test("does not reject plugin-local helpers just because they share a host filename", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/tests/unit/validate-generated-plugin-files.test.js",
                content: `
import { validateGeneratedPluginFiles } from "../../utils/validateGeneratedPluginFiles.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("works", () => {
    assert.ok(validateGeneratedPluginFiles);
});
                `,
            },
        ]);

        expect(result.errors).toEqual([]);
    });

    test("rejects plugin tests that use bare Jest-style globals without node:test imports", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/src/plugin.test.ts",
                content: `
describe("plugin", () => {
    test("works", () => {
        expect(true).toBe(true);
    });
});
                `,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("/src/plugin.test.ts:"),
            expect.stringContaining("plugin tests use describe(...) without importing from node:test"),
            expect.stringContaining("plugin tests use test(...) without importing from node:test"),
            expect.stringContaining("plugin tests must use node:assert/strict instead of Jest/Vitest expect()"),
        ]));
    });

    test("accepts plugin tests that import node:test and node:assert/strict", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/src/plugin.test.ts",
                content: `
import {describe, test} from "node:test";
import assert from "node:assert/strict";

describe("plugin", () => {
    test("works", () => {
        assert.equal(1, 1);
    });
});
                `,
            },
        ]);

        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    test("requires injected Pure CSS classes for an interactive form", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `<textarea data-role="json-input"></textarea><button class="pure-button pure-button-primary">Inspect</button>`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Add a "pure-form pure-form-stacked" wrapper'),
        ]));
    });

    test("requires an injected Pure CSS primary button for an interactive action", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `<form class="pure-form pure-form-stacked"><textarea data-role="json-input"></textarea><button>Inspect</button></form>`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Add "pure-button pure-button-primary"'),
        ]));
    });

    test("rejects importing Pure CSS because the plugin iframe already injects it", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `import "purecss";
<form class="pure-form pure-form-stacked"><textarea data-role="json-input"></textarea><button class="pure-button pure-button-primary">Inspect</button></form>`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("Pure CSS is already injected into every plugin iframe"),
        ]));
    });

    test("requires the standard UI_MESSAGE backend request envelope", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {
    renderOnLoad() {
        return window.createBackendReq("inspectJson", {json: "{}"});
    }
}
new InspectorPlugin();`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('window.createBackendReq must call "UI_MESSAGE"'),
        ]));
    });

    test("accepts a standard UI_MESSAGE backend request envelope", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {
    renderOnLoad() {
        return window.createBackendReq("UI_MESSAGE", {
            handler: "inspectJson",
            content: {json: "{}"},
        });
    }
}
new InspectorPlugin();`,
            },
        ]);

        expect(result.errors).toEqual([]);
    });

    test("rejects a UI handler that reads a direct content object under a second content key", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {
    init() {
        PluginRegistry.registerHandler("inspectJson", (data) => JSON.parse(data.content.json));
    }
}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `window.createBackendReq("UI_MESSAGE", {handler: "inspectJson", content: {json: "{}"}});`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('the "inspectJson" UI handler receives'),
            expect.stringContaining("Read data.json"),
        ]));
    });

    test("accepts a UI handler that reads the direct content object", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {
    init() {
        PluginRegistry.registerHandler("inspectJson", ({json}) => JSON.parse(json));
    }
}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `window.createBackendReq("UI_MESSAGE", {handler: "inspectJson", content: {json: "{}"}});`,
            },
        ]);

        expect(result.errors).toEqual([]);
    });

    test("rejects React JSX passed to the SDK HTML renderer", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const dom = new DOM();
dom.renderHTML(<main className="panel"><label htmlFor="json-input">JSON</label></main>);`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("React JSX is unsupported in plugin workspace files"),
        ]));
    });

    test("rejects static DOM.createElement calls", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const view = DOM.createElement("main", {class: "panel"}, "Inspector");`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("DOM.createElement(...) is not an SDK static method"),
        ]));
    });

    test("rejects DOM helper constructors used as markup factories", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const view = new DOMNested([new DOMText("JSON Inspector")]);`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("DOMNested and DOMText constructors do not create markup"),
        ]));
    });

    test("rejects the host-reserved data-bound marker in plugin UI code", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}\nnew InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const form = document.querySelector("form");\nif (form?.dataset.bound) return;\nform.dataset.bound = "true";`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("data-bound and element.dataset.bound are reserved"),
        ]));
    });

    test("normalizes a generated listener's reserved marker before plan validation", () => {
        const {files, normalizedPaths} = normalizeReservedHostBindingMarkers([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {}\nnew InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const form = document.querySelector("form");\nif (form?.dataset.bound) return;\nform.dataset["bound"] = "true";\nform.setAttribute("data-bound", "true");`,
            },
        ]);

        expect(normalizedPaths).toEqual(["/render.tsx"]);
        expect(files[1].content).toContain("dataset.pluginListenerBound");
        expect(files[1].content).toContain('"data-plugin-listener-bound"');
        expect(validateGeneratedPluginFiles(files).errors).toEqual([]);
    });

    test("rejects a manual form submit listener for a backend UI action", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/index.ts",
                content: `class InspectorPlugin extends FDO_SDK {
    renderOnLoad() {
        return window.createBackendReq("UI_MESSAGE", {handler: "inspectJson", content: {}});
    }
}
new InspectorPlugin();`,
            },
            {
                path: "/render.tsx",
                content: `const form = document.querySelector("form");
form?.addEventListener("submit", () => {});`,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("must use defineRenderOnLoadActions"),
        ]));
    });

    test("rejects copied FDO host runtime bootstrap code even without forbidden imports", () => {
        const result = validateGeneratedPluginFiles([
            {
                path: "/src/utils/PluginManager.js",
                content: `
export function mountPlugin(pluginModule) {
    const moduleURL = createESModule(pluginModule.render, pluginModule.onLoad);
    const pluginTimeout = setTimeout(() => {}, 5000);
    return import(/* webpackIgnore: true */ moduleURL).then(() => {
        SetPluginComponent(() => null);
        window.parent.postMessage({ type: "PLUGIN_HELLO" }, "*");
        clearTimeout(pluginTimeout);
    });
}
                `,
            },
        ]);

        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining("plugin code appears to copy FDO host runtime bootstrap logic"),
            expect.stringContaining("createESModule(...)"),
            expect.stringContaining("SetPluginComponent(...)"),
            expect.stringContaining("PLUGIN_HELLO"),
        ]));
    });
});
