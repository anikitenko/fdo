import {validateGeneratedPluginFiles} from "../../src/components/editor/utils/validateGeneratedPluginFiles.js";

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
        window.createBackendReq("x", {});
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
