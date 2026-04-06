import {resolvePluginSourceEntrypoint} from "../../src/utils/pluginRuntimeBundle";

describe("plugin runtime bundle helpers", () => {
    test("reads the source entrypoint from package.json", () => {
        expect(resolvePluginSourceEntrypoint(JSON.stringify({
            name: "demo-plugin",
            source: "index.ts",
            main: "dist/index.cjs",
        }))).toBe("index.ts");
    });

    test("returns null when the package does not declare a source entrypoint", () => {
        expect(resolvePluginSourceEntrypoint(JSON.stringify({
            name: "demo-plugin",
            main: "dist/index.cjs",
        }))).toBeNull();
    });
});
