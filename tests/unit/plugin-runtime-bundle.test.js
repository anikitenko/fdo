import {resolvePluginSourceEntrypoint} from "../../src/utils/plugins/runtime/pluginRuntimeBundle";

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

test.each([
    [{main:'index.ts'},{'index.ts':'hash'},'index.ts'],
    [{main:'dist/index.cjs'},{'index.ts':'hash'},'index.ts'],
    [{main:'dist/index.cjs'},{'src/index.ts':'hash'},'src/index.ts'],
    [{main:'dist/index.cjs'},{'dist/index.cjs':'hash'},null],
])('registry runtime resolves an entry only from the verified source inventory', (pkg,files,entry)=>{
    expect(resolvePluginSourceEntrypoint(JSON.stringify(pkg),files)).toBe(entry);
});
